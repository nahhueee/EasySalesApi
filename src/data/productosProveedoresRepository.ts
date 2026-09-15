import db from '../db';
import { ProductoProveedor } from '../models/ProductoProveedor';

// Fase 3, PR 3.2 (handoff_repuestos_fases1_2_3.md) -- multi-proveedor por producto.
//
// productos.idProveedor sigue siendo el espejo del proveedor "principal" que lee todo el
// codigo existente (productosRepository, faltantes, exportProductosService,
// relacionar-productos -- relevamiento completo en el handoff). TODOS los metodos de este
// repositorio que tocan esPrincipal actualizan ese espejo en la MISMA transaccion -- nunca
// se escribe uno sin el otro (si se desincronizan, el modulo viejo muestra un proveedor y
// el nuevo otro, y ese bug es dificilisimo de rastrear).
//
// A diferencia de UpsertUnPrecio/ActualizarPrecio* en productosRepository.ts (que comparten
// una sola connection sin beginTransaction real), acá SÍ se usa una transaccion explicita:
// el handoff pide expresamente que el espejo nunca quede desincronizado, y Guardar/Eliminar
// tocan dos tablas en mas de un statement.
class ProductosProveedoresRepository {

    // Proveedores de un producto para la grilla del tab "Proveedores" (PR 3.3): siempre por
    // nombre (orden estable). A proposito NO se ordena por esPrincipal -- si la fila salta
    // de posicion cada vez que se marca un principal distinto, es confuso en la UI (el
    // usuario no ve que la estrella se movio, ve que "no paso nada"). El principal se
    // distingue por el icono, no por la posicion.
    async Obtener(idProducto: number): Promise<ProductoProveedor[]> {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(`
                SELECT pp.id, pp.idProducto, pp.idProveedor, pp.codigoProveedor, pp.costo,
                       pp.esPrincipal, pp.fechaActualizacion, p.nombre AS proveedorNombre
                FROM productos_proveedores pp
                INNER JOIN proveedores p ON p.id = pp.idProveedor
                WHERE pp.idProducto = ?
                ORDER BY p.nombre ASC
            `, [idProducto]);

            return (rows as any[]).map(r => new ProductoProveedor(r));

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Alta/edicion de un proveedor para un producto (upsert por UNIQUE(idProducto,idProveedor)
    // -- ver migracion 20260908120000_productos_proveedores.js). NO toca esPrincipal ni el
    // espejo: eso es responsabilidad exclusiva de MarcarPrincipal, para no tener dos caminos
    // distintos escribiendo el mismo invariante.
    async Guardar(data: any): Promise<string> {
        const connection = await db.getConnection();
        try {
            await connection.query(`
                INSERT INTO productos_proveedores (idProducto, idProveedor, codigoProveedor, costo, fechaActualizacion)
                VALUES (?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    codigoProveedor    = VALUES(codigoProveedor),
                    costo              = VALUES(costo),
                    fechaActualizacion = VALUES(fechaActualizacion)
            `, [data.idProducto, data.idProveedor, data.codigoProveedor ?? null, data.costo ?? null]);

            return "OK";

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Marca un proveedor como principal para el producto y sincroniza el espejo
    // productos.idProveedor en la misma transaccion -- unico lugar que escribe esPrincipal=1.
    async MarcarPrincipal(data: { idProducto: number, idProveedor: number }): Promise<string> {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [existe] = await connection.query(
                'SELECT id FROM productos_proveedores WHERE idProducto = ? AND idProveedor = ? FOR UPDATE',
                [data.idProducto, data.idProveedor]
            );
            if (!Array.isArray(existe) || existe.length === 0) {
                await connection.rollback();
                return "El producto no tiene ese proveedor cargado.";
            }

            await connection.query(
                'UPDATE productos_proveedores SET esPrincipal = 0 WHERE idProducto = ?',
                [data.idProducto]
            );
            await connection.query(
                'UPDATE productos_proveedores SET esPrincipal = 1, fechaActualizacion = NOW() WHERE idProducto = ? AND idProveedor = ?',
                [data.idProducto, data.idProveedor]
            );
            await connection.query(
                'UPDATE productos SET idProveedor = ? WHERE id = ?',
                [data.idProveedor, data.idProducto]
            );

            await connection.commit();
            return "OK";

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Quita un proveedor del producto. Si era el principal, el espejo pasa a otro proveedor
    // cargado (el mas antiguo) o a NULL si no queda ninguno -- nunca a un id inexistente
    // (handoff Fase 3, PR 3.2, checklist).
    async Eliminar(id: number): Promise<string> {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [filas] = await connection.query(
                'SELECT idProducto, esPrincipal FROM productos_proveedores WHERE id = ? FOR UPDATE',
                [id]
            );
            if (!Array.isArray(filas) || filas.length === 0) {
                await connection.rollback();
                return "No se encontró la relación producto-proveedor.";
            }
            const fila = filas[0] as any;

            await connection.query('DELETE FROM productos_proveedores WHERE id = ?', [id]);

            if (fila.esPrincipal) {
                const [restantes] = await connection.query(
                    'SELECT idProveedor FROM productos_proveedores WHERE idProducto = ? ORDER BY id ASC LIMIT 1',
                    [fila.idProducto]
                );

                if (Array.isArray(restantes) && restantes.length > 0) {
                    const nuevoPrincipal = (restantes[0] as any).idProveedor;
                    await connection.query(
                        'UPDATE productos_proveedores SET esPrincipal = 1, fechaActualizacion = NOW() WHERE idProducto = ? AND idProveedor = ?',
                        [fila.idProducto, nuevoPrincipal]
                    );
                    await connection.query(
                        'UPDATE productos SET idProveedor = ? WHERE id = ?',
                        [nuevoPrincipal, fila.idProducto]
                    );
                } else {
                    await connection.query(
                        'UPDATE productos SET idProveedor = NULL WHERE id = ?',
                        [fila.idProducto]
                    );
                }
            }

            await connection.commit();
            return "OK";

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export const ProductosProveedoresRepo = new ProductosProveedoresRepository();
