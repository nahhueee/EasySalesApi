import moment from 'moment';
import { ResultSetHeader } from 'mysql2';
import db from '../db';
import { CajasRepo } from '../data/cajasRepository';
import { EventosRepo } from '../data/eventosRepository';
import { ResumenCajaServ } from './resumenCajaService';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { logger } from '../logger/logger';
import { auditoriaDesde } from '../utils/auditoria';
import { TienePermisoBackend } from '../utils/permisos';

// Fase 3.4-A (handoff §5.2, §5.3, §5.4): cierre con arqueo opcional y reapertura con motivo.
// Vive en un service y no en CajasRepo para no cerrar un ciclo de imports
// (CajasRepo <- CuentasRepo <- ResumenCajaServ).

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 255;
const OBSERVACION_MAX = 255;
const TOLERANCIA_DESVIO = 0.01;
export const MOTIVO_VERSION_ANTERIOR = '(sin motivo — versión anterior de la app)';

const r2 = (n: any): number => Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;

class CierreCajaService {

    // Cierra la caja. Todo en una sola transacción: el lock de la fila (AsegurarAbierta) impide que
    // entre una venta mientras se cierra, así que el resumen que se guarda es exactamente lo que quedó.
    async Cerrar(idCaja: number, data: { efectivoContado?: any; observacion?: any }, usuarioId?: number | string | null, puestoId?: string | null)
        : Promise<{ idCierre: number; esperado: number; contado: number | null; diferencia: number | null; resumen: any }> {

        //#region Validaciones de entrada
        const sinContar = data?.efectivoContado === undefined || data?.efectivoContado === null || data?.efectivoContado === '';
        let contado: number | null = null;
        if (!sinContar) {
            contado = Number(data.efectivoContado);
            if (!Number.isFinite(contado) || contado < 0) {
                throw new AppError(CodigoError.VALIDACION, 'El efectivo contado tiene que ser un número mayor o igual a 0.', 400,
                    { modulo: 'cierreCajaService.Cerrar', idCaja });
            }
            contado = r2(contado);
        }
        const observacion = data?.observacion != null ? String(data.observacion).trim() : '';
        if (observacion.length > OBSERVACION_MAX) {
            throw new AppError(CodigoError.VALIDACION, `La observación no puede superar los ${OBSERVACION_MAX} caracteres.`, 400,
                { modulo: 'cierreCajaService.Cerrar', idCaja });
        }
        //#endregion

        const connection = await db.getConnection();
        const auditoria = auditoriaDesde(usuarioId, puestoId);
        let resumen: any;
        let idCierre = 0;
        let esperado = 0;
        let diferencia: number | null = null;

        try {
            await connection.beginTransaction();

            await CajasRepo.AsegurarAbierta(connection, idCaja, `La caja #${idCaja} ya está cerrada.`);

            resumen = await ResumenCajaServ.Calcular(idCaja, connection);
            resumen.caja.finalizada = true;                       // la foto se guarda ya como cerrada

            esperado = resumen.cajon.esperado;
            diferencia = contado != null ? r2(contado - esperado) : null;
            const fondo = resumen.fondo;

            const [ins] = await connection.query<ResultSetHeader>(
                `INSERT INTO cajas_cierres
                    (idCaja, idUsuario, idPuesto, efectivoEsperado, efectivoContado, diferencia, fondoAsignado,
                     fondoPagado, ventasAcumulador, ventasRecalculado, resumen, observacion)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    idCaja, auditoria.usuarioId, auditoria.puestoId, esperado, contado, diferencia,
                    fondo ? fondo.asignado : null, fondo ? fondo.pagado : 0,
                    resumen.control.ventasAcumulador, resumen.control.ventasRecalculado,
                    JSON.stringify(resumen), observacion || null,
                ]
            );
            idCierre = ins.insertId;

            await connection.query('UPDATE cajas SET finalizada = 1 WHERE id = ?', [idCaja]);

            // Foto del arqueo (la misma de siempre) ampliada con el cálculo nuevo.
            const [filas] = await connection.query(
                'SELECT inicial, ventas, entradas, salidas FROM cajas WHERE id = ?', [idCaja]
            ) as [any[], any];
            const f = filas[0];
            await EventosRepo.Registrar(connection, {
                accion: 'CAJA_CERRAR',
                entidad: 'cajas',
                entidadId: Number(idCaja),
                datosDespues: {
                    inicial: Number(f.inicial), ventas: Number(f.ventas),
                    entradas: Number(f.entradas), salidas: Number(f.salidas),
                    idCierre,
                    esperado,
                    contado,
                    diferencia,
                    fondo: fondo ? { asignado: fondo.asignado, pagado: fondo.pagado, excedente: fondo.excedente } : null,
                    desvio: resumen.control.desvio,
                },
                descripcion: `Cierre de la caja #${idCaja}` +
                    (diferencia != null ? ` - esperado $${esperado}, contado $${contado}, diferencia $${diferencia}` : ' - sin arqueo'),
                auditoria,
            });

            await connection.commit();

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        // Desvío del acumulador: NO bloquea el cierre. Se loguea con logger.error (y no warn) porque el
        // transporte hacia AdminServer solo escucha el nivel error; la severidad MEDIA sale del código.
        // Después del commit, para no dejar un aviso de un cierre que se revirtió.
        const desvio = resumen.control.desvio;
        if (desvio != null && Math.abs(desvio) > TOLERANCIA_DESVIO) {
            logger.error({
                type: 'CAJA_DESVIO',
                code: CodigoError.CAJA_DESVIO_VENTAS,
                message: `Caja #${idCaja}: cajas.ventas ($${resumen.control.ventasAcumulador}) no coincide con la suma recalculada ($${resumen.control.ventasRecalculado}). Desvío $${desvio}.`,
                modulo: 'cierreCajaService.Cerrar',
            });
        }

        // esperado/contado/diferencia son los mismos valores que quedaron en cajas_cierres: la pantalla
        // los muestra tal cual, no los recalcula.
        return { idCierre, esperado, contado, diferencia, resumen };
    }

