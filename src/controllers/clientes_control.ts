import {Request, Response} from 'express';
var pool = require('../db').pool;

class clientes_control{
//#region OBTENER
    async ObtenerTotalClientes(req:Request,res:Response){
        try {
            //Obtengo los datos de paginacion y filtros
            const filtroTabla = req.body; 

            //Armo la query
            const query = await ObtenerQuery(filtroTabla, true);    
           
            pool.getConnection(function(error,connection) {
                        
                connection.query(query, function (error, fields) {
                    connection.release();
            
                    if (error) 
                        HandlearError(req,res,"db",error);

                    res.json(fields[0].total);
                });
            });
        } catch (error:any) {
            HandlearError(req,res,"interno",error);
        }
    };

    async ObtenerClientes(req:Request, res:Response){
        try {
             //Obtengo los datos de paginacion y filtros
             const filtroTabla = req.body; 

             //Armo la query
             const query = await ObtenerQuery(filtroTabla, false);
                 
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

    ObtenerCliente(req:Request, res:Response){
        try {
            const cliente = req.params.cliente;
            const query = `SELECT * FROM clientes WHERE id = ?`; 
               
            pool.getConnection(function(error, connection) {
                
                connection.query(query, cliente, function (error, fields) {
                    connection.release();
            
                    // Handle error after the release.
                    if (error) 
                        HandlearError(req,res,"db",error);
                    
                    res.json(fields[0]);
                });
            });
        } catch (error:any) {
            HandlearError(req,res,"interno",error);
        }
    }

    ObtenerCoincidencias(req:Request, res:Response){
        try {
            const cliente = req.params.cliente;
            const query = `SELECT COUNT(id) total FROM ventas WHERE idCliente = ?`; 
               
            pool.getConnection(function(error, connection) {
                
                connection.query(query, cliente, function (error, fields) {
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
    Agregar(req:Request, res:Response){
        try {
            const cliente = req.body;
            let parametros:any = [cliente.nombre];
            const query = `INSERT INTO clientes (nombre) VALUES (?) `

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

    Modificar(req:Request, res:Response){
        try {
            const cliente = req.body;
            let parametros:any = [cliente.nombre, cliente.id];
            const query = ` UPDATE clientes SET nombre = ?
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

    async Eliminar(req:Request, res:Response){
        try {
            const data = req.body;
            
            pool.getConnection(function(error, connection) {
                connection.beginTransaction(function(error) {
                    if (error) {//ERROR AL INICIAR LA TRANSACCION (Rollback y Liberar conexion)
                        connection.rollback(function() {
                            connection.release();
                            HandlearError(req,res,"db",error);
                        });
                    } else {
                        if(data.condicion=="baja"){
                            //#region ACTUALIZAR VENTA/CLIENTE
                            //Actualiza las ventas que contienen el id del cliente a eliminar, y les asigna el numero 1 (Consumidor Final)
                            let sql = `UPDATE ventas
                                       SET idCliente = 1 
                                       WHERE idcliente = ? `;
                            connection.query(sql, data.cliente, function (error, fields) {
                                if (error) {//ERROR EN QUERY (Rollback y Liberar conexion)
                                    connection.rollback(function() {
                                        connection.release();
                                        HandlearError(req,res,"db",error);
                                    });
                                }
                            });
                        //#endregion
                        }
                        
                        let query = `DELETE FROM clientes
                                     WHERE id = ? `;
                        connection.query(query, data.cliente, function (error, fields) {
                            if (error) {//ERROR EN QUERY (Rollback y Liberar conexion)
                                connection.rollback(function() {
                                    connection.release();
                                    HandlearError(req,res,"db",error);
                                });
                            }else{
                                connection.commit(function(err) {
                                if (err) {//ERROR AL INTENTAR COMMITEAR (Rollback y Liberar conexion)
                                    connection.rollback(function() {
                                        connection.release();
                                        HandlearError(req,res,"db",err);
                                    });
                                } else { //TRANSACCION REALIZADA CORRECTAMENTE
                                    connection.release();
                                    res.json('OK');
                                } 
                            });
                            }
                        });
                    }    
                });
            });
            
        } catch (error:any) {
            HandlearError(req,res,"interno",error);
        }
    }
//#endregion
}

//#region FUNCIONES PRIVADAS

// Obtiene una query de clientes y el total de registros si se requiere / Usado para paginación
function ObtenerQuery(filtroTabla:any, estotal:boolean):Promise<string>{
    return new Promise((resolve, rejects)=>{
        let query:string= '';
        let paginacion='';
        let filtro='';

        if(filtroTabla.filtro!="")
            filtro = " AND nombre LIKE '%" + filtroTabla.filtro + "%'";

        if(!estotal)
           paginacion = " LIMIT "+ filtroTabla.tamanioPagina + " OFFSET " + ((filtroTabla.pagina - 1) * filtroTabla.tamanioPagina);

        
        let count = estotal ? "SELECT COUNT (*) AS total FROM ( " : "";
        let endCount = estotal ? " ) as subquery" : "";
        
        query = count + 
                ` SELECT * from clientes 
                  WHERE id <> 1 `
                + filtro //WHERE
                + ` ORDER BY id DESC `
                + paginacion //LIMIT
                + endCount; 
                
        resolve(query);
    })
}

//Devuelve un 500 con el error ocasionado indicando si el error proviene de MySQL o es un error de la app
function HandlearError(req:Request, res:Response, mensaje:string, error:string){
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');

    if(mensaje=="db"){
        res.end("Ocurrió un error con la base de datos: " + error);
        throw new Error("Ocurrió un error con la base de datos: " + error);
    }
    if(mensaje=="interno"){
        res.end("Ocurrió un error interno: " + error);
        throw new Error("Ocurrió un error interno: " + error);
    }
}

//#endregion

export const clientesctrl = new clientes_control();