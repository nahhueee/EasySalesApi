import {Request, Response} from 'express';
var pool = require('../db').pool;

class cargos_control{
//#region OBTENER
    async ObtenerCargos(req:Request, res:Response){
        try {
            const query = `SELECT * FROM cargos`; 

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

export const cargosctrl = new cargos_control();