import db from '../db';
import {  } from '../models/Cliente';
import { Etiqueta } from '../models/Etiqueta';

class EtiquetasRepository{

    //#region OBTENER
    async Obtener(descripcion:string){
        const connection = await db.getConnection();
        
        try {
            let query = " SELECT * FROM etiquetas ";
            if (descripcion != null && descripcion != "") 
                query += " WHERE descripcion LIKE '%"+ descripcion + "%' ";
            query += "ORDER BY id DESC"

            const rows = await connection.query(query);
            return rows[0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerEtiqueta(idEtiqueta){
        const connection = await db.getConnection();
        
        try {
            let query = " SELECT * FROM etiquetas WHERE id = ? ";
            const rows = await connection.query(query, [idEtiqueta]);
            
            const row = rows[0][0];
            let etiqueta:Etiqueta = new Etiqueta({
                id: row['id'],
                descripcion: row['descripcion'],
                tamanio: row['tamanio'],
                titulo: row['titulo'],
                mOferta: row['mOferta'] == 1 ? true : false,
                mCodigo: row['mCodigo'] == 1 ? true : false,
                mPrecio: row['mPrecio'] == 1 ? true : false,
                mNombre: row['mNombre'] == 1 ? true : false,
                mVencimiento: row['mVencimiento'] == 1 ? true : false,
                bordeColor: row['bordeColor'],
                bordeAncho: row['bordeAncho'],
                tituloColor: row['tituloColor'],
                tituloAlineacion: row['tituloAlineacion'],
                ofertaFondo: row['ofertaFondo'],
                ofertaAlineacion: row['ofertaAlineacion'],
                nombreAlineacion: row['nombreAlineacion'],
                vencimientoAlineacion: row['vencimientoAlineacion'],
                precioAlineacion: row['precioAlineacion'],
                precioColor: row['precioColor'],
            });

            return etiqueta;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //#endregion

    //#region ABM
    async Agregar(data:any): Promise<string>{
        const connection = await db.getConnection();
        try {
            let existe = await ValidarExistencia(connection, data, false);
            if(existe)//Verificamos si ya existe una etiqueta con el mismo nombre 
                return "Ya existe una etiqueta con el mismo nombre.";
            
            const consulta = `
                INSERT INTO etiquetas (
                    descripcion,tamanio,titulo,
                    mOferta,mCodigo,mPrecio,mNombre,mVencimiento,
                    bordeColor,bordeAncho,tituloColor,tituloAlineacion,
                    ofertaFondo,ofertaAlineacion,nombreAlineacion,vencimientoAlineacion,precioAlineacion,precioColor
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

            const parametros = [
                data.descripcion?.toUpperCase(),
                data.tamanio,
                data.titulo,
                data.mOferta,
                data.mCodigo,
                data.mPrecio,
                data.mNombre,
                data.mVencimiento,
                data.bordeColor,
                data.bordeAncho,
                data.tituloColor,
                data.tituloAlineacion,
                data.ofertaFondo,
                data.ofertaAlineacion,
                data.nombreAlineacion,
                data.vencimientoAlineacion,
                data.precioAlineacion,
                data.precioColor
            ];     

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Modificar(data:any): Promise<string>{
        const connection = await db.getConnection();
        try {
            let existe = await ValidarExistencia(connection, data, true);
            if(existe)//Verificamos si ya existe una etiqueta con el mismo nombre 
                return "Ya existe una etiqueta con el mismo nombre.";
            
            const consulta = `
                UPDATE etiquetas 
                SET 
                    descripcion = ?,
                    tamanio = ?,
                    titulo = ?,
                    mOferta = ?,
                    mCodigo = ?,
                    mPrecio = ?,
                    mNombre = ?,
                    mVencimiento = ?,
                    bordeColor = ?,
                    bordeAncho = ?,
                    tituloColor = ?,
                    tituloAlineacion = ?,
                    ofertaFondo = ?,
                    ofertaAlineacion = ?,
                    nombreAlineacion = ?,
                    vencimientoAlineacion = ?,
                    precioAlineacion = ?,
                    precioColor = ?
                WHERE id = ?
            `;
            
            const parametros = [
                data.descripcion?.toUpperCase(),
                data.tamanio,
                data.titulo,
                data.mOferta,
                data.mCodigo,
                data.mPrecio,
                data.mNombre,
                data.mVencimiento,
                data.bordeColor,
                data.bordeAncho,
                data.tituloColor,
                data.tituloAlineacion,
                data.ofertaFondo,
                data.ofertaAlineacion,
                data.nombreAlineacion,
                data.vencimientoAlineacion,
                data.precioAlineacion,
                data.precioColor,
                data.id
            ];   

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Eliminar(id:string): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            await connection.query("DELETE FROM etiquetas WHERE id = ?", [id]);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM etiquetas WHERE descripcion = ? ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.descripcion.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

export const EtiquetasRepo = new EtiquetasRepository();





