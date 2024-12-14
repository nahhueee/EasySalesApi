import db from '../db';
const moment = require('moment');

class BackupsRepository{
    
    async ObtenerUltimoRenovar(){
        const connection = await db.getConnection();
        
        try {
            const cantidad = await connection.query("SELECT COUNT(nombre) total FROM backups");
            const fila = await connection.query('SELECT nombre FROM backups ORDER BY fecha ASC LIMIT 1');
            
            return {total:cantidad[0][0].total, fila:fila[0][0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //#region AB
    async Agregar(fileName): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            const consulta = "INSERT INTO backups(nombre, fecha) VALUES (?, ?)";
            const parametros = [fileName, moment().format('YYYY-MM-DD')];
            
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Eliminar(nombre:string): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            await connection.query("DELETE FROM backups WHERE nombre = ?", [nombre]);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion
}

export const BackupsRepo = new BackupsRepository();