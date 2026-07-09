import db from '../db';
import { Venta } from '../models/Venta';
import { Cliente } from '../models/Cliente';
import { pagoVenta } from '../models/PagoVenta';
import { DetalleVenta } from '../models/DetalleVenta';
import { Producto } from '../models/Producto';
import { FacturaVenta } from '../models/FacturaVenta';
import { ObjQR } from '../models/ObjQR';
import { ObjTicketFactura } from '../models/ObjTicketFactura';
import { ParametrosRepo } from './parametrosRepository';
import { SesionServ } from '../services/sesionService';
import { CuentaCorrienteRepo } from './cuentaCorrienteRepository';
import { DetallePago } from '../models/DetallePago';
import { TipoPago } from '../models/TipoPago';
const moment = require('moment');

class VentasRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();

        try {
             //Obtengo la query segun los filtros
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQuery(filtros,false);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros, paramsRegistros);
            const resultado = await connection.query(queryTotal, paramsTotal);

            const ventas:Venta[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let venta:Venta = new Venta();
                    venta.id = row['id'];
                    venta.idCaja = row['idCaja'];
                    venta.fecha = row['fecha'];
                    venta.hora = row['hora'];
                    venta.fechaBaja = row['fechaBaja'];
                    venta.obsBaja = row['obsBaja'];
                    
                    //Obtiene la lista de detalles de la venta
                    venta.detalles = await ObtenerDetalleVenta(connection, row['id']); 

                    venta.cliente = new Cliente({id: row['idCliente'], nombre: row['cliente'], razonSocial: row['clienteRazonSocial']});
                    venta.pago = new pagoVenta({
                        recargo: parseFloat(row['recargo']), 
                        descuento: parseFloat(row['descuento']), 
                        entrega: parseFloat(row['entrega']), //Dinero entregado a la venta
                        monto: parseFloat(row['monto']), //Monto de la venta
                        tipoModificador: row['tipoModificador'],
                        realizado: row['realizado'],
                    });

                    //Obtenemos detalle de pagos
                    venta.detallePago = await ObtenerDetallePagos(connection, row['id']);

                    //Obtenemos la suma total de las ventas
                    venta.total = venta.pago.monto ?? 0;
                    if(venta.total == 0){
                        //Obtenemos la suma total de las ventas
                        venta.total = venta.detalles.reduce((accum, detalle) => {
                            return accum + detalle.total!;
                        }, 0);
                    }
                    
                    venta.factura = new FacturaVenta({
                        cae: row['cae'], 
                        caeVto: row['caeVto'], 
                        ticket: row['ticket'], 
                        tipoComprobante: row['tipoFactura'], 
                        neto: parseFloat(row['neto']), 
                        iva: parseFloat(row['iva']), 
                        dni: row['dni'],
                        tipoDni: row['tipoDni'],
                        ptoVenta: row['ptoVenta'],
                        condReceptor: row['condReceptor'],
                        // mysql2 devuelve el SUM() de un DECIMAL como string, hay que normalizarlo igual que el resto de los montos.
                        acreditado: row['acreditado'] !== undefined ? Number(row['acreditado'] ?? 0) : undefined,
                    });

                    let ajuste = 0;
                    if (venta.pago.descuento > 0) {
                        ajuste = venta.pago.tipoModificador === 'porcentaje'
                            ? venta.total * (venta.pago.descuento / 100)
                            : venta.pago.descuento;

                        venta.total -= ajuste;
                    }

                    if (venta.pago.recargo > 0) {
                        ajuste = venta.pago.tipoModificador === 'porcentaje'
                            ? venta.total * (venta.pago.recargo / 100)
                            : venta.pago.recargo;

                        venta.total += ajuste;
                    }

                    venta.pago.restante = venta.total - venta.pago.entrega!, //Restante a pagar

                    ventas.push(venta);
                  }
            }

            return {total:resultado[0][0].total, registros:ventas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TiposPagoSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM tipos_pago ORDER BY orden ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesXTipoPago(idCaja){
        const connection = await db.getConnection();
        
        try {
            const consultaEfectivo = " SELECT COALESCE(SUM(efectivo), 0) AS efectivo FROM ventas_pago vpag " +
                                     " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                                     " WHERE v.idCaja = ? AND vpag.realizado = 1 ";

            const [resultEfectivo] = await connection.query(consultaEfectivo, [idCaja]);

            const consultaDigital =  " SELECT COALESCE(SUM(CASE WHEN vpag.idPago = 2 THEN digital ELSE 0 END), 0) AS tarjetas, " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 3 THEN digital ELSE 0 END), 0) AS transferencias, " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 4 THEN digital ELSE 0 END), 0) AS otros FROM ventas_pago vpag " +
                                     " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                                     " WHERE v.idCaja = ? ";

            const [resultDigital] = await connection.query(consultaDigital, [idCaja]);

            return {
                efectivo: parseFloat(resultEfectivo[0].efectivo),
                tarjetas: parseFloat(resultDigital[0].tarjetas),
                transferencias: parseFloat(resultDigital[0].transferencias),
                otros: parseFloat(resultDigital[0].otros)
            };


        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesPagasImpagas(idCaja){
        const connection = await db.getConnection();
        
        try {
            const consulta =  " SELECT  COUNT(CASE WHEN vpag.realizado = 1 THEN 1 END) AS pagas, " +
                              " COUNT(CASE WHEN vpag.realizado = 0 THEN 1 END) AS impagas FROM ventas_pago vpag " +
                              " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                              " WHERE v.idCaja = ? ";

            const [resultado] = await connection.query(consulta, [idCaja]);

            return {
                pagas: parseInt(resultado[0].pagas),
                impagas: parseInt(resultado[0].impagas)
            };


        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async Agregar(venta:Venta): Promise<string>{
        const connection = await db.getConnection();

        try {
            //Obtenemos el proximo nro de venta a insertar
            venta.id = await ObtenerUltimaVenta(connection);

            //Iniciamos una transaccion
            await connection.beginTransaction();

            // Si la venta proviene de un presupuesto, validar que esté vigente
            // antes de crear la venta (FOR UPDATE evita doble conversión concurrente)
            if (venta.idPresupuesto) {
                const [pRows] = await connection.query(
                    'SELECT estado FROM presupuestos WHERE id = ? FOR UPDATE',
                    [venta.idPresupuesto]
                );
                if (!pRows[0] || pRows[0].estado !== 'vigente') {
                    throw new Error('El presupuesto ya fue convertido, anulado o no existe.');
                }
            }

            //Insertamos la venta
            await InsertVenta(connection,venta);

            //insertamos los datos del pago de la venta
            venta.pago.idVenta = venta.id;
            await InsertPagoVenta(connection, venta.pago);
            for (const element of  venta.detallePago!) {
                element.idVenta = venta.id;
                // Guardar el detalle si tiene monto > 0 (trazabilidad).
                // "CUENTA CORRIENTE" queda con monto=0 → no se guarda en detalle (sin efectivo).
                // "SALDO A FAVOR" queda con el monto SAF real → sí se guarda (para auditoría).
                if(element.monto > 0)
                    await InsertPagoVentaDetalle(connection, element);
            }

            // Validación SAF (Bug 4 — no confiar en el front):
            // Si hay un detalle de pago "SALDO A FAVOR", verificar que el cliente
            // realmente tiene favor disponible y que el monto no lo supera.
            const detalleSAF = (venta.detallePago ?? []).find(d =>
                (d.tipoPago?.nombre ?? '').toUpperCase() === 'SALDO A FAVOR'
            );
            if(detalleSAF && detalleSAF.monto > 0){
                if(venta.cliente.id === 1)
                    throw new Error('El consumidor final no puede usar Saldo a Favor.');

                // Lockear el cliente y leer saldo actual dentro de la transacción activa
                await connection.query('SELECT id FROM clientes WHERE id = ? FOR UPDATE', [venta.cliente.id]);
                const [saldoRows] = await connection.query(
                    'SELECT saldo FROM cuenta_corriente_movimientos WHERE idCliente = ? ORDER BY id DESC LIMIT 1',
                    [venta.cliente.id]
                );
                const saldoActual = saldoRows[0] ? Number((saldoRows as any)[0].saldo) : 0;

                if(saldoActual >= 0)
                    throw new Error('El cliente no tiene saldo a favor para utilizar.');

                const disponible = Math.abs(saldoActual);
                if(Number(detalleSAF.monto) > disponible)
                    throw new Error(`El monto de "Saldo a favor" ($${detalleSAF.monto}) supera el disponible ($${disponible.toFixed(2)}).`);
            }

            // Libreta completa (PR B, 2026-07-03): para todo cliente con nombre (id != 1),
            // toda venta postea debe=total y un haber por cada pago real.
            // "CUENTA CORRIENTE" y "SALDO A FAVOR" no generan haber — el saldo corrido
            // los absorbe (ver documentos/handoff_implementacion_devoluciones_nc.md).
            if(venta.cliente.id !== 1){
                await SesionServ.RegistrarMovimiento("Nueva entrada de venta para el cliente " + venta.cliente.nombre);

                // 1. Debe = total (la deuda de la venta)
                await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                    idCliente: venta.cliente.id!,
                    tipo: 'venta',
                    descripcion: 'Venta',
                    debe: venta.total,
                    idReferencia: venta.id
                });

                // 2. Haber por cada pago real (excluir CC y SAF — no generan haber)
                const MEDIOS_SIN_HABER = ['CUENTA CORRIENTE', 'SALDO A FAVOR'];
                for(const detalle of venta.detallePago ?? []){
                    const nombreMedio = (detalle.tipoPago?.nombre ?? '').toUpperCase();
                    if(!MEDIOS_SIN_HABER.includes(nombreMedio) && detalle.monto > 0){
                        await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                            idCliente: venta.cliente.id!,
                            tipo: 'pago',
                            descripcion: `Pago: ${detalle.tipoPago?.nombre}`,
                            haber: detalle.monto,
                            idReferencia: venta.id
                        });
                    }
                }
            }

            //insertamos los datos de la factura de la venta
            if(venta.factura){
                venta.factura.idVenta = venta.id;
                await InsertFacturaVenta(connection, venta.factura);
            }
             
            //Insertamos los detalles de la venta
            for (const element of  venta.detalles) {
                element.idVenta = venta.id;
                InsertDetalleVenta(connection, element);
                ActualizarInventario(connection, element, "-")
            };

            //Actualizamos el total de ventas caja
            await connection.query("UPDATE cajas SET ventas = ventas + ? WHERE id = ?", [venta.total, venta.idCaja]);

            // Si la venta proviene de un presupuesto, marcarlo como convertido
            if (venta.idPresupuesto) {
                await connection.query(
                    `UPDATE presupuestos SET estado = 'convertido', idVentaGenerada = ?
                     WHERE id = ?`,
                    [venta.id, venta.idPresupuesto]
                );
            }

            //Mandamos la transaccion
            await connection.commit();
            return venta.id.toString();

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    async GuardarFactura(data:any){
        const connection = await db.getConnection();
        
        try {
            data.factura.idVenta = data.idVenta;
            await InsertFacturaVenta(connection, data.factura);
            return("OK");

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Eliminar(venta:any, obs:string): Promise<string>{
        const connection = await db.getConnection();

        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Leemos el estado de pago real de la venta (no confiamos en lo que
            //venga del front) para revertir exactamente lo que se posteó en el ledger.
            //Incluimos v.total porque es el monto real que se posteó como "debe" en Agregar
            //(puede diferir de ventas_pago.monto si había recargo/descuento).
            const [pagoRows] = await connection.query(
                "SELECT p.idCliente, p.monto, p.entrega, p.realizado, v.total AS totalVenta FROM ventas_pago p INNER JOIN ventas v ON v.id = p.idVenta WHERE p.idVenta = ?",
                [venta.id]
            );
            const pagoInfo = (pagoRows as any)[0];

            //Damos de baja la venta
            await connection.query("UPDATE ventas SET fechaBaja = NOW(), obsBaja = ? WHERE id = ?", [obs, venta.id]);

            //Actualizamos el total de ventas caja
            await connection.query("UPDATE cajas SET ventas = ventas - ? WHERE id = ?", [venta.total, venta.idCaja]);

            //Actualizamos el inventario
            venta.detalles.forEach(element => {
                ActualizarInventario(connection, element, "+")
            });

            // Libreta completa (PR B, 2026-07-03): revertir exactamente lo que Agregar posteó.
            // Agregar posteó: debe=total + haber por cada pago real (no CC/SAF).
            // El reversal espejo es: haber=total + debe por cada pago real.
            if (pagoInfo && pagoInfo.idCliente !== 1) {
                const totalVenta = Number(pagoInfo.totalVenta ?? 0);
                const detallePagoVenta = await ObtenerDetallePagos(connection, venta.id);
                const MEDIOS_SIN_HABER = ['CUENTA CORRIENTE', 'SALDO A FAVOR'];

                // Reverso del debe (la venta en sí)
                await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                    idCliente: pagoInfo.idCliente,
                    tipo: 'ajuste',
                    descripcion: 'Anulación de venta',
                    haber: totalVenta,
                    idReferencia: venta.id
                });

                // Reverso de cada haber (pago real que se había registrado)
                for(const detalle of detallePagoVenta){
                    const nombreMedio = (detalle.tipoPago?.nombre ?? '').toUpperCase();
                    if(!MEDIOS_SIN_HABER.includes(nombreMedio) && detalle.monto > 0){
                        await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                            idCliente: pagoInfo.idCliente,
                            tipo: 'ajuste',
                            descripcion: `Reverso pago: ${detalle.tipoPago?.nombre}`,
                            debe: detalle.monto,
                            idReferencia: venta.id
                        });
                    }
                }
            }

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Eliminar Venta nro " + venta.id);

            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region OTROS
    async ObtenerQRFactura(idVenta:number){
        const connection = await db.getConnection();

        try {
            const consulta = " SELECT vf.cae, vf.ticket, vf.tipoFactura, vf.neto, vf.iva, vf.dni, vf.tipodni, vf.ptoVenta, v.fecha " +
                             " FROM ventas_factura vf " +
                             " INNER JOIN ventas v on v.id = vf.idVenta " +
                             " WHERE vf.idVenta = ? "

            const [resultado] = await connection.query(consulta, idVenta);
            const row = resultado[0];

            const objQR = new ObjQR({
                ver: 1,
                fecha : moment(row['fecha']).format('YYYY-MM-DD'),
                ptoVta : row['ptoVenta'],
                tipoCmp : row['tipoFactura'],
                nroCmp : row['ticket'],
                importe : parseFloat(row['neto']) + parseFloat(row['iva']), 
                moneda : "PES",
                ctz : 1,
                tipoDocRec : row['tipodni'],
                nroDocRec : row['dni'],
                tipoCodAut : "E",
                codAut : row['cae']
            })

            return objQR;
            
        } catch (error) {
            throw error;
        }finally{
            connection.release();
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
        let params:any[] = [];

        let count:string = "";
        let endCount:string = "";

        // Acreditado vía NC: se calcula siempre (antes solo en el drill-down por idVenta).
        // idVenta tiene índice en notas_credito (ver migración) y el volumen de NCs es bajo
        // frente al de ventas, así que el JOIN agregado es liviano incluso en el listado
        // paginado general. Alimenta tanto "Emitir NC" vs "Eliminar" en el detalle como el
        // estado de la columna "Fact." (facturada / NC parcial / NC total) en la tabla.
        const selectAcreditado = ", nc.acreditado ";
        const joinAcreditado = " LEFT JOIN (SELECT idVenta, SUM(total) AS acreditado FROM notas_credito GROUP BY idVenta) nc ON nc.idVenta = v.id ";
        //#endregion

        // #region FILTROS
        if (filtros.caja != 0)
            filtro += " AND v.idCaja = " + filtros.caja;

        if (filtros.cliente != 0)
            filtro += " AND v.idCliente = " + filtros.cliente;


        if (filtros.estado == "Pagas")
            filtro += " AND vpag.realizado = 1";
        if (filtros.estado == "Impagas")
            filtro += " AND vpag.realizado = 0";

        //Filtro puntual por venta (drill-down desde la pantalla de cuenta corriente).
        //Parametrizado a diferencia del resto de los filtros de esta función.
        if (filtros.idVenta){
            filtro += " AND v.id = ? ";
            params.push(filtros.idVenta);
        }
        // #endregion

        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if (filtros.tamanioPagina != null)
                paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
        }
            
        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
                " SELECT v.*, " + 
                " vpag.monto, vpag.recargo, vpag.descuento, vpag.entrega, vpag.tipoModificador, vpag.realizado, " + //Pago
                " vfac.cae, vfac.caeVto, vfac.ticket, vfac.tipoFactura, vfac.neto, vfac.iva, vfac.dni, vfac.tipoDni, vfac.ptoVenta, vfac.condReceptor, " + //Factura
                " COALESCE(cli.nombre, 'ELIMINADO') cliente, cli.razonSocial clienteRazonSocial " +
                selectAcreditado +
                " FROM ventas v " +
                " INNER JOIN ventas_pago vpag ON vpag.idVenta = v.id " +
                " LEFT JOIN ventas_factura vfac ON vfac.idVenta = v.id " +
                " LEFT JOIN clientes cli ON cli.id = v.idCliente " +
                joinAcreditado +
                " WHERE 1 = 1 " +
                filtro +
                " ORDER BY v.id DESC" +
                paginado +
                endCount;

        return {query, params};

    } catch (error) {
        throw error;
    }
}

