import {Request, Response} from 'express';
var pool = require('../db').pool;

class sucursales_control{
//#region OBTENER
    async ObtenerSucursales(req:Request, res:Response){
        try {
            const query = `SELECT * FROM sucursales`; 

            pool.getConnection(function(error, connection) {
                
                connection.query(query, function (error, fields) {
                    connection.release();
            
                    // Handle error after the release.
                    if (error) 
                        HandlearError(req,res,"db",error);
                    
                    res.json(fields);
                });
            });
        } catch (error:any) {
            HandlearError(req,res,"interno",error);
        }
    };

    ObtenerSucursal(req:Request, res:Response){
        try {
            const sucursal = req.params.sucursal;
            const query = `SELECT * FROM sucursales WHERE sucursal = ?`; 

            pool.getConnection(function(error, connection) {
                
                connection.query(query, sucursal, function (error, fields) {
                    connection.release();
            
                    // Handle error after the release.
                    if (error) 
                        HandlearError(req,res,"db",error);
                    
                    res.json(fields);
                });
            });
        } catch (error:any) {
            HandlearError(req,res,"interno",error);
        }
    }
//#endregion
    
//#region ABM
    Modificar(req:Request, res:Response){
        try {
            const sucursal = req.body;
            let parametros:any = [sucursal.nombre, sucursal.activa, sucursal.id];
            const query = `UPDATE sucursales SET nombre = ?, activa = ?
                           WHERE id = ? `

            pool.getConnection(function(error, connection) {
                
                connection.query(query, parametros, function (error, fields) {
                    connection.release();
            
                    // Handle error after the release.
                    if (error) 
                        HandlearError(req,res,"db",error);
                    
                    res.json('OK');
                });
            });
        } catch (error:any) {
            HandlearError(req,res,"interno",error);
        }
    }
//#endregion
    
}

//#region FUNCIONES PRIVADAS
//Devuelve un 500 con el error ocasionado indicando si el error proviene de MySQL o es un error de la app
function HandlearError(req:Request, res:Response, mensaje:string, error:string){
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');

    if(mensaje=="db"){
        res.end("Ocurrió un error con la base de datos: " + error);
        throw "Ocurrió un error con la base de datos: " + error;
    }
    if(mensaje=="interno"){
        res.end("Ocurrió un error interno: " + error);
        throw "Ocurrió un error interno: " + error;
    }
}
//#endregion

export const sucursalesctrl = new sucursales_control();