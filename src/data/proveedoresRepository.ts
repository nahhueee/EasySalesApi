import db from '../db';
import { ResultSetHeader } from 'mysql2';
import { Proveedor } from '../models/Proveedor';
import { SesionServ } from '../services/sesionService';
import { ProveedorCuentaRepo } from './proveedorCuentaRepository';

// Espejo de clientesRepository.ts, simplificado a propósito (documentos/plan_proveedores.md §4.1,
// handoff_proveedores_fase0_1.md PR3):
// - Sin validación de consistencia fiscal ni unicidad de nombre/CUIT: a un proveedor no se le
//   factura, y "nombre de fiambre" (ej. "El de las gaseosas") puede repetirse sin problema.
// - Baja lógica siempre (sin la rama condicional de clientesRepository.Eliminar que decide
//   entre baja y borrado físico según si hay movimientos en el ledger): acá el ledger recién
//   se crea en Fase 2, así que hoy no hay nada que auditar todavía, pero mantenemos un solo
//   camino simple para no tener que revisitar esto cuando el ledger exista.
class ProveedoresRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();

        try {
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQuery(filtros,false);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQuery(filtros,true);

            const rows = await connection.query(queryRegistros, paramsRegistros);
            const resultado = await connection.query(queryTotal, paramsTotal);

            return {total:resultado[0][0].total, registros:rows[0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerProveedor(filtros:any){
        const connection = await db.getConnection();

        try {
            let { query: consulta, params } = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta, params);

            return new Proveedor(rows[0][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Selector(){
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query('SELECT id, nombre, telefono FROM proveedores WHERE fechaBaja IS NULL ORDER BY nombre ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    // Resuelve una lista de nombres de proveedor a sus ids, creando los que no existan.
    // Uso: importacion masiva desde Excel (handoff_repuestos_fases1_2_3.md, Fase 1 PR 1.3).
    // Normaliza (trim + colapso de espacios + uppercase) antes de comparar/crear, mismo motivo
    // que RubrosRepo.ResolverPorNombre. Nota: proveedores no tiene unicidad de nombre en el
    // resto del ABM (a proposito, ver comentario de cabecera del archivo) — si ya existieran
    // dos proveedores con el mismo nombre normalizado, esta resolucion toma uno de los dos de
    // forma no determinista; no introduce el problema, pero tampoco lo corrige.
    // Transaccional en si misma: si la creacion de algun proveedor falla a mitad de lote, se
    // revierte todo el lote.
    async ResolverPorNombre(nombres: string[]): Promise<Map<string, number>> {
        const resultado = new Map<string, number>();

        const normalizados = Array.from(new Set(
            nombres
                .map(n => (n ?? '').replace(/\s+/g, ' ').trim().toUpperCase())
                .filter(n => n.length > 0)
        ));

        if (normalizados.length === 0) return resultado;

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const placeholders = normalizados.map(() => '?').join(',');
            const [existentes] = await connection.query(
                `SELECT id, nombre FROM proveedores WHERE fechaBaja IS NULL AND nombre IN (${placeholders})`,
                normalizados
            );
            for (const fila of existentes as any[]) {
                resultado.set(fila.nombre, fila.id);
            }

            const faltantes = normalizados.filter(n => !resultado.has(n));
            for (const nombre of faltantes) {
                const [insertado]: any = await connection.query(
                    "INSERT INTO proveedores(nombre) VALUES (?)", [nombre]
                );
                resultado.set(nombre, insertado.insertId);
            }

            await connection.commit();
            return resultado;

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Con deudaInicial (> 0) inserta también el movimiento de apertura del ledger, en la misma
    // transacción: si el movimiento fallara, no puede quedar un proveedor sin su ledger acorde.
    // Sin deudaInicial (o = 0) el proveedor arranca sin movimientos y con saldo 0 — no se agrega
    // fila alguna al ledger para no ensuciarlo con aperturas en cero (documentos/plan_proveedores.md §4.1).
    async Agregar(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const consulta = "INSERT INTO proveedores(nombre, razonSocial, cuit, telefono, email, direccion) VALUES (?, ?, ?, ?, ?, ?)";
            const parametros = [
                data.nombre.toUpperCase(),
                data.razonSocial ? data.razonSocial.toUpperCase() : null,
                data.cuit ?? null,
                data.telefono ?? null,
                data.email ?? null,
                data.direccion ? data.direccion.toUpperCase() : null
            ];

            const [resultado] = await connection.query<ResultSetHeader>(consulta, parametros);
            const idProveedor = resultado.insertId;

            const deudaInicial = Number(data.deudaInicial ?? 0);
            if (deudaInicial > 0) {
                await ProveedorCuentaRepo.RegistrarMovimiento(connection, {
                    idProveedor,
                    tipo: 'apertura',
                    descripcion: 'Saldo inicial',
                    debe: deudaInicial
                });
            }

            await connection.commit();

            await SesionServ.RegistrarMovimiento("Agregar Nuevo Proveedor: " + data.nombre.toUpperCase());

            return "OK";

        } catch (error:any) {
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    async Modificar(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = `UPDATE proveedores
                SET nombre = ?, razonSocial = ?, cuit = ?, telefono = ?, email = ?, direccion = ?
                WHERE id = ? `;

            const parametros = [
                data.nombre.toUpperCase(),
                data.razonSocial ? data.razonSocial.toUpperCase() : null,
                data.cuit ?? null,
                data.telefono ?? null,
                data.email ?? null,
                data.direccion ? data.direccion.toUpperCase() : null,
                data.id
            ];
            await connection.query(consulta, parametros);

            await SesionServ.RegistrarMovimiento("Modificar Proveedor: " + data.nombre.toUpperCase());

            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Eliminar(id:string): Promise<string>{
        const connection = await db.getConnection();

        try {
            await connection.query("UPDATE proveedores SET fechaBaja = NOW() WHERE id = ?", [id]);
            await SesionServ.RegistrarMovimiento("Dar de baja Proveedor nro " + id);

            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<{query:string, params:any[]}>{
    try {
        let query:string;
        let filtro:string = "";
        let paginado:string = "";

        let count:string = "";
        let endCount:string = "";
        let params:any[] = [];

        filtro += " WHERE p.fechaBaja IS NULL ";
        if (filtros.busqueda != null && filtros.busqueda != ""){
            filtro += " AND p.nombre LIKE ? ";
            params.push("%" + filtros.busqueda + "%");
        }
        if (filtros.idProveedor != null && filtros.idProveedor != 0){
            filtro += " AND p.id = ? ";
            params.push(filtros.idProveedor);
        }

        if (esTotal)
        {
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {
            if (filtros.tamanioPagina != null){
                paginado = " LIMIT ? OFFSET ? ";
                params.push(filtros.tamanioPagina, (filtros.pagina - 1) * filtros.tamanioPagina);
            }
        }

        // Mismo patrón que clientesRepository.ObtenerQuery: subquery correlacionada por el
        // último movimiento del ledger. saldo > 0 = le debo al proveedor (convención invertida,
        // ver proveedorCuentaRepository.ts) — el front interpreta el signo, acá solo se expone.
        const saldoSelect = !esTotal
            ? `, (SELECT saldo FROM proveedor_cuenta_movimientos WHERE idProveedor = p.id ORDER BY id DESC LIMIT 1) AS saldo`
            : '';

        query = count +
            " SELECT p.* " + saldoSelect +
            " FROM proveedores p" +
            filtro +
            " ORDER BY p.id DESC" +
            paginado +
            endCount;

        return {query, params};

    } catch (error) {
        throw error;
    }
}

export const ProveedoresRepo = new ProveedoresRepository();
