import {Request, Response} from 'express';
var pool = require('../db').pool;

class proveedores_control{
//#region OBTENER
    async ObtenerTotalProveedores(req:Request,res:Response){
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

    async ObtenerProveedores(req:Request, res:Response){
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

    ObtenerProveedor(req:Request, res:Response){
        try {
            const proveedor = req.params.proveedor;
            const query = `SELECT * FROM proveedores WHERE id = ?`; 
               
            pool.getConnection(function(error, connection) {
                
                connection.query(query, proveedor, function (error, fields) {
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
            const proveedor = req.params.proveedor;
            const query = `SELECT COUNT(id) total FROM productos WHERE idProveedor = ?`; 
               
            pool.getConnection(function(error, connection) {
                
                connection.query(query, proveedor, function (error, fields) {
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
            
            const proveedor = req.body;
            console.log(proveedor)
            let parametros:any = [proveedor.nombre];
            const query = `INSERT INTO proveedores (nombre) VALUES (?) `

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
            const proveedor = req.body;
            let parametros:any = [proveedor.nombre, proveedor.id];
            const query = ` UPDATE proveedores SET nombre = ?
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
                            //#region ACTUALIZAR PRODUCTO/PROVEEDOR
                            //Actualiza los productos que contienen el id del proveedor a eliminar, y les asigna el numero 1 (Eliminado)
                            let sql = `UPDATE productos
                                       SET idProveedor = 1 
                                       WHERE idProveedor = ? `;
                            connection.query(sql, data.id, function (error, fields) {
                                if (error) {//ERROR EN QUERY (Rollback y Liberar conexion)
                                    connection.rollback(function() {
                                        connection.release();
                                        HandlearError(req,res,"db",error);
                                    });
                                }
                            });
                            //#endregion
                        }
    
                        let query = `DELETE FROM proveedores
                                     WHERE id = ? `;
                        connection.query(query, data.proveedor, function (error, fields) {
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

// Obtiene una query de proveedores y el total de registros si se requiere / Usado para paginación
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
                ` SELECT * from proveedores 
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
        throw "Ocurrió un error con la base de datos: " + error;
    }
    if(mensaje=="interno"){
        res.end("Ocurrió un error interno: " + error);
        throw "Ocurrió un error interno: " + error;
    }
}

//#endregion

export const proveedoresctrl = new proveedores_control();