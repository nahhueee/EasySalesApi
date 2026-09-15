// Fase 3, PR 3.2 (handoff_repuestos_fases1_2_3.md): fila de productos_proveedores --
// relacion N:1 producto/proveedor con codigo del proveedor para esa pieza y costo propio.
// esPrincipal marca cual es el proveedor "activo" para el codigo viejo de una sola relacion
// (productos.idProveedor, espejo mantenido por productosProveedoresRepository.ts).

export class ProductoProveedor {
    id?: number;
    idProducto?: number;
    idProveedor?: number;
    codigoProveedor?: string | null;
    costo?: number | null;
    esPrincipal?: boolean;
    fechaActualizacion?: Date | string | null;

    // Solo lectura, viene del JOIN a proveedores para la grilla del tab (PR 3.3) -- no se
    // persiste, no se lee al escribir.
    proveedorNombre?: string;

    constructor(data?: any) {
        if (data) {
            this.id = data.id;
            this.idProducto = data.idProducto;
            this.idProveedor = data.idProveedor;
            this.codigoProveedor = data.codigoProveedor ?? null;
            this.costo = data.costo != null ? Number(data.costo) : null;
            this.esPrincipal = !!data.esPrincipal;
            this.fechaActualizacion = data.fechaActualizacion ?? null;
            this.proveedorNombre = data.proveedorNombre;
        }
    }
}
