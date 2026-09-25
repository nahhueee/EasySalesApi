import db from '../db';
import {
    GetIdListaDefault,
    EsListaDefault,
    UpsertUnPrecio,
    InsertarHistorialPrecios,
} from './productosRepository';

// MVP importación de precios desde lista de proveedor --
// documentos/handoff_importacion_precios_proveedor.md.
//
// AplicarLote es una única transacción por lote (a diferencia de ActualizarPrecioPorcentaje /
// ActualizarPrecioFijo en productosRepository.ts, que comparten una sola connection sin
// beginTransaction real): acá hace falta atomicidad real porque el lote puede tener cientos de
// filas y cada una toca 4 tablas (productos_precios, productos, producto_precio_historial,
// productos_proveedores) más el detalle propio -- si se corta a mitad de camino, Deshacer no
// tiene de dónde reconstruir un estado consistente.
//
// GetIdListaDefault / EsListaDefault / UpsertUnPrecio / InsertarHistorialPrecios están
// exportadas desde productosRepository.ts puntualmente para que este módulo las reuse en vez
// de duplicar la lógica de upsert de precios / historial / lista default.

const TAMANIO_LOTE = 500;

interface FilaLote {
    idProducto: number;
    codigoArchivo: string;
    costo: number;
    precio: number;
    tipoPrecio: '%' | '$';
    porcentaje: number | null;
    redondeo: number;
}

interface AplicarLoteData {
    idProveedor: number;
    nombreArchivo: string | null;
    idUsuario: number;
    filas: FilaLote[];
}

export interface MatchResultado {
    ambiguo: boolean;
    idProducto?: number;
    codigoProducto?: string;
    nombre?: string;
    costoActual?: number | null;
    precioActual?: number | null;
    matcheoPor?: 'PROVEEDOR' | 'CODIGO';
}

class ImportacionCostosRepository {

    // Matching en dos niveles, sin N+1: nivel 1 por código de proveedor (fuerte, contra
    // productos_proveedores), nivel 2 por código propio del producto -- sólo para los códigos
    // que nivel 1 no resolvió (ni matcheados ni ambiguos). Un código que resuelve a más de un
    // producto en cualquiera de los dos niveles queda marcado ambiguo: nunca se elige uno
    // (handoff, sección Matching). La normalización es la misma que usa todo el módulo de
    // proveedores: espacios colapsados, trim, mayúsculas.
    async MatchearCodigos(idProveedor: number, codigosArchivo: string[]): Promise<Map<string, MatchResultado>> {
        const normalizados = Array.from(new Set(
            codigosArchivo.map(c => Normalizar(c)).filter(c => c.length > 0)
        ));
        const resultado = new Map<string, MatchResultado>();
        if (normalizados.length === 0) return resultado;

        const connection = await db.getConnection();
        try {
            const filasNivel1 = await ConsultarPorLotes(connection, normalizados, lote => ({
                sql: `
                    SELECT UPPER(TRIM(pp.codigoProveedor)) AS codigoMatch, p.id AS idProducto,
                           p.codigo AS codigoProducto, p.nombre, p.costo, p.precio
                    FROM productos_proveedores pp
                    INNER JOIN productos p ON p.id = pp.idProducto
                    WHERE pp.idProveedor = ? AND UPPER(TRIM(pp.codigoProveedor)) IN (${lote.map(() => '?').join(',')})
                `,
                params: [idProveedor, ...lote],
            }));
            AcumularMatches(resultado, filasNivel1, 'PROVEEDOR');

            const pendientes = normalizados.filter(c => !resultado.has(c));
            if (pendientes.length > 0) {
                const filasNivel2 = await ConsultarPorLotes(connection, pendientes, lote => ({
                    sql: `
                        SELECT UPPER(TRIM(codigo)) AS codigoMatch, id AS idProducto, codigo AS codigoProducto,
                               nombre, costo, precio
                        FROM productos
                        WHERE UPPER(TRIM(codigo)) IN (${lote.map(() => '?').join(',')}) AND fechaBaja IS NULL
                    `,
                    params: lote,
                }));
                AcumularMatches(resultado, filasNivel2, 'CODIGO');
            }

            return resultado;

        } finally {
            connection.release();
        }
    }

