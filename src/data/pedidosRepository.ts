import db from '../db';
import { Pedido, EstadoPedido, ESTADOS_PEDIDO_ACTIVOS, DestinoSenia, SeniaInicial } from '../models/Pedido';
import { DetallePedido } from '../models/DetallePedido';
import { Cliente } from '../models/Cliente';
import { Producto } from '../models/Producto';
import { Auditoria } from '../models/Evento';
import { EventosRepo } from './eventosRepository';
import { CajasRepo } from './cajasRepository';
import { MovimientosRepo } from './movimientosRepository';
import { MEDIO_EFECTIVO, MEDIO_SENIA, MEDIOS_NO_VALIDOS_PARA_SENIA, esMedio } from '../utils/mediosPago';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { esDeadlock, MENSAJE_CONCURRENCIA } from '../utils/concurrencia';
import { ResultSetHeader } from 'mysql2';
const moment = require('moment');

// Pedidos de clientes con seña. Ver documentos/handoff_pedidos.md.
//
// Reglas que este repo hace cumplir (no el front):
// - Estados fijos. A mano solo entre pendiente / en_proceso / listo. 'entregado' lo pone la venta
//   (MarcarEntregado, misma transacción que ventasRepository.Agregar) y 'cancelado' solo Cancelar.
// - Todo cambio de estado queda en pedidos_estados_historial y en `eventos` (auditoría, §12.3).
// - Orden global de locks (architecture.md §11.2): caja -> pedido -> cliente -> productos. Los métodos
//   que tocan caja (RegistrarPago, AnularPago, Cancelar con devolución, Agregar con seña en efectivo) bloquean
//   la caja ANTES que el pedido; ventasRepository.Agregar hace lo mismo antes de BloquearParaEntrega.
// - La seña neta se calcula SIEMPRE en el servidor desde pedidos_pagos (nunca se persiste ni se confía en el front):
//   SUM(pago no anulado) - SUM(devolucion no anulada).
// - Solo la seña en EFECTIVO toca la caja (movimiento origen 'pedido'). Nada se borra: anular = marcar + compensar.

const MAX_OBSERVACIONES = 500;
const MAX_CONTACTO_NOMBRE = 100;
const MAX_CONTACTO_TELEFONO = 30;
const MAX_MOTIVO = 255;
const CONSUMIDOR_FINAL = 1;
const TOLERANCIA = 0.01;

function r2(n: any): number {
    return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

function errorValidacion(mensaje: string, status = 400, contexto: object = {}): AppError {
    return new AppError(CodigoError.VALIDACION, mensaje, status, { modulo: 'PedidosRepo', ...contexto });
}

// Un deadlock de InnoDB se informa como conflicto 409 (la operación es segura de reintentar a mano).
function traducirError(error: any, contexto: object): any {
    if (error instanceof AppError) return error;
    if (esDeadlock(error)) {
        return new AppError(CodigoError.OPERACION_CONCURRENTE, MENSAJE_CONCURRENCIA, 409, { modulo: 'PedidosRepo', ...contexto }, error);
    }
    return error;
}

function textoOpcional(valor: any, max: number, campo: string): string | null {
    if (valor === undefined || valor === null) return null;
    const t = String(valor).trim();
    if (!t) return null;
    if (t.length > max) throw errorValidacion(`${campo} no puede superar los ${max} caracteres.`);
    return t;
}

function fechaOpcional(valor: any, campo: string): string | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const m = moment(valor);
    if (!m.isValid()) throw errorValidacion(`${campo} no es una fecha válida.`);
    return m.format('YYYY-MM-DD');
}

// Normaliza y valida lo que viene del front. Devuelve los valores listos para el INSERT/UPDATE.
function validarPedido(pedido: Pedido) {
    if (!pedido || !(Number(pedido.idCliente) > 0)) throw errorValidacion('Falta el cliente del pedido.');
    if (!Array.isArray(pedido.detalles) || pedido.detalles.length === 0) {
        throw errorValidacion('El pedido no tiene productos.');
    }

    let suma = 0;
    for (const d of pedido.detalles) {
        if (!(Number(d.idProducto) > 0)) throw errorValidacion('Hay un producto inválido en el pedido.');
        if (!(Number(d.cantidad) > 0)) throw errorValidacion(`La cantidad de "${d.nomProd}" tiene que ser mayor a 0.`);
        if (!(Number(d.precio) >= 0) || !(Number(d.total) >= 0)) throw errorValidacion(`El precio de "${d.nomProd}" es inválido.`);
        suma += Number(d.total);
    }
    const total = r2(pedido.total);
    if (!(total > 0)) throw errorValidacion('El total del pedido tiene que ser mayor a 0.');
    if (Math.abs(r2(suma) - total) > TOLERANCIA) {
        throw errorValidacion('El total del pedido no coincide con la suma de sus productos.');
    }

    const esCF = Number(pedido.idCliente) === CONSUMIDOR_FINAL;
    return {
        total,
        fechaEntregaEstimada: fechaOpcional(pedido.fechaEntregaEstimada, 'La fecha de entrega estimada'),
        observaciones: textoOpcional(pedido.observaciones, MAX_OBSERVACIONES, 'Las observaciones'),
        // El contacto libre solo aplica a consumidor final; si es un cliente registrado, el teléfono sale del cliente.
        contactoNombre: esCF ? textoOpcional(pedido.contactoNombre, MAX_CONTACTO_NOMBRE, 'El nombre de contacto') : null,
        contactoTelefono: esCF ? textoOpcional(pedido.contactoTelefono, MAX_CONTACTO_TELEFONO, 'El teléfono de contacto') : null,
    };
}

