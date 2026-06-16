import db from '../db';
import { ListaPrecio } from '../models/ListaPrecio';

class ListasRepository {

  async Obtener(): Promise<ListaPrecio[]> {
    const connection = await db.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT id, nombre, esDefault, activa FROM listas_precio ORDER BY esDefault DESC, id ASC'
      );

      const listas: ListaPrecio[] = [];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          listas.push(new ListaPrecio(row));
        }
      }
      return listas;

    } catch (error: any) {
      throw error;
    } finally {
      connection.release();
    }
  }

  async Agregar(data: any): Promise<string> {
    const connection = await db.getConnection();
    try {
      const nombre = data.nombre?.trim();
      if (!nombre) return 'El nombre de la lista no puede estar vacío.';

      const [existe] = await connection.query(
        'SELECT id FROM listas_precio WHERE UPPER(nombre) = UPPER(?)', [nombre]
      );
      if (Array.isArray(existe) && existe.length > 0)
        return 'Ya existe una lista con ese nombre.';

      await connection.query(
        'INSERT INTO listas_precio (nombre, esDefault, activa) VALUES (?, 0, 1)',
        [nombre]
      );
      return 'OK';

    } catch (error: any) {
      throw error;
    } finally {
      connection.release();
    }
  }

  async Modificar(data: any): Promise<string> {
    const connection = await db.getConnection();
    try {
      const nombre = data.nombre?.trim();
      if (!nombre) return 'El nombre de la lista no puede estar vacío.';

      // No se puede cambiar el nombre de la lista default
      const [rows] = await connection.query(
        'SELECT esDefault FROM listas_precio WHERE id = ?', [data.id]
      );
      if (!Array.isArray(rows) || rows.length === 0) return 'Lista no encontrada.';
      if ((rows[0] as any).esDefault)
        return 'No se puede modificar la lista por defecto.';

      const [existe] = await connection.query(
        'SELECT id FROM listas_precio WHERE UPPER(nombre) = UPPER(?) AND id <> ?', [nombre, data.id]
      );
      if (Array.isArray(existe) && existe.length > 0)
        return 'Ya existe una lista con ese nombre.';

      await connection.query(
        'UPDATE listas_precio SET nombre = ?, activa = ? WHERE id = ?',
        [nombre, data.activa ? 1 : 0, data.id]
      );
      return 'OK';

    } catch (error: any) {
      throw error;
    } finally {
      connection.release();
    }
  }

  // Baja lógica: marca la lista como inactiva sin borrar los precios asociados.
  // Los precios históricos se conservan para trazabilidad.
  // (El borrado físico de productos_precios solo ocurre al eliminar el producto.)
  async Eliminar(id: number): Promise<string> {
    const connection = await db.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT esDefault, activa FROM listas_precio WHERE id = ?', [id]
      );
      if (!Array.isArray(rows) || rows.length === 0) return 'Lista no encontrada.';

      const lista = rows[0] as any;
      if (lista.esDefault) return 'No se puede dar de baja la lista por defecto.';
      if (!lista.activa)   return 'La lista ya se encuentra inactiva.';

      await connection.query(
        'UPDATE listas_precio SET activa = 0 WHERE id = ?', [id]
      );
      return 'OK';

    } catch (error: any) {
      throw error;
    } finally {
      connection.release();
    }
  }

  // Reactiva una lista previamente dada de baja.
  async Reactivar(id: number): Promise<string> {
    const connection = await db.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT activa FROM listas_precio WHERE id = ?', [id]
      );
      if (!Array.isArray(rows) || rows.length === 0) return 'Lista no encontrada.';
      if ((rows[0] as any).activa) return 'La lista ya está activa.';

      await connection.query(
        'UPDATE listas_precio SET activa = 1 WHERE id = ?', [id]
      );
      return 'OK';

    } catch (error: any) {
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const ListasRepo = new ListasRepository();
