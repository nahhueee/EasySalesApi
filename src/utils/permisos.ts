import db from '../db';
import { ProveedorCuentaRepo } from '../data/proveedorCuentaRepository';

// Guard de rol en el backend — hoy el resto del sistema (EntregaDinero, ActualizarEstadoPago,
// RevertirEstadoPago en cuentasCorsRepository.ts) valida permisos SOLO en el frontend
// (authService.TienePermiso). Esta es la primera validación real de rol en el backend, a
// pedido explícito del plan de Proveedores (documentos/handoff_proveedores_fase2.md, PR6):
// un pago a proveedor mueve plata real y anularlo compensa un movimiento de caja, así que acá
// no alcanza con confiar en que el front oculte el botón.
//
// Deliberadamente NO se generaliza a middleware de toda la app: los demás endpoints de dinero
// quedan con el mismo nivel de protección que tenían. Es deuda técnica conocida y separada
// (backend sin auth real, confía en el header x-usuario-id que manda el propio front), no algo
// para resolver de paso acá.
export async function TienePermisoBackend(usuarioId: string | null, rolesPermitidos: string[]): Promise<boolean> {
    const cargo = await ObtenerCargoBackend(usuarioId);
    return !!cargo && rolesPermitidos.includes(cargo);
}

// Cargo del usuario en mayúsculas (mismo formato que usa el front en TienePermiso), o null si
// no se pudo resolver (usuarioId ausente o sin cargo asignado).
export async function ObtenerCargoBackend(usuarioId: string | null): Promise<string | null> {
    if (!usuarioId) return null;

    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT c.nombre FROM usuarios u INNER JOIN cargos c ON c.id = u.idCargo WHERE u.id = ?`,
            [usuarioId]
        ) as [any[], any];

        const cargo: string | undefined = rows[0]?.nombre;
        return cargo ? cargo.toUpperCase() : null;

    } catch (error) {
        throw error;
    } finally {
        connection.release();
    }
}

// Registrar pago a proveedor (decisión 2026-08-10, ajuste sobre PR6, corregido el mismo día):
// ADMINISTRADOR/ENCARGADO sin límite. EMPLEADO solo puede pagar en EFECTIVO imputado a una caja
// que tenga fondo de proveedores asignado, y solo hasta el DISPONIBLE de esa caja puntual
// (fondoProveedores − pagos ya hechos con cargo a ella, ver
// ProveedorCuentaRepo.ObtenerDisponibleFondo). No es un tope único del comercio: cada caja
// declara su propio fondo al abrirse (PR5).
//
// `idCajaEfectivo` tiene que venir ya resuelto por el caller con el mismo guard que usa
// RegistrarPago (solo confiar en idCaja si el medio de pago es EFECTIVO) — acá no se repite esa
// validación para no duplicar la lectura de tipos_pago.
//
// Anular pago queda deliberadamente afuera de esta relajación: sigue siendo solo
// ADMINISTRADOR/ENCARGADO vía TienePermisoBackend — deshacer un pago ya registrado es un poder
// distinto al de cargarlo.
export async function PuedeRegistrarPagoProveedor(usuarioId: string | null, monto: number, idCajaEfectivo: number | null): Promise<{ permitido: boolean; motivo?: string }> {
    const cargo = await ObtenerCargoBackend(usuarioId);

    if (cargo === 'ADMINISTRADOR' || cargo === 'ENCARGADO') {
        return { permitido: true };
    }

    if (cargo === 'EMPLEADO') {
        if (!idCajaEfectivo) {
            return {
                permitido: false,
                motivo: 'Como Empleado, solo podés registrar pagos en efectivo imputados a una caja con fondo para proveedores.'
            };
        }

        const disponible = await ProveedorCuentaRepo.ObtenerDisponibleFondo(idCajaEfectivo);

        if (disponible === null) {
            return {
                permitido: false,
                motivo: 'Esta caja no tiene fondo para proveedores asignado. Pedile a un encargado o administrador que lo registre.'
            };
        }

        if (monto <= disponible) {
            return { permitido: true };
        }

        return {
            permitido: false,
            motivo: `El pago supera el disponible del fondo de proveedores de esta caja ($${disponible.toFixed(2)}). Pedile a un encargado o administrador que lo registre.`
        };
    }

    return { permitido: false, motivo: 'No tenés permiso para registrar pagos a proveedores.' };
}
