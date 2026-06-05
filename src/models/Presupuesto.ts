import { Cliente } from './Cliente';
import { DetallePresupuesto } from './DetallePresupuesto';

export class Presupuesto {
    id?: number;
    idCliente: number = 0;
    idUsuario: number = 0;
    idCaja?: number;            // NULL si se origina fuera de una caja
    fecha?: Date;
    validezHasta?: Date;
    validezDias?: number;       // Sólo se usa al crear; se convierte a validezHasta en el backend
    total: number = 0;
    estado: 'vigente' | 'convertido' | 'anulado' | 'vencido' = 'vigente';
    idVentaGenerada?: number;

    cliente?: Cliente;
    detalles: DetallePresupuesto[] = [];
}
