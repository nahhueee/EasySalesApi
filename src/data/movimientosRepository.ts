import db from '../db';
import { ResultSetHeader } from 'mysql2';

class MovimientosRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
             //Obtengo la query segun los filtros
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQuery(filtros,false);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const rows = await connection.query(queryRegistros, paramsRegistros);
            const resultado = await connection.query(queryTotal, paramsTotal);
            
            return {total:resultado[0][0].total, registros:rows[0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    // Si se pasa "connection" (ya abierta por el caller, dentro de su propia transacción),
    // la reusamos y NO manejamos beginTransaction/commit/rollback/release acá: eso queda
    // a cargo del caller, para poder garantizar atomicidad con otras operaciones (ej. cobro
    // de fiado + movimiento de caja en la misma transacción). Si no se pasa, se comporta
    // igual que antes (conexión y transacción propias).
    async Agregar(data:any, connection?:any): Promise<string>{
        const conexionExterna = !!connection;
        const conn = connection ?? await db.getConnection();

        try {
            if(!conexionExterna) await conn.beginTransaction();

            //Insertamos el movimiento
            // idEntrega / idVentaPagoDetalle: referencia opcional al cobro de fiado que originó
            // este movimiento (cobro parcial o pago completo respectivamente), para poder
            // localizarlo y revertirlo con precisión. idProveedorMovimiento: mismo criterio para
            // pagos a proveedores (Fase 2 PR6) — apunta a la fila de proveedor_cuenta_movimientos
            // (pago o su ajuste de anulación). Todos nulos en el uso existente (ABM manual de
            // movimientos de caja).
            const consulta = " INSERT INTO cajas_movimientos(idCaja,tipoMovimiento,monto,descripcion,idEntrega,idVentaPagoDetalle,idProveedorMovimiento) " +
                             " VALUES(?, ?, ?, ?, ?, ?, ?) ";
            const parametros = [
                data.idCaja,
                data.tipoMovimiento.toUpperCase(),
                data.monto,
                data.descripcion,
                data.idEntrega ?? null,
                data.idVentaPagoDetalle ?? null,
                data.idProveedorMovimiento ?? null
            ];
            const [resultado] = await conn.query(consulta, parametros) as [ResultSetHeader, any];


            //Actualizamos el monto de la caja
            if(data.tipoMovimiento.toUpperCase() == "ENTRADA")
                await conn.query("UPDATE cajas SET entradas = entradas + ? WHERE id = ?", [data.monto, data.idCaja]);

            if(data.tipoMovimiento.toUpperCase() == "SALIDA")
                await conn.query("UPDATE cajas SET salidas = salidas + ? WHERE id = ?", [data.monto, data.idCaja]);


            if(!conexionExterna) await conn.commit();
            return conexionExterna ? String(resultado.insertId) : "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            if(!conexionExterna) await conn.rollback();
            throw error;
        } finally{
            if(!conexionExterna) conn.release();
        }
    }

    async Eliminar(data:any, connection?:any): Promise<string>{
        const conexionExterna = !!connection;
        const conn = connection ?? await db.getConnection();

        try {
            if(!conexionExterna) await conn.beginTransaction();

            // Blindaje: un movimiento de caja que vino de un pago a proveedor no se borra desde
            // el ABM manual (eso desincroniza el ledger de proveedores con la caja). Se verifica
            // contra la base, no contra lo que mande el front, porque el front puede tener bugs
            // y la base no puede quedar inconsistente (handoff_proveedores_fase2.md, PR6).
            const [movRows] = await conn.query(
                "SELECT idProveedorMovimiento FROM cajas_movimientos WHERE id = ?", [data.id]
            ) as [any[], any];
            if (movRows[0]?.idProveedorMovimiento != null) {
                if(!conexionExterna) await conn.rollback();
                return "Este movimiento corresponde a un pago a proveedor. Anulalo desde la cuenta del proveedor.";
            }

            //Eliminamos el movimiento
            await conn.query("DELETE FROM cajas_movimientos WHERE id = ?", [data.id]);

            //Actualizamos el monto de la caja
            if(data.tipoMovimiento.toUpperCase() == "ENTRADA")
                await conn.query("UPDATE cajas SET entradas = entradas - ? WHERE id = ?", [data.monto, data.idCaja]);

            if(data.tipoMovimiento.toUpperCase() == "SALIDA")
                await conn.query("UPDATE cajas SET salidas = salidas - ? WHERE id = ?", [data.monto, data.idCaja]);

            if(!conexionExterna) await conn.commit();
            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            if(!conexionExterna) await conn.rollback();
            throw error;
        } finally{
            if(!conexionExterna) conn.release();
        }
    }

    // Reemplaza a Eliminar como accion expuesta desde el ABM manual (decision de Nahu,
    // project_anular_movimientos_caja.md): no se borra fisicamente un movimiento, se compensa
    // con el inverso por el mismo monto, preservando el historial completo para auditoria.
    // Eliminar() se deja intacto arriba (sin ruta publica) por si hace falta alguna vez a mano.
    async Anular(data:any, connection?:any): Promise<string>{
        const conexionExterna = !!connection;
        const conn = connection ?? await db.getConnection();

        try {
            if(!conexionExterna) await conn.beginTransaction();

            // Traemos el movimiento con el estado de su caja directo de la base (no de lo que
            // mande el front), mismo criterio que ya usa Eliminar para idProveedorMovimiento y
            // que usa cuentasCorsRepository para bloquear la reversion de fiado sobre una caja
            // ya finalizada.
            const [movRows] = await conn.query(
                `SELECT cm.id, cm.idCaja, cm.tipoMovimiento, cm.monto, cm.descripcion,
                        cm.idProveedorMovimiento, cm.idMovimientoCompensado, c.finalizada
                 FROM cajas_movimientos cm
                 JOIN cajas c ON c.id = cm.idCaja
                 WHERE cm.id = ?`,
                [data.id]
            ) as [any[], any];

            const movimiento = movRows[0];
            if (!movimiento) {
                if(!conexionExterna) await conn.rollback();
                return "El movimiento no existe.";
            }

            if (movimiento.idProveedorMovimiento != null) {
                if(!conexionExterna) await conn.rollback();
                return "Este movimiento corresponde a un pago a proveedor. Anulalo desde la cuenta del proveedor.";
            }

            if (Number(movimiento.finalizada) === 1) {
                if(!conexionExterna) await conn.rollback();
                return "No se puede anular: la caja de este movimiento ya fue finalizada. Requiere un ajuste manual.";
            }

            if (movimiento.idMovimientoCompensado != null) {
                if(!conexionExterna) await conn.rollback();
                return "Este movimiento ya fue anulado.";
            }

            // Evita anular una anulacion (cadenas): si otra fila ya apunta a este movimiento
            // como su compensacion, este ES el inverso de otro, no un movimiento original.
            const [compRows] = await conn.query(
                "SELECT id FROM cajas_movimientos WHERE idMovimientoCompensado = ?", [movimiento.id]
            ) as [any[], any];
            if (compRows.length > 0) {
                if(!conexionExterna) await conn.rollback();
                return "Este movimiento es la anulación de otro, no se puede volver a anular.";
            }

            // Insertamos el inverso reusando Agregar (ya actualiza cajas.entradas/salidas),
            // dentro de la misma transaccion.
            const tipoInverso = movimiento.tipoMovimiento === "ENTRADA" ? "SALIDA" : "ENTRADA";
            const idInverso = await this.Agregar({
                idCaja: movimiento.idCaja,
                tipoMovimiento: tipoInverso,
                monto: movimiento.monto,
                descripcion: `Anulación de mov. #${movimiento.id}: ${movimiento.descripcion ?? ''}`.trim(),
            }, conn);

            // Marcamos el original como compensado.
            await conn.query(
                "UPDATE cajas_movimientos SET idMovimientoCompensado = ? WHERE id = ?",
                [Number(idInverso), movimiento.id]
            );

            if(!conexionExterna) await conn.commit();
            return "OK";

        } catch (error:any) {
            if(!conexionExterna) await conn.rollback();
            throw error;
        } finally{
            if(!conexionExterna) conn.release();
        }
    }
    //#endregion
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<{query:string, params:any[]}>{
    try {

        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";

        let count:string = "";
        let endCount:string = "";
        let params:any[] = [];
        //#endregion

        // #region FILTROS
        filtro = " WHERE idCaja = ?";
        params.push(filtros.caja);

        // tipoMovimiento es un enum acotado a 1/otro, mapeado a literales fijos — no hay
        // input de usuario libre en el string, seguro sin parametrizar.
        if (filtros.tipoMovimiento != 0)
            filtro += " AND tipoMovimiento = " + (filtros.tipoMovimiento == 1 ? "'ENTRADA'" : "'SALIDA'");

        // Se listan todos los movimientos, incluidos los ya anulados (decisión de Nahu,
        // 2026-09-03): el front los muestra atenuados/grisados en vez de ocultarlos, para que
        // el historial completo de la caja quede siempre a la vista.
        // #endregion

        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if (filtros.tamanioPagina != null){
                paginado = " LIMIT ? OFFSET ? ";
                params.push(Number(filtros.tamanioPagina), (Number(filtros.pagina) - 1) * Number(filtros.tamanioPagina));
            }
        }

        //Arma la Query con el paginado y los filtros correspondientes. ORDER BY id DESC:
        //el más reciente primero (decisión de Nahu, 2026-09-03) — así, al anular un movimiento,
        //su inverso (que se inserta después, con id mayor) aparece arriba de todo.
        query = count +
                " SELECT * " +
                " FROM cajas_movimientos " +
                filtro +
                " ORDER BY id DESC " +
                paginado +
                endCount;

        return {query, params};
            
    } catch (error) {
        throw error; 
    }
}

export const MovimientosRepo = new MovimientosRepository();