    // Reabre la caja. Solo ADMINISTRADOR o ENCARGADO, con motivo obligatorio (decisión 4).
    // OJO: el usuario viene del header x-usuario-id (el backend todavía no tiene auth real; deuda conocida,
    // ver utils/permisos.ts): es un control de operación, no una barrera de seguridad.
    async Reabrir(idCaja: number, motivo: any, usuarioId?: number | string | null, puestoId?: string | null): Promise<string> {

        const permitido = await TienePermisoBackend(usuarioId != null ? String(usuarioId) : null, ['ADMINISTRADOR', 'ENCARGADO']);
        if (!permitido) {
            throw new AppError(CodigoError.VALIDACION, 'Solo un administrador o encargado puede reabrir una caja.', 403,
                { modulo: 'cierreCajaService.Reabrir', idCaja });
        }

        const texto = motivo != null ? String(motivo).trim() : '';
        if (texto.length < MOTIVO_MIN || texto.length > MOTIVO_MAX) {
            throw new AppError(CodigoError.VALIDACION, 'Indicá el motivo de la reapertura.', 400,
                { modulo: 'cierreCajaService.Reabrir', idCaja });
        }

        const connection = await db.getConnection();
        const auditoria = auditoriaDesde(usuarioId, puestoId);

        try {
            await connection.beginTransaction();

            const [rows] = await connection.query(
                'SELECT finalizada, fechaBaja FROM cajas WHERE id = ? FOR UPDATE', [idCaja]
            ) as [any[], any];
            const caja = rows[0];
            if (!caja || caja.fechaBaja != null) {
                throw new AppError(CodigoError.NOT_FOUND, `La caja #${idCaja} no existe.`, 404,
                    { modulo: 'cierreCajaService.Reabrir', idCaja });
            }
            if (Number(caja.finalizada) !== 1) {
                throw new AppError(CodigoError.VALIDACION, `La caja #${idCaja} ya está abierta.`, 409,
                    { modulo: 'cierreCajaService.Reabrir', idCaja });
            }

            await connection.query('UPDATE cajas SET finalizada = 0 WHERE id = ?', [idCaja]);

            await EventosRepo.Registrar(connection, {
                accion: 'CAJA_REABRIR',
                entidad: 'cajas',
                entidadId: Number(idCaja),
                datosDespues: { motivo: texto },
                descripcion: `Reapertura de la caja #${idCaja}: ${texto}`.slice(0, 255),
                auditoria,
            });

            await connection.commit();
            return 'OK';

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // PUT /cajas/finalizar del front viejo (hasta que salga la 3.4-B). TRANSITORIO.
    //   finalizada = 1 -> Cerrar sin arqueo.
    //   finalizada = 0 -> Reabrir con el MISMO chequeo de permiso y un motivo fijo de "versión anterior".
    // Conserva el contrato histórico del front viejo: devuelve 'OK', o el mensaje como texto (200) cuando
    // la regla de negocio lo rechaza; ese front solo sabe mostrar el texto cuando no es 'OK'.
    async FinalizarCompat(data: any, usuarioId?: number | string | null, puestoId?: string | null): Promise<string> {
        try {
            if (Number(data.finalizada) === 1) {
                await this.Cerrar(Number(data.idCaja), {}, usuarioId, puestoId);
                return 'OK';
            }
            return await this.Reabrir(Number(data.idCaja), MOTIVO_VERSION_ANTERIOR, usuarioId, puestoId);

        } catch (error: any) {
            if (error instanceof AppError && error.status && error.status < 500) return error.message;
            throw error;
        }
    }
}

export const CierreCajaServ = new CierreCajaService();
