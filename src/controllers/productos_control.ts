import {Request, Response} from 'express';
var pool = require('../db').pool;

class productos_control{
//#region OBTENER
    async ObtenerTotalProductos(req:Request,res:Response){
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

    async ObtenerProductos(req:Request, res:Response){
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

    ObtenerProducto(req:Request, res:Response){
        try {
            const producto = req.params.producto;
            const query = `SELECT p.* FROM productos p
                           WHERE id = ?`; 
               
            pool.getConnection(function(error, connection) {
                
                connection.query(query, producto, function (error, fields) {
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
            const producto = req.params.producto;
            const query = `SELECT COUNT(idProducto) total FROM venta_detalle WHERE idProducto = ?`; 
               
            pool.getConnection(function(error, connection) {
                
                connection.query(query, producto, function (error, fields) {
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
            const producto = req.body;
            let parametros:any = [producto.codigo,producto.producto,producto.idRubro,producto.idProveedor,producto.costo,producto.precio,producto.vencimiento,producto.faltante,producto.unidad];
            const query = `INSERT INTO productos (codigo,producto,idRubro,idProveedor,costo,precio,vencimiento,faltante,unidad) VALUES (?,?,?,?,?,?,?,?,?) `

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
            const producto = req.body;
            let parametros:any = [producto.codigo,producto.producto,producto.idRubro,producto.idProveedor,producto.costo,producto.precio,producto.vencimiento,producto.faltante,producto.unidad];
            const query = ` UPDATE productos SET 
                            codigo = ?,
                            producto = ?,
                            idRubro = ?,
                            idProveedor = ?,
                            costo = ?,
                            precio = ?,
                            vencimiento = ?,
                            faltante = ?,
                            unidad = ?
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
                            //#region ACTUALIZAR PRODUCTO/DETALLE VENTA
                            //Actualiza los productos que contienen el id del producto a eliminar, y les asigna el numero 1 (Eliminado)
                            let sql = `UPDATE venta_detalle
                                       SET idProducto = 1 
                                       WHERE idProducto = ? `;
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
    
                        let query = `DELETE FROM productos
                                     WHERE id = ? `;
                        connection.query(query, data.id, function (error, fields) {
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

// Obtiene una query de productos y el total de registros si se requiere / Usado para paginación
function ObtenerQuery(filtroTabla:any, estotal:boolean):Promise<string>{
    return new Promise((resolve, rejects)=>{
        let query:string= '';
        let paginacion='';
        let filtro='';

         if(filtroTabla.filtro!="")
            filtro = " AND producto LIKE '%" + filtroTabla.filtro + "%'";

        if(!estotal)
           paginacion = " LIMIT "+ filtroTabla.tamanioPagina + " OFFSET " + ((filtroTabla.pagina - 1) * filtroTabla.tamanioPagina);

        
        let count = estotal ? "SELECT COUNT (*) AS total FROM ( " : "";
        let endCount = estotal ? " ) as subquery" : "";
        
        query = count + 
                `SELECT p.codigo, p.producto, p.costo, p.precio, p.unidad, p.faltante, p.vencimiento, pro.nombre Proveedor, r.nombre Rubro FROM productos p
                 INNER JOIN rubros r ON r.id = p.idRubro
                 INNER JOIN proveedores pro ON pro.id = p.idProveedor
                 WHERE p.id <> 1  `
                + filtro //WHERE
                + ` ORDER BY p.id DESC `
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

export const productosctrl = new productos_control();