//#region INSERT
async function ObtenerUltimaVenta(connection):Promise<number>{
    try {
        const rows = await connection.query(" SELECT id FROM ventas ORDER BY id DESC LIMIT 1 ");
        let resultado:number = 0;

        if([rows][0][0].length==0){
            resultado = 1;
        }else{
            resultado = rows[0][0].id + 1;
        }

        return resultado;

    } catch (error) {
        throw error; 
    }
}

async function InsertVenta(connection, venta):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas(id, idCaja, idCliente, fecha, hora, total) " +
                         " VALUES(?, ?, ?, ?, ?, ?) ";

        const parametros = [venta.id, venta.idCaja, venta.cliente.id, moment(venta.fecha).format('YYYY-MM-DD'), venta.hora, venta.total];
        await connection.query(consulta, parametros);

    } catch (error) {
        throw error;
    }
}

async function InsertPagoVenta(connection, pago):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_pago(idVenta, monto, recargo, descuento, entrega, tipoModificador, realizado) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [pago.idVenta, pago.monto, pago.recargo, pago.descuento, pago.entrega, pago.tipoModificador, pago.realizado];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertPagoVentaDetalle(connection, pago):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_pagos_detalle(idVenta, idTPago, monto) " +
                         " VALUES(?, ?, ?) ";

        const parametros = [pago.idVenta, pago.tipoPago.id, pago.monto];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertFacturaVenta(connection, factura):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_factura(idVenta, cae, caeVto, ticket, tipoFactura, neto, iva, dni, tipoDni, ptoVenta, condReceptor) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [factura.idVenta, factura.cae, moment(factura.caeVto).format('YYYY-MM-DD'), factura.ticket, factura.tipoComprobante, factura.neto, factura.iva, factura.dni, factura.tipoDni, factura.ptoVenta, factura.condReceptor];
        await connection.query(consulta, parametros);

    } catch (error) {
        throw error; 
    }
}
//#endregion

//#region DETALLE VENTA
async function ObtenerDetalleVenta(connection, idVenta:number){
    try {
        const consulta = " SELECT dv.*, p.precio precioProducto, COALESCE(p.nombre, 'ELIMINADO') producto, p.soloPrecio FROM ventas_detalle dv " +
                         " LEFT JOIN productos p on p.id = dv.idProducto " +
                         " WHERE dv.idVenta = ?" +
                         " ORDER BY dv.id DESC ";

        const [rows] = await connection.query(consulta, [idVenta]);

        const detalles:DetalleVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let detalle:DetalleVenta = new DetalleVenta();
                detalle.id = row['id'];
                detalle.cantidad = row['cantidad'];
                detalle.nomProd = row['nomProd'];
                detalle.precio = parseFloat(row['precio']);
                detalle.costo = parseFloat(row['costo']);
                detalle.total = detalle.precio! * detalle.cantidad!;
                detalle.producto = new Producto({
                    id: row['idProducto'], 
                    nombre: row['producto'], 
                    soloPrecio: row['soloPrecio'] == 1 ? true : false, 
                    precio: parseFloat(row['precioProducto'])
                });


                detalles.push(detalle)
              }
        }

        return detalles;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerDetallePagos(connection, idPedido:number){
    try {
        const consulta = " SELECT vd.*, tp.id idTipoPago, tp.nombre, tp.icono, tp.color FROM ventas_pagos_detalle vd " +
                         " INNER JOIN tipos_pago tp ON tp.id = vd.idTPago " +
                         " WHERE vd.idVenta = ?";

        const [rows] = await connection.query(consulta, [idPedido]);

        const detalles:DetallePago[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let detalle:DetallePago = new DetallePago();
                detalle.idVenta = row['idVenta'];
                detalle.tipoPago = new TipoPago({
                    id: row['idTipoPago'],
                    nombre: row['nombre'],
                    icono: row['icono'],
                    color: row['color'],
                });
                detalle.monto = parseFloat(row['monto']);
                detalles.push(detalle)
              }
        }

        return detalles;

    } catch (error) {
        throw error; 
    }
}

async function InsertDetalleVenta(connection, detalle):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_detalle(idVenta, nomProd, idProducto, cantidad, costo, precio) " +
                         " VALUES(?, ?, ?, ?, ?, ?) ";

        
        const parametros = [detalle.idVenta, detalle.producto.nombre, detalle.producto.id, detalle.cantidad, detalle.costo, detalle.precio];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function ActualizarInventario(connection, detalle, operacion):Promise<void>{
    try {
        if(detalle.producto.id === 1 || detalle.producto.soloPrecio) return; //No actualizamos el producto vario o productos que no trabajan cantidad

        const consulta = `UPDATE productos SET cantidad = cantidad ${operacion} ? 
                          WHERE id = ?`;

        const parametros = [detalle.cantidad, detalle.producto.id];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}
//#endregion


export const VentasRepo = new VentasRepository();