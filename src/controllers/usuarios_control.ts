import {Request, Response} from 'express';
var pool = require('../db').pool;
var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');

class usuarios_control{
//#region OBTENER
    async ObtenerTotalUsuarios(req:Request,res:Response){
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

    async ObtenerUsuarios(req:Request, res:Response){
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

    ObtenerUsuario(req:Request, res:Response){
        try {
            const usuario = req.params.usuario;
            const query = `SELECT * FROM usuarios
                           WHERE usuario = ?`; 

            pool.getConnection(function(error, connection) {
                
                connection.query(query, usuario, async function (error, fields) {
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
//#endregion
    
//#region ABM
     async Agregar(req:Request, res:Response){
        try {
            const usuario = req.body;
            
            let parametros:any = [usuario.usuario, usuario.nombre, usuario.email, usuario.pass, usuario.idCargo];
            const query = `INSERT INTO usuarios (usuario, nombre, email, pass, idCargo) VALUES (?,?,?,?,?) `

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

    async Modificar(req:Request, res:Response){
        try {
            const usuario = req.body;
            
            let parametros:any = [ usuario.usuario, usuario.nombre, usuario.email, usuario.pass, usuario.idCargo, usuario.id];
            const query = `UPDATE usuarios SET usuario = ?, nombre = ?, email = ?, pass = ?, idCargo = ?
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

    Eliminar(req:Request, res:Response){
        try {
            const data = req.body;
            let query = "";

            if(data.condicion=="baja"){
                //TODO
                //Actualizar el usuario en donde aparezca por el usuario "Eliminado"
                //Luego Eliminar el usuario
            }
            if(data.condicion=="eliminar"){
                query = `DELETE FROM usuarios
                         WHERE usuario = ? `
            }

            pool.getConnection(function(error, connection) {
                
                connection.query(query, data.usuario, function (error, fields) {
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
   
Ingresar(req:Request, res:Response){
    try {
        const persona = req.body;
       
        let parametros:any = [persona.usuario];
        const query = `SELECT u.usuario, u.nombre, c.nombre cargo, u.pass FROM usuarios u
                       INNER JOIN cargos c ON c.id = u.idCargo
                       WHERE u.usuario = ?`

        pool.getConnection(function(error, connection) {
            
            connection.query(query, parametros, async function (error, fields) {
                connection.release();
        
                // Handle error after the release.
                if (error) 
                    HandlearError(req,res,"db",error);
                
                
                if(fields.length==0){//El usuario no existe
                    res.json('not OK');
                }else{
                    res.json(fields[0]);
                }
                
            });
        });
    } catch (error:any) {
        HandlearError(req,res,"interno",error);
    }
}
}

//#region FUNCIONES PRIVADAS

//#region JWT TOKEN PROXIMO A IMPLEMENTAR
// Creo un token jwt para la seguridad de consulta entre cliente y servidor
async function CrearToken(usuario:string):Promise<string>{
    return(jwt.sing({user:usuario},"mysecrettext"))
}
// Descifra el token provisto
async function DescifrarToken(token:string):Promise<string>{
    return(jwt.verify(token,"mysecrettext"))
}
//#endregion


// Encripto la nueva contraseña con bcryptjs
async function EncriptarPass(password:string):Promise<string>{
   
    //Crea un hash con la seguridad de 5 y luego retorna la password cifrada
    const salt = await bcrypt.genSalt(5);
    return(bcrypt.hash(password, salt));
}
async function CompararPass(password:string, passHash:string):Promise<boolean>{
    let resultado: boolean = false;

    // Comparacion de las contraseñas bcryptjs
    await bcrypt.compare(password,passHash).then(function(res) {
       resultado = res;
    });

    return resultado;
}

// Obtiene una query de usuarios y el total de registros si se requiere / Usado para paginación
function ObtenerQuery(filtroTabla:any, estotal:boolean):Promise<string>{
    return new Promise((resolve, rejects)=>{
        let query:string= '';
        let paginacion='';

         if(!estotal)
           paginacion = " LIMIT "+ filtroTabla.tamanioPagina + " OFFSET " + ((filtroTabla.pagina - 1) * filtroTabla.tamanioPagina);
        
        let count = estotal ? "SELECT COUNT (*) AS total FROM ( " : "";
        let endCount = estotal ? " ) as subquery" : "";
        
        query = count + `SELECT u.usuario, u.nombre, u.email, c.nombre cargo from usuarios u 
                INNER JOIN cargos c on c.id = u.idCargo ` 
                + paginacion //LIMIT
                + endCount

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

export const usuariosctrl = new usuarios_control();