    // Una sola transacción por lote. Ver pseudocódigo "Aplicación" del handoff -- esta es su
    // traducción directa, con el detalle guardando también tipoPrecio/porcentaje/redondeo
    // anteriores (ver comentario en la migración) para que Deshacer pueda restaurar el estado
    // completo, no sólo costo/precio.
    async AplicarLote(data: AplicarLoteData): Promise<{ idImportacion: number; aplicadas: number; errores: string[] }> {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [insertCabecera] = await connection.query(
                `INSERT INTO importaciones_costos (idProveedor, nombreArchivo, fecha, idUsuario, filasArchivo, filasAplicadas, deshecha)
                 VALUES (?, ?, NOW(), ?, ?, 0, 0)`,
                [data.idProveedor, data.nombreArchivo, data.idUsuario, data.filas.length]
            );
            const idImportacion = (insertCabecera as any).insertId;

            const idLista = await GetIdListaDefault(connection);
            const esDefault = await EsListaDefault(connection, idLista);

            for (const fila of data.filas) {
                // Estado anterior, con lock -- para el detalle (Deshacer) y para no pisar
                // sumarIva, que la importación nunca toca (handoff).
                const [filasProducto] = await connection.query(
                    `SELECT costo, precio, tipoPrecio, porcentaje, redondeo, sumarIva, idProveedor FROM productos WHERE id = ? FOR UPDATE`,
                    [fila.idProducto]
                );
                if (!Array.isArray(filasProducto) || filasProducto.length === 0) {
                    throw new Error(`Producto ${fila.idProducto} no encontrado al aplicar el lote.`);
                }
                const anterior = filasProducto[0] as any;
                const sumarIvaActual = !!anterior.sumarIva;

                await UpsertUnPrecio(connection, {
                    idProducto: fila.idProducto,
                    idLista,
                    tipoPrecio: fila.tipoPrecio,
                    costo: fila.costo,
                    precio: fila.precio,
                    redondeo: fila.redondeo,
                    porcentaje: fila.porcentaje,
                    sumarIva: sumarIvaActual,
                });

                if (esDefault) {
                    await connection.query(
                        `UPDATE productos SET costo=?, precio=?, tipoPrecio=?, porcentaje=?, redondeo=? WHERE id=?`,
                        [fila.costo, fila.precio, fila.tipoPrecio, fila.porcentaje, fila.redondeo, fila.idProducto]
                    );
                }

                await InsertarHistorialPrecios(connection, fila.idProducto, [{
                    idLista,
                    tipoPrecio: fila.tipoPrecio,
                    costo: fila.costo,
                    precio: fila.precio,
                    porcentaje: fila.porcentaje,
                    redondeo: fila.redondeo,
                    sumarIva: sumarIvaActual,
                }], data.idUsuario, 'IMPORTACION');

                // Relación producto-proveedor: se consulta ANTES de tocar nada, para saber si
                // el producto ya tenía algún proveedor cargado (invariante esPrincipal + espejo,
                // productosProveedoresRepository.ts) y si esta relación puntual ya existía.
                const [proveedoresExistentes] = await connection.query(
                    `SELECT idProveedor FROM productos_proveedores WHERE idProducto = ? FOR UPDATE`,
                    [fila.idProducto]
                );
                const filasProveedores = proveedoresExistentes as any[];
                // Se mira TAMBIEN el espejo productos.idProveedor, no solo la tabla: hubo 226
                // productos con el espejo cargado y sin fila acá (Agregar/Modificar escribían
                // uno sin el otro). Para esos, contar sólo filas daba "no tenía proveedor" y la
                // importación se auto-marcaba principal, pisando en silencio el proveedor que el
                // producto ya tenía. El backfill 20260925120000 repara los datos; esto evita que
                // una desincronización futura vuelva a producir el mismo efecto.
                const teniaAlgunProveedor = filasProveedores.length > 0 || anterior.idProveedor != null;
                const relacionYaExistia = filasProveedores.some(p => p.idProveedor === data.idProveedor);

                if (relacionYaExistia) {
                    await connection.query(
                        `UPDATE productos_proveedores SET codigoProveedor = ?, costo = ?, fechaActualizacion = NOW()
                         WHERE idProducto = ? AND idProveedor = ?`,
                        [fila.codigoArchivo, fila.costo, fila.idProducto, data.idProveedor]
                    );
                } else {
                    await connection.query(
                        `INSERT INTO productos_proveedores (idProducto, idProveedor, codigoProveedor, costo, esPrincipal, fechaActualizacion)
                         VALUES (?, ?, ?, ?, ?, NOW())`,
                        [fila.idProducto, data.idProveedor, fila.codigoArchivo, fila.costo, teniaAlgunProveedor ? 0 : 1]
                    );
                }
                const creoRelacionProveedor = !relacionYaExistia;

                // Sólo si el producto no tenía NINGÚN proveedor cargado se lo marca principal y
                // se sincroniza el espejo -- si ya tenía uno (este u otro), la importación nunca
                // cambia cuál es el principal (handoff, sección Aplicación). esPrincipal y
                // productos.idProveedor se escriben siempre juntos (invariante ya establecido).
                if (!teniaAlgunProveedor) {
                    await connection.query(
                        `UPDATE productos SET idProveedor = ? WHERE id = ?`,
                        [data.idProveedor, fila.idProducto]
                    );
                }

                await connection.query(
                    `INSERT INTO importaciones_costos_detalle
                        (idImportacion, idProducto, codigoArchivo, costoAnterior, precioAnterior,
                         tipoPrecioAnterior, porcentajeAnterior, redondeoAnterior,
                         costoNuevo, precioNuevo, creoRelacionProveedor)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        idImportacion, fila.idProducto, fila.codigoArchivo,
                        anterior.costo, anterior.precio,
                        anterior.tipoPrecio, anterior.porcentaje, anterior.redondeo,
                        fila.costo, fila.precio,
                        creoRelacionProveedor ? 1 : 0,
                    ]
                );
            }

            await connection.query(
                `UPDATE importaciones_costos SET filasAplicadas = ? WHERE id = ?`,
                [data.filas.length, idImportacion]
            );

            await connection.commit();
            // El lote es todo-o-nada: si algo falla, se tira excepción y se hace rollback (más
            // abajo) -- "errores" queda reservado para cuando este endpoint valide algo caso por
            // caso sin abortar el resto; hoy siempre viaja vacío en un aplicar exitoso.
            return { idImportacion, aplicadas: data.filas.length, errores: [] };

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Sólo se puede deshacer el último lote no deshecho de ese proveedor -- deshacer uno viejo
    // con lotes posteriores encima restauraría precios equivocados (handoff, sección Deshacer).
    async DeshacerImportacion(idImportacion: number, idUsuario: number): Promise<{ revertidas: number } | string> {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [cabeceras] = await connection.query(
                `SELECT id, idProveedor, deshecha FROM importaciones_costos WHERE id = ? FOR UPDATE`,
                [idImportacion]
            );
            if (!Array.isArray(cabeceras) || cabeceras.length === 0) {
                await connection.rollback();
                return "No se encontró la importación.";
            }
            const cabecera = cabeceras[0] as any;

            if (cabecera.deshecha) {
                await connection.rollback();
                return "Esta importación ya fue deshecha.";
            }

            const [ultimas] = await connection.query(
                `SELECT id FROM importaciones_costos WHERE idProveedor = ? AND deshecha = 0
                 ORDER BY fecha DESC, id DESC LIMIT 1`,
                [cabecera.idProveedor]
            );
            const ultima = (ultimas as any[])[0];
            if (!ultima || ultima.id !== idImportacion) {
                await connection.rollback();
                return "Sólo se puede deshacer la última importación de este proveedor.";
            }

            const [detalleRows] = await connection.query(
                `SELECT * FROM importaciones_costos_detalle WHERE idImportacion = ?`,
                [idImportacion]
            );
            const detalle = detalleRows as any[];

            const idLista = await GetIdListaDefault(connection);
            const esDefault = await EsListaDefault(connection, idLista);

            for (const fila of detalle) {
                const [filasProducto] = await connection.query(
                    `SELECT sumarIva FROM productos WHERE id = ? FOR UPDATE`,
                    [fila.idProducto]
                );
                const sumarIvaActual = (filasProducto as any[]).length > 0 ? !!(filasProducto as any[])[0].sumarIva : false;
                const tipoPrecioAnterior = fila.tipoPrecioAnterior ?? '$';
                const redondeoAnterior = fila.redondeoAnterior ?? 0;

                await UpsertUnPrecio(connection, {
                    idProducto: fila.idProducto,
                    idLista,
                    tipoPrecio: tipoPrecioAnterior,
                    costo: fila.costoAnterior,
                    precio: fila.precioAnterior,
                    redondeo: redondeoAnterior,
                    porcentaje: fila.porcentajeAnterior,
                    sumarIva: sumarIvaActual,
                });

                if (esDefault) {
                    await connection.query(
                        `UPDATE productos SET costo=?, precio=?, tipoPrecio=?, porcentaje=?, redondeo=? WHERE id=?`,
                        [fila.costoAnterior, fila.precioAnterior, tipoPrecioAnterior, fila.porcentajeAnterior, redondeoAnterior, fila.idProducto]
                    );
                }

                // El deshacer también deja rastro en el historial (handoff).
                await InsertarHistorialPrecios(connection, fila.idProducto, [{
                    idLista,
                    tipoPrecio: tipoPrecioAnterior,
                    costo: fila.costoAnterior ?? 0,
                    precio: fila.precioAnterior ?? 0,
                    porcentaje: fila.porcentajeAnterior,
                    redondeo: redondeoAnterior,
                    sumarIva: sumarIvaActual,
                }], idUsuario, 'IMPORTACION');

                if (fila.creoRelacionProveedor) {
                    const [relacion] = await connection.query(
                        `SELECT id, esPrincipal FROM productos_proveedores WHERE idProducto = ? AND idProveedor = ? FOR UPDATE`,
                        [fila.idProducto, cabecera.idProveedor]
                    );
                    const filaRelacion = (relacion as any[])[0];
                    if (filaRelacion) {
                        await connection.query(`DELETE FROM productos_proveedores WHERE id = ?`, [filaRelacion.id]);
                        if (filaRelacion.esPrincipal) {
                            // Por construcción no queda otro proveedor: esta relación se creó
                            // porque el producto no tenía ninguna -- el espejo vuelve a NULL.
                            await connection.query(`UPDATE productos SET idProveedor = NULL WHERE id = ?`, [fila.idProducto]);
                        }
                    }
                }
            }

            await connection.query(
                `UPDATE importaciones_costos SET deshecha = 1, fechaDeshecha = NOW() WHERE id = ?`,
                [idImportacion]
            );

            await connection.commit();
            return { revertidas: detalle.length };

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Cabecera del último lote no deshecho de un proveedor -- para que la pantalla ofrezca
    // "Deshacer última importación" (handoff, endpoint 5).
    async ObtenerUltimaImportacion(idProveedor: number): Promise<any | null> {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                `SELECT id, idProveedor, nombreArchivo, fecha, filasArchivo, filasAplicadas
                 FROM importaciones_costos WHERE idProveedor = ? AND deshecha = 0
                 ORDER BY fecha DESC, id DESC LIMIT 1`,
                [idProveedor]
            );
            const filas = rows as any[];
            return filas.length > 0 ? filas[0] : null;
        } finally {
            connection.release();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────────────────────────────────────

// Misma normalización que usa todo el módulo de proveedores.
function Normalizar(v: any): string {
    return (v ?? '').toString().replace(/\s+/g, ' ').trim().toUpperCase();
}

async function ConsultarPorLotes(
    connection: any,
    codigos: string[],
    armarQuery: (lote: string[]) => { sql: string; params: any[] }
): Promise<any[]> {
    const resultado: any[] = [];
    for (let i = 0; i < codigos.length; i += TAMANIO_LOTE) {
        const lote = codigos.slice(i, i + TAMANIO_LOTE);
        const { sql, params } = armarQuery(lote);
        const [rows] = await connection.query(sql, params);
        resultado.push(...(rows as any[]));
    }
    return resultado;
}

// Agrupa las filas encontradas por código normalizado; si un código resuelve a más de un
// producto dentro del mismo nivel, se marca ambiguo -- nunca se elige uno (handoff).
function AcumularMatches(
    destino: Map<string, MatchResultado>,
    filas: any[],
    matcheoPor: 'PROVEEDOR' | 'CODIGO'
): void {
    const porCodigo = new Map<string, any[]>();
    for (const fila of filas) {
        if (!porCodigo.has(fila.codigoMatch)) porCodigo.set(fila.codigoMatch, []);
        porCodigo.get(fila.codigoMatch)!.push(fila);
    }

    for (const [codigo, filasCodigo] of porCodigo) {
        if (filasCodigo.length > 1) {
            destino.set(codigo, { ambiguo: true });
            continue;
        }
        const f = filasCodigo[0];
        destino.set(codigo, {
            ambiguo: false,
            idProducto: f.idProducto,
            codigoProducto: f.codigoProducto,
            nombre: f.nombre,
            costoActual: f.costo != null ? Number(f.costo) : null,
            precioActual: f.precio != null ? Number(f.precio) : null,
            matcheoPor,
        });
    }
}

export const ImportacionCostosRepo = new ImportacionCostosRepository();