function mapearPedido(row: any): Pedido {
    const p = new Pedido();
    p.id                    = row['id'];
    p.idCliente             = row['idCliente'];
    p.idUsuario             = row['idUsuario'];
    p.idCaja                = row['idCaja'];
    p.fecha                 = row['fecha'];
    p.fechaEntregaEstimada  = row['fechaEntregaEstimada'];
    p.total                 = parseFloat(row['total']);
    p.estado                = row['estado'];
    p.observaciones         = row['observaciones'];
    p.contactoNombre        = row['contactoNombre'];
    p.contactoTelefono      = row['contactoTelefono'];
    p.idVentaGenerada       = row['idVentaGenerada'];
    p.fechaModificacion     = row['fechaModificacion'];
    p.idUsuarioModifico     = row['idUsuarioModifico'];
    p.fechaCancelacion      = row['fechaCancelacion'];
    p.idUsuarioCancelo      = row['idUsuarioCancelo'];
    p.motivoCancelacion     = row['motivoCancelacion'];
    p.destinoSenia          = row['destinoSenia'] ?? null;
    p.senaNeta              = r2(row['senaNeta']);
    p.saldo                 = r2(p.total - p.senaNeta);
    p.cliente = new Cliente({ id: row['idCliente'], nombre: row['cliente'], telefono: row['clienteTelefono'] });
    return p;
}

