import { Cliente } from './Cliente';
import { DetallePedido } from './DetallePedido';

// Estados fijos en v1 (no configurables por comercio). Ver handoff_pedidos.md §2.3 y §2.7.
export type EstadoPedido = 'pendiente' | 'en_proceso' | 'listo' | 'entregado' | 'cancelado';

// Los únicos estados que se pueden elegir a mano. 'entregado' lo pone la venta; 'cancelado', Cancelar.
export const ESTADOS_PEDIDO_ACTIVOS: readonly EstadoPedido[] = ['pendiente', 'en_proceso', 'listo'];

export type DestinoSenia = 'devuelta' | 'retenida';

// Seña inicial al crear el pedido (opcional). El monto y el medio los valida el backend.
export interface SeniaInicial {
    monto: number;
    idTipoPago: number;
    idCaja?: number | null;   // obligatoria si el medio es EFECTIVO
}

export class Pedido {
    id?: number;
    idCliente: number = 0;
    idUsuario: number = 0;
    idCaja?: number;                  // NULL si se creó fuera de una caja
    fecha?: Date;
    fechaEntregaEstimada?: Date | string | null;
    total: number = 0;
    estado: EstadoPedido = 'pendiente';
    observaciones?: string | null;
    contactoNombre?: string | null;   // Solo para consumidor final (idCliente = 1)
    contactoTelefono?: string | null;
    idVentaGenerada?: number | null;
    fechaModificacion?: Date;
    idUsuarioModifico?: number;
    fechaCancelacion?: Date;
    idUsuarioCancelo?: number;
    motivoCancelacion?: string | null;
    destinoSenia?: DestinoSenia | null;   // qué se hizo con la seña al cancelar
    senaNeta?: number;                    // calculada en el servidor, nunca persistida (handoff §3)
    saldo?: number;                       // total - senaNeta
    senia?: SeniaInicial;                 // solo al crear

    cliente?: Cliente;
    detalles: DetallePedido[] = [];
}
