import db from '../db';
import { Parametro } from '../models/Parametro';

class ParametrosRepository{

  async ObtenerParametros(clave:string){
    const connection = await db.getConnection();

    try {
        
        let consulta = `SELECT valor FROM parametros WHERE clave = ?`;
        const rows = await connection.query(consulta,[clave]);
      
        if(rows[0][0]){
          if(rows[0][0].valor!="")
            return rows[0][0].valor
        }
        return null;

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

  async ActualizarParametro(data:any): Promise<string>{
    const connection = await db.getConnection();
    try {
        const consulta = `UPDATE parametros SET valor = ? WHERE clave = ?`;
        const parametros = [data.valor, data.clave];
        
        await connection.query(consulta, parametros);
        return "OK";

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

  async ActualizarFacturacion(data:any): Promise<string>{
    const connection = await db.getConnection();
    try {
        const consulta = `UPDATE parametros_facturacion 
                          SET 
                          condicion = ?, 
                          cuil = ?, 
                          puntoVta = ?,
                          razon = ?,
                          direccion = ?`;

        const parametros = [data.condicion, data.cuil, data.puntoVta, data.razon, data.direccion];
        
        await connection.query(consulta, parametros);
        return "OK";

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

  async ObtenerParametrosFacturacion(){
    const connection = await db.getConnection();

    try {
        
        const rows = await connection.query(`SELECT * FROM parametros_facturacion`);
      
        if(rows[0][0]){
          return rows[0][0];
        }
        return null;

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

}


export const ParametrosRepo = new ParametrosRepository();