async function insertarDetalles(connection: any, idPedido: number, detalles: DetallePedido[]) {
    for (const d of detalles) {
        await connection.query(
            `INSERT INTO pedidos_detalle (idPedido, idProducto, nomProd, cantidad, precio, costo, total)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [idPedido, d.idProducto, d.nomProd, d.cantidad, d.precio, d.costo ?? 0, d.total]
        );
    }
}

class PedidosRepository {

    //#region HELPERS TRANSACCIONALES (los usan este repo y ventasRepository)

    async RegistrarHistorial(connection: any, idPedido: number, estadoAnterior: string | null,
                             estadoNuevo: string, idUsuario: number | null, observacion?: string | null): Promise<void> {
        await connection.query(
            `INSERT INTO pedidos_estados_historial (idPedido, estadoAnterior, estadoNuevo, idUsuario, observacion)
             VALUES (?, ?, ?, ?, ?)`,
            [idPedido, estadoAnterior, estadoNuevo, idUsuario, observacion ? String(observacion).slice(0, 255) : null]
        );
    }

    // SELECT ... FOR UPDATE del pedido. Falla con 404 si no existe.
    async Bloquear(connection: any, idPedido: number): Promise<any> {
        const [rows]: any = await connection.query('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [idPedido]);
        if (!rows[0]) throw new AppError(CodigoError.NOT_FOUND, 'El pedido no existe.', 404, { modulo: 'PedidosRepo', idPedido });
        return rows[0];
    }

    // Lo llama ventasRepository.Agregar ANTES de insertar la venta (después de bloquear la caja).
    // El FOR UPDATE evita la doble entrega concurrente: la segunda venta espera y ve 'entregado'.
    async BloquearParaEntrega(connection: any, idPedido: number): Promise<any> {
        const [rows]: any = await connection.query('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [idPedido]);
        const pedido = rows[0];
        if (!pedido || !(ESTADOS_PEDIDO_ACTIVOS as readonly string[]).includes(pedido.estado)) {
            throw errorValidacion('El pedido ya fue entregado, cancelado o no existe.', 409, { idPedido });
        }
        return pedido;
    }

    // Lo llama ventasRepository.Agregar al final, en la misma transacción que la venta.
    async MarcarEntregado(connection: any, pedido: any, idVenta: number, auditoria: Auditoria): Promise<void> {
        await connection.query(
            `UPDATE pedidos SET estado = 'entregado', idVentaGenerada = ?, fechaModificacion = NOW(), idUsuarioModifico = ?
             WHERE id = ?`,
            [idVenta, auditoria.usuarioId, pedido.id]
        );
        await this.RegistrarHistorial(connection, pedido.id, pedido.estado, 'entregado', auditoria.usuarioId, `Entregado con la venta #${idVenta}`);
        await EventosRepo.Registrar(connection, {
            accion: 'PEDIDO_ENTREGAR',
            entidad: 'pedidos',
            entidadId: pedido.id,
            datosAntes: { estado: pedido.estado },
            datosDespues: { estado: 'entregado', idVenta, total: r2(pedido.total) },
            descripcion: `Pedido #${pedido.id} entregado con la venta #${idVenta}`,
            auditoria,
        });
    }

    // Lo llama ventasRepository.Eliminar (baja de la venta sin NC): el pedido vuelve a 'listo'.
    // La NC no pasa por acá: no toca el pedido (handoff §4.1).
    async RevertirEntregaPorVenta(connection: any, idVenta: number, auditoria: Auditoria): Promise<void> {
        const [rows]: any = await connection.query(
            `SELECT * FROM pedidos WHERE idVentaGenerada = ? FOR UPDATE`, [idVenta]
        );
        const pedido = rows[0];
        if (!pedido) return;

        await connection.query(
            `UPDATE pedidos SET estado = 'listo', idVentaGenerada = NULL, fechaModificacion = NOW(), idUsuarioModifico = ?
             WHERE id = ?`,
            [auditoria.usuarioId, pedido.id]
        );
        await this.RegistrarHistorial(connection, pedido.id, pedido.estado, 'listo', auditoria.usuarioId, `Venta #${idVenta} dada de baja`);
        await EventosRepo.Registrar(connection, {
            accion: 'PEDIDO_ESTADO',
            entidad: 'pedidos',
            entidadId: pedido.id,
            datosAntes: { estado: pedido.estado, idVenta },
            datosDespues: { estado: 'listo' },
            descripcion: `Pedido #${pedido.id} vuelve a Listo: se dio de baja la venta #${idVenta}`,
            auditoria,
        });
    }
    //#endregion

    //#region SEÑA (helpers transaccionales)

    // Seña neta del pedido, calculada en la base. Llamar con el pedido bloqueado.
    async SenaNeta(connection: any, idPedido: number): Promise<number> {
        const [rows]: any = await connection.query(
            `SELECT COALESCE(SUM(CASE WHEN tipo = 'pago' THEN monto ELSE -monto END), 0) AS neta
             FROM pedidos_pagos WHERE idPedido = ? AND anulado = 0`, [idPedido]
        );
        return r2(rows[0]?.neta);
    }

    private async medioPorId(connection: any, idTipoPago: number): Promise<{ id: number; nombre: string }> {
        const [rows]: any = await connection.query('SELECT id, nombre FROM tipos_pago WHERE id = ?', [idTipoPago]);
        if (!rows[0]) throw errorValidacion('El medio de pago de la seña no existe.');
        return { id: rows[0].id, nombre: rows[0].nombre };
    }

    // Lo llama ventasRepository.Agregar antes de insertar la venta (pedido ya bloqueado, o null si la venta no es de un
    // pedido). El medio SEÑA se identifica por el nombre que figura en la base (no el que manda el front).
    // - Con seña neta > 0: tiene que venir exactamente UN detalle SEÑA por ese monto, a nombre del cliente del pedido.
    // - Sin seña (o sin pedido): no puede venir ningún detalle SEÑA.
    async ValidarSeniaEnVenta(connection: any, pedido: any | null, venta: any): Promise<void> {
        const detalles: any[] = (venta.detallePago ?? []).filter((d: any) => Number(d?.monto) > 0);
        const ids = [...new Set(detalles.map(d => Number(d.tipoPago?.id)).filter(n => n > 0))];
        let idsSenia: number[] = [];
        if (ids.length) {
            const [rows]: any = await connection.query(
                `SELECT id FROM tipos_pago WHERE id IN (${ids.map(() => '?').join(',')}) AND nombre = ?`, [...ids, MEDIO_SENIA]
            );
            idsSenia = rows.map((r: any) => Number(r.id));
        }
        const detalleSenia = detalles.filter(d => idsSenia.includes(Number(d.tipoPago?.id)));

        const contexto = { modulo: 'PedidosRepo', metodo: 'ValidarSeniaEnVenta', idPedido: pedido?.id ?? null };
        if (!pedido) {
            if (detalleSenia.length) throw errorValidacion('El medio "Seña" solo se puede usar al entregar un pedido.', 400, contexto);
            return;
        }

        const senaNeta = await this.SenaNeta(connection, pedido.id);
        if (senaNeta <= 0) {
            if (detalleSenia.length) throw errorValidacion('El pedido no tiene seña cobrada: no se puede usar el medio "Seña".', 400, contexto);
            return;
        }
        if (detalleSenia.length !== 1 || Math.abs(r2(detalleSenia[0].monto) - senaNeta) > TOLERANCIA) {
            throw errorValidacion(`El pedido tiene $${senaNeta} de seña cobrada: la venta tiene que aplicarla completa con el medio "Seña". Actualizá la pantalla y reintentá.`, 409, contexto);
        }
        if (r2(venta.total) - senaNeta < -TOLERANCIA) {
            throw errorValidacion(`El total de la venta ($${r2(venta.total)}) es menor a la seña cobrada ($${senaNeta}).`, 400, contexto);
        }
        if (Number(venta.cliente?.id) !== Number(pedido.idCliente)) {
            throw errorValidacion('El pedido tiene seña cobrada: la venta tiene que ser al mismo cliente del pedido.', 400, contexto);
        }
    }

    // Valida y normaliza una seña. No toca la base más que para leer el medio.
    private async validarSenia(connection: any, senia: SeniaInicial) {
        const monto = r2(senia?.monto);
        if (!(monto > 0)) throw errorValidacion('El monto de la seña tiene que ser mayor a 0.');
        if (monto > 99999999.99) throw errorValidacion('El monto de la seña es demasiado grande.');
        if (!(Number(senia.idTipoPago) > 0)) throw errorValidacion('Falta el medio de pago de la seña.');
        const medio = await this.medioPorId(connection, Number(senia.idTipoPago));
        if (MEDIOS_NO_VALIDOS_PARA_SENIA.some(m => esMedio(medio.nombre, m))) {
            throw errorValidacion(`"${medio.nombre}" no se puede usar para cobrar una seña.`);
        }
        const esEfectivo = esMedio(medio.nombre, MEDIO_EFECTIVO);
        const idCaja = senia.idCaja != null && Number(senia.idCaja) !== 0 ? Number(senia.idCaja) : null;
        if (esEfectivo && !idCaja) {
            throw errorValidacion('Para cobrar una seña en efectivo tenés que tener una caja abierta.');
        }
        return { monto, medio, esEfectivo, idCaja: esEfectivo ? idCaja : null };
    }

    // Inserta el pago y, si es efectivo, su movimiento de caja (origen 'pedido'). La caja ya debe estar bloqueada
    // y abierta por el caller (orden de locks) y el pedido bloqueado.
    private async insertarPago(connection: any, idPedido: number, tipo: 'pago' | 'devolucion', medio: { id: number },
                               monto: number, idCaja: number | null, auditoria: Auditoria): Promise<number> {
        const [res]: [ResultSetHeader, any] = await connection.query(
            `INSERT INTO pedidos_pagos (idPedido, idUsuario, tipo, idTipoPago, monto, idCaja)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [idPedido, auditoria.usuarioId, tipo, medio.id, monto, idCaja]
        );
        const idPago = res.insertId;

        if (idCaja) {
            await MovimientosRepo.Agregar({
                idCaja,
                tipoMovimiento: tipo === 'pago' ? 'ENTRADA' : 'SALIDA',
                monto,
                descripcion: tipo === 'pago' ? `Seña pedido #${idPedido}` : `Devolución de seña pedido #${idPedido}`,
                idPedidoPago: idPago,
                origenMov: 'pedido',
                origen: tipo === 'pago' ? 'pedido_senia' : 'pedido_devolucion',
            }, connection, auditoria);
        }
        return idPago;
    }
    //#endregion

    //#region AGREGAR
    async Agregar(pedido: Pedido, auditoria: Auditoria): Promise<number> {
        const datos = validarPedido(pedido);
        // Identidad solo del header (auditoria.ts): nunca se completa con el body.
        const idUsuario = auditoria.usuarioId;
        if (!idUsuario) throw errorValidacion('No se pudo identificar al usuario que crea el pedido.');

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Seña inicial (opcional): la caja (si es efectivo) se bloquea ANTES de crear el pedido (orden de locks).
            let senia: Awaited<ReturnType<PedidosRepository['validarSenia']>> | null = null;
            if (pedido.senia && Number(pedido.senia.monto) > 0) {
                senia = await this.validarSenia(connection, pedido.senia);
                if (senia.monto - datos.total > TOLERANCIA) {
                    throw errorValidacion('La seña no puede superar el total del pedido.');
                }
                if (senia.idCaja) await CajasRepo.AsegurarAbierta(connection, senia.idCaja);
            }

            const [result] = await connection.query<ResultSetHeader>(
                `INSERT INTO pedidos (idCliente, idUsuario, idCaja, fecha, fechaEntregaEstimada, total, estado,
                                      observaciones, contactoNombre, contactoTelefono)
                 VALUES (?, ?, ?, CURDATE(), ?, ?, 'pendiente', ?, ?, ?)`,
                [pedido.idCliente, idUsuario, pedido.idCaja ?? null, datos.fechaEntregaEstimada, datos.total,
                 datos.observaciones, datos.contactoNombre, datos.contactoTelefono]
            );
            const idPedido: number = result.insertId;

            await insertarDetalles(connection, idPedido, pedido.detalles);
            await this.RegistrarHistorial(connection, idPedido, null, 'pendiente', idUsuario);

            const auditoriaPedido = { usuarioId: idUsuario, puestoId: auditoria.puestoId };
            if (senia) {
                const idPago = await this.insertarPago(connection, idPedido, 'pago', senia.medio, senia.monto, senia.idCaja, auditoriaPedido);
                await EventosRepo.Registrar(connection, {
                    accion: 'PEDIDO_PAGO',
                    entidad: 'pedidos',
                    entidadId: idPedido,
                    datosDespues: { idPago, tipo: 'pago', monto: senia.monto, medio: senia.medio.nombre, idCaja: senia.idCaja },
                    descripcion: `Seña de $${senia.monto} (${senia.medio.nombre}) al crear el pedido #${idPedido}`,
                    auditoria: auditoriaPedido,
                });
            }

            await EventosRepo.Registrar(connection, {
                accion: 'PEDIDO_CREAR',
                entidad: 'pedidos',
                entidadId: idPedido,
                datosDespues: {
                    total: datos.total,
                    idCliente: pedido.idCliente,
                    idCaja: pedido.idCaja ?? null,
                    items: pedido.detalles.length,
                    fechaEntregaEstimada: datos.fechaEntregaEstimada,
                    senia: senia ? senia.monto : 0,
                },
                descripcion: `Pedido #${idPedido} - $${datos.total}`,
                auditoria: auditoriaPedido,
            });

            await connection.commit();
            return idPedido;

        } catch (error: any) {
            await connection.rollback();
            throw traducirError(error, { metodo: 'Agregar' });
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region OBTENER
    async Obtener(filtros: any) {
        const connection = await db.getConnection();

        try {
            let filtro = '';
            const params: any[] = [];

            if (filtros.idCliente) {
                filtro += ' AND p.idCliente = ?';
                params.push(filtros.idCliente);
            }
            if (filtros.cliente) {
                filtro += ' AND (c.nombre LIKE ? OR p.contactoNombre LIKE ?)';
                params.push(`%${filtros.cliente}%`, `%${filtros.cliente}%`);
            }
            // `estados` (lista) permite el chip "Activos" = pendiente + en_proceso + listo.
            const estados: string[] = Array.isArray(filtros.estados) ? filtros.estados
                                    : filtros.estado ? [filtros.estado] : [];
            if (estados.length) {
                filtro += ` AND p.estado IN (${estados.map(() => '?').join(',')})`;
                params.push(...estados);
            }
            if (filtros.fechaDesde) {
                filtro += ' AND p.fecha >= ?';
                params.push(moment(filtros.fechaDesde).format('YYYY-MM-DD'));
            }
            if (filtros.fechaHasta) {
                filtro += ' AND p.fecha <= ?';
                params.push(moment(filtros.fechaHasta).format('YYYY-MM-DD'));
            }

            const limit  = filtros.tamanioPagina ?? 20;
            const offset = ((filtros.pagina ?? 1) - 1) * limit;

            const queryRegistros = `
                SELECT p.*, COALESCE(c.nombre, 'ELIMINADO') AS cliente, c.telefono AS clienteTelefono,
                       (SELECT COALESCE(SUM(CASE WHEN pp.tipo = 'pago' THEN pp.monto ELSE -pp.monto END), 0)
                            FROM pedidos_pagos pp WHERE pp.idPedido = p.id AND pp.anulado = 0) AS senaNeta
                FROM pedidos p
                LEFT JOIN clientes c ON c.id = p.idCliente
                WHERE 1 = 1 ${filtro}
                ORDER BY p.id DESC
                LIMIT ? OFFSET ?
            `;
            const queryTotal = `
                SELECT COUNT(*) AS total
                FROM pedidos p
                LEFT JOIN clientes c ON c.id = p.idCliente
                WHERE 1 = 1 ${filtro}
            `;

            const [rows]        = await connection.query(queryRegistros, [...params, limit, offset]);
            const [totalResult] = await connection.query(queryTotal, params);

            const pedidos: Pedido[] = Array.isArray(rows) ? (rows as any[]).map(mapearPedido) : [];
            return { total: (totalResult as any[])[0].total, registros: pedidos };

        } finally {
            connection.release();
        }
    }

    async ObtenerPorId(id: number): Promise<Pedido | null> {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                `SELECT p.*, COALESCE(c.nombre, 'ELIMINADO') AS cliente, c.telefono AS clienteTelefono,
                        (SELECT COALESCE(SUM(CASE WHEN pp.tipo = 'pago' THEN pp.monto ELSE -pp.monto END), 0)
                            FROM pedidos_pagos pp WHERE pp.idPedido = p.id AND pp.anulado = 0) AS senaNeta
                 FROM pedidos p
                 LEFT JOIN clientes c ON c.id = p.idCliente
                 WHERE p.id = ?`,
                [id]
            );
            if (!Array.isArray(rows) || !rows[0]) return null;
            return mapearPedido(rows[0]);

        } finally {
            connection.release();
        }
    }

    async ObtenerDetalle(id: number): Promise<DetallePedido[]> {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                `SELECT pd.*,
                        COALESCE(p.nombre, 'ELIMINADO') AS producto,
                        p.soloPrecio,
                        p.codigo,
                        p.unidad
                 FROM pedidos_detalle pd
                 LEFT JOIN productos p ON p.id = pd.idProducto
                 WHERE pd.idPedido = ?
                 ORDER BY pd.id ASC`,
                [id]
            );

            const detalles: DetallePedido[] = [];
            if (Array.isArray(rows)) {
                for (const row of rows as any[]) {
                    const d         = new DetallePedido();
                    d.id            = row['id'];
                    d.idPedido      = row['idPedido'];
                    d.idProducto    = row['idProducto'];
                    d.nomProd       = row['nomProd'];
                    d.cantidad      = parseFloat(row['cantidad']);
                    d.precio        = parseFloat(row['precio']);
                    d.costo         = parseFloat(row['costo']);
                    d.total         = parseFloat(row['total']);
                    d.producto      = new Producto({
                        id:         row['idProducto'],
                        nombre:     row['producto'],
                        codigo:     row['codigo'],
                        unidad:     row['unidad'],
                        soloPrecio: row['soloPrecio'] == 1,
                        precio:     parseFloat(row['precio']),
                        costo:      parseFloat(row['costo']),
                    });
                    detalles.push(d);
                }
            }
            return detalles;

        } finally {
            connection.release();
        }
    }

    async ObtenerPagos(id: number) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                `SELECT pp.id, pp.fecha, pp.tipo, pp.monto, pp.idTipoPago, tp.nombre AS medio, pp.idCaja,
                        pp.anulado, pp.fechaAnulacion, u.nombre AS usuario
                 FROM pedidos_pagos pp
                 LEFT JOIN tipos_pago tp ON tp.id = pp.idTipoPago
                 LEFT JOIN usuarios u ON u.id = pp.idUsuario
                 WHERE pp.idPedido = ?
                 ORDER BY pp.id ASC`,
                [id]
            );
            return (rows as any[]).map(r => ({
                id: r.id, fecha: r.fecha, tipo: r.tipo, monto: r2(r.monto), idTipoPago: r.idTipoPago,
                medio: r.medio, idCaja: r.idCaja, anulado: Number(r.anulado) === 1,
                fechaAnulacion: r.fechaAnulacion, usuario: r.usuario ?? null,
            }));

        } finally {
            connection.release();
        }
    }

    async ObtenerHistorial(id: number) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                `SELECT h.id, h.estadoAnterior, h.estadoNuevo, h.fecha, h.observacion, h.idUsuario,
                        u.nombre AS usuario
                 FROM pedidos_estados_historial h
                 LEFT JOIN usuarios u ON u.id = h.idUsuario
                 WHERE h.idPedido = ?
                 ORDER BY h.id ASC`,
                [id]
            );
            return rows;

        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region EDITAR
    // Reemplaza los detalles y recalcula el total. Solo en pendiente / en_proceso / listo.
    // El FOR UPDATE evita que se edite mientras se está entregando (ventasRepository.Agregar bloquea la misma fila).
    async Editar(id: number, pedido: Pedido, auditoria: Auditoria): Promise<void> {
        const datos = validarPedido(pedido);

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const actual = await this.Bloquear(connection, id);
            if (!(ESTADOS_PEDIDO_ACTIVOS as readonly string[]).includes(actual.estado)) {
                throw errorValidacion(`El pedido está ${actual.estado} y ya no se puede editar.`, 409, { idPedido: id });
            }
            // El total no puede quedar por debajo de lo ya cobrado como seña (handoff §2.6).
            const senaNeta = await this.SenaNeta(connection, id);
            // Con seña cobrada no se cambia el cliente: la seña es de ese cliente y la entrega se valida contra él
            // (ValidarSeniaEnVenta). Regla 2026-11-23, handoff §2.8.
            if (senaNeta > 0 && Number(pedido.idCliente) !== Number(actual.idCliente)) {
                throw errorValidacion(`El pedido tiene $${senaNeta} de seña cobrada: no se puede cambiar el cliente. Anulá o devolvé la seña primero.`, 409, { idPedido: id });
            }
            if (senaNeta - datos.total > TOLERANCIA) {
                throw errorValidacion(`El nuevo total ($${datos.total}) es menor a la seña ya cobrada ($${senaNeta}). Anulá o devolvé parte de la seña primero.`, 400, { idPedido: id });
            }

            await connection.query(
                `UPDATE pedidos
                 SET idCliente = ?, total = ?, fechaEntregaEstimada = ?, observaciones = ?,
                     contactoNombre = ?, contactoTelefono = ?, fechaModificacion = NOW(), idUsuarioModifico = ?
                 WHERE id = ?`,
                [pedido.idCliente, datos.total, datos.fechaEntregaEstimada, datos.observaciones,
                 datos.contactoNombre, datos.contactoTelefono, auditoria.usuarioId, id]
            );

            await connection.query('DELETE FROM pedidos_detalle WHERE idPedido = ?', [id]);
            await insertarDetalles(connection, id, pedido.detalles);

            await EventosRepo.Registrar(connection, {
                accion: 'PEDIDO_EDITAR',
                entidad: 'pedidos',
                entidadId: id,
                datosAntes: { total: r2(actual.total), idCliente: actual.idCliente },
                datosDespues: { total: datos.total, idCliente: pedido.idCliente, items: pedido.detalles.length,
                                fechaEntregaEstimada: datos.fechaEntregaEstimada },
                descripcion: `Pedido #${id} editado - $${r2(actual.total)} -> $${datos.total}`,
                auditoria,
            });

            await connection.commit();

        } catch (error: any) {
            await connection.rollback();
            throw traducirError(error, { metodo: 'Editar', idPedido: id });
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region CAMBIAR ESTADO (manual)
    async CambiarEstado(id: number, nuevo: EstadoPedido, observacion: string | null | undefined, auditoria: Auditoria): Promise<void> {
        if (!(ESTADOS_PEDIDO_ACTIVOS as readonly string[]).includes(nuevo)) {
            throw errorValidacion('A mano solo se puede pasar a Pendiente, En proceso o Listo. Entregar se hace desde la venta y cancelar con Cancelar.');
        }
        const obs = textoOpcional(observacion, 255, 'La observación');

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const actual = await this.Bloquear(connection, id);
            if (!(ESTADOS_PEDIDO_ACTIVOS as readonly string[]).includes(actual.estado)) {
                throw errorValidacion(`El pedido está ${actual.estado} y su estado ya no se puede cambiar.`, 409, { idPedido: id });
            }
            if (actual.estado === nuevo) {
                throw errorValidacion('El pedido ya está en ese estado.', 409, { idPedido: id });
            }

            await connection.query(
                `UPDATE pedidos SET estado = ?, fechaModificacion = NOW(), idUsuarioModifico = ? WHERE id = ?`,
                [nuevo, auditoria.usuarioId, id]
            );
            await this.RegistrarHistorial(connection, id, actual.estado, nuevo, auditoria.usuarioId, obs);

            await EventosRepo.Registrar(connection, {
                accion: 'PEDIDO_ESTADO',
                entidad: 'pedidos',
                entidadId: id,
                datosAntes: { estado: actual.estado },
                datosDespues: { estado: nuevo },
                descripcion: `Pedido #${id}: ${actual.estado} -> ${nuevo}`,
                auditoria,
            });

            await connection.commit();

        } catch (error: any) {
            await connection.rollback();
            throw traducirError(error, { metodo: 'CambiarEstado', idPedido: id });
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region CANCELAR
    // Con seña neta > 0 hay que elegir qué pasa con la plata (handoff §2.2):
    //  - 'devuelta': se registra una devolución (SALIDA en efectivo) en la caja abierta actual (opciones.idCaja).
    //  - 'retenida': la seña queda en el pedido cancelado y no se mueve la caja.
    // Sin seña, destinoSenia se ignora.
    async Cancelar(id: number, motivo: string | null | undefined, auditoria: Auditoria,
                   opciones?: { destinoSenia?: DestinoSenia; idCaja?: number | null }): Promise<void> {
        const mot = textoOpcional(motivo, MAX_MOTIVO, 'El motivo');
        const destino = opciones?.destinoSenia;
        if (destino !== undefined && destino !== null && destino !== 'devuelta' && destino !== 'retenida') {
            throw errorValidacion('El destino de la seña no es válido.');
        }
        const idCajaDev = opciones?.idCaja != null && Number(opciones.idCaja) !== 0 ? Number(opciones.idCaja) : null;

        const connection = await db.getConnection();
        try {
            // Lectura previa SIN lock y FUERA de la transacción, solo para saber si hay que bloquear la caja
            // (orden de locks caja -> pedido). Fuera de la transacción a propósito: en REPEATABLE READ el primer
            // SELECT plano fija el snapshot, y el recálculo de abajo (después del FOR UPDATE) tiene que ver lo último.
            const devolveriaSenia = destino === 'devuelta' && !!idCajaDev && (await this.SenaNeta(connection, id)) > 0;

            await connection.beginTransaction();

            // Orden de locks: caja -> pedido. La caja se bloquea solo si se va a devolver una seña (#6: sin seña,
            // destinoSenia se ignora y la caja no se mira).
            if (devolveriaSenia) {
                await CajasRepo.AsegurarAbierta(connection, idCajaDev!,
                    `La caja #${idCajaDev} está cerrada: no se puede devolver la seña desde ahí.`);
            }

            const actual = await this.Bloquear(connection, id);
            if (!(ESTADOS_PEDIDO_ACTIVOS as readonly string[]).includes(actual.estado)) {
                throw errorValidacion(`El pedido ya está ${actual.estado}.`, 409, { idPedido: id });
            }

            const senaNeta = await this.SenaNeta(connection, id);
            // Entre la lectura previa y el lock entró un pago: la caja no quedó bloqueada en orden. Reintentar.
            if (senaNeta > 0 && destino === 'devuelta' && idCajaDev && !devolveriaSenia) {
                throw new AppError(CodigoError.OPERACION_CONCURRENTE, MENSAJE_CONCURRENCIA, 409, { modulo: 'PedidosRepo', idPedido: id });
            }
            let destinoFinal: DestinoSenia | null = null;
            let idPagoDev: number | null = null;

            if (senaNeta > 0) {
                if (!destino) {
                    throw errorValidacion(`El pedido tiene $${senaNeta} de seña cobrada. Elegí si la devolvés o la retenés.`, 400, { idPedido: id });
                }
                destinoFinal = destino;
                if (destino === 'devuelta') {
                    if (!idCajaDev) throw errorValidacion('Para devolver la seña tenés que tener una caja abierta.', 400, { idPedido: id });
                    const [efe]: any = await connection.query('SELECT id, nombre FROM tipos_pago WHERE nombre = ?', [MEDIO_EFECTIVO]);
                    if (!efe[0]) throw errorValidacion('No se encontró el medio de pago EFECTIVO.');
                    idPagoDev = await this.insertarPago(connection, id, 'devolucion', efe[0], senaNeta, idCajaDev, auditoria);
                    await EventosRepo.Registrar(connection, {
                        accion: 'PEDIDO_PAGO',
                        entidad: 'pedidos',
                        entidadId: id,
                        datosDespues: { idPago: idPagoDev, tipo: 'devolucion', monto: senaNeta, idCaja: idCajaDev },
                        descripcion: `Devolución de seña de $${senaNeta} al cancelar el pedido #${id}`,
                        auditoria,
                    });
                }
            }

            await connection.query(
                `UPDATE pedidos
                 SET estado = 'cancelado', fechaCancelacion = NOW(), idUsuarioCancelo = ?, motivoCancelacion = ?,
                     destinoSenia = ?, fechaModificacion = NOW(), idUsuarioModifico = ?
                 WHERE id = ?`,
                [auditoria.usuarioId, mot, destinoFinal, auditoria.usuarioId, id]
            );
            await this.RegistrarHistorial(connection, id, actual.estado, 'cancelado', auditoria.usuarioId,
                [mot, destinoFinal === 'devuelta' ? `Seña de $${senaNeta} devuelta` : destinoFinal === 'retenida' ? `Seña de $${senaNeta} retenida` : null]
                    .filter(Boolean).join(' · ') || null);

            await EventosRepo.Registrar(connection, {
                accion: 'PEDIDO_CANCELAR',
                entidad: 'pedidos',
                entidadId: id,
                datosAntes: { estado: actual.estado, senaNeta },
                datosDespues: { estado: 'cancelado', motivo: mot, destinoSenia: destinoFinal },
                descripcion: `Pedido #${id} cancelado${mot ? ' - ' + mot : ''}${destinoFinal ? ` (seña ${destinoFinal === 'devuelta' ? 'devuelta' : 'retenida'} $${senaNeta})` : ''}`,
                auditoria,
            });

            await connection.commit();

        } catch (error: any) {
            await connection.rollback();
            throw traducirError(error, { metodo: 'Cancelar', idPedido: id });
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region PAGOS A CUENTA (seña)
    async RegistrarPago(id: number, pago: SeniaInicial, auditoria: Auditoria): Promise<number> {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const senia = await this.validarSenia(connection, pago);
            // Orden de locks: caja -> pedido.
            if (senia.idCaja) await CajasRepo.AsegurarAbierta(connection, senia.idCaja);

            const actual = await this.Bloquear(connection, id);
            if (!(ESTADOS_PEDIDO_ACTIVOS as readonly string[]).includes(actual.estado)) {
                throw errorValidacion(`El pedido está ${actual.estado}: ya no admite pagos a cuenta.`, 409, { idPedido: id });
            }
            const senaNeta = await this.SenaNeta(connection, id);
            const saldo = r2(r2(actual.total) - senaNeta);
            if (senia.monto - saldo > TOLERANCIA) {
                throw errorValidacion(`El pago ($${senia.monto}) supera el saldo del pedido ($${saldo}).`, 400, { idPedido: id });
            }

            const idPago = await this.insertarPago(connection, id, 'pago', senia.medio, senia.monto, senia.idCaja, auditoria);
            await EventosRepo.Registrar(connection, {
                accion: 'PEDIDO_PAGO',
                entidad: 'pedidos',
                entidadId: id,
                datosAntes: { senaNeta },
                datosDespues: { idPago, tipo: 'pago', monto: senia.monto, medio: senia.medio.nombre, idCaja: senia.idCaja, senaNeta: r2(senaNeta + senia.monto) },
                descripcion: `Pago a cuenta de $${senia.monto} (${senia.medio.nombre}) en el pedido #${id}`,
                auditoria,
            });

            await connection.commit();
            return idPago;

        } catch (error: any) {
            await connection.rollback();
            throw traducirError(error, { metodo: 'RegistrarPago', idPedido: id });
        } finally {
            connection.release();
        }
    }

    // Anula un pago a cuenta: lo marca anulado (no se borra) y, si fue en efectivo, compensa en la caja de origen
    // con un movimiento inverso. La caja de origen tiene que seguir abierta.
    async AnularPago(idPago: number, auditoria: Auditoria): Promise<void> {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Lectura previa (sin lock) solo para saber qué caja/pedido bloquear, en orden. Se revalida con lock abajo.
            const [previo]: any = await connection.query('SELECT idPedido, idCaja FROM pedidos_pagos WHERE id = ?', [idPago]);
            if (!previo[0]) throw new AppError(CodigoError.NOT_FOUND, 'El pago no existe.', 404, { modulo: 'PedidosRepo', idPago });

            if (previo[0].idCaja) {
                await CajasRepo.AsegurarAbierta(connection, previo[0].idCaja,
                    `No se puede anular: la caja #${previo[0].idCaja} donde se cobró la seña está cerrada. Reabrila para hacer cambios.`);
            }
            const pedido = await this.Bloquear(connection, previo[0].idPedido);

            const [rows]: any = await connection.query('SELECT * FROM pedidos_pagos WHERE id = ? FOR UPDATE', [idPago]);
            const pago = rows[0];
            if (!pago) throw new AppError(CodigoError.NOT_FOUND, 'El pago no existe.', 404, { modulo: 'PedidosRepo', idPago });
            if (pago.tipo !== 'pago') throw errorValidacion('Una devolución no se puede anular.', 400, { idPago });
            if (Number(pago.anulado) === 1) throw errorValidacion('Este pago ya fue anulado.', 409, { idPago });
            if (!(ESTADOS_PEDIDO_ACTIVOS as readonly string[]).includes(pedido.estado)) {
                throw errorValidacion(`El pedido está ${pedido.estado}: ya no se pueden anular pagos.`, 409, { idPago });
            }

            await connection.query(
                'UPDATE pedidos_pagos SET anulado = 1, fechaAnulacion = NOW(), idUsuarioAnulo = ? WHERE id = ?',
                [auditoria.usuarioId, idPago]
            );

            if (pago.idCaja) {
                const [movs]: any = await connection.query(
                    `SELECT id, monto FROM cajas_movimientos
                     WHERE idPedidoPago = ? AND tipoMovimiento = 'ENTRADA' AND idMovimientoCompensado IS NULL
                     ORDER BY id LIMIT 1 FOR UPDATE`, [idPago]
                );
                if (!movs[0]) throw errorValidacion('No se encontró el movimiento de caja del pago.', 409, { idPago });

                const idInverso = await MovimientosRepo.Agregar({
                    idCaja: pago.idCaja,
                    tipoMovimiento: 'SALIDA',
                    monto: movs[0].monto,
                    descripcion: `Anulación de seña pedido #${pedido.id}`,
                    idPedidoPago: idPago,
                    origenMov: 'pedido',
                    origen: 'anulacion',
                }, connection, auditoria);
                await connection.query('UPDATE cajas_movimientos SET idMovimientoCompensado = ? WHERE id = ?',
                    [Number(idInverso), movs[0].id]);
            }

            await EventosRepo.Registrar(connection, {
                accion: 'PEDIDO_PAGO_ANULAR',
                entidad: 'pedidos',
                entidadId: pedido.id,
                datosAntes: { idPago, monto: r2(pago.monto), idCaja: pago.idCaja },
                datosDespues: { anulado: true },
                descripcion: `Pago a cuenta de $${r2(pago.monto)} anulado en el pedido #${pedido.id}`,
                auditoria,
            });

            await connection.commit();

        } catch (error: any) {
            await connection.rollback();
            throw traducirError(error, { metodo: 'AnularPago', idPago });
        } finally {
            connection.release();
        }
    }
    //#endregion
}

export const PedidosRepo = new PedidosRepository();
