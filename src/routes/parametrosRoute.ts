import {ParametrosRepo} from '../data/parametrosRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const path = require('path');
const fs = require('fs/promises'); 
const router : Router  = Router();
import config from '../conf/app.config';

router.get('/obtener/:clave', async (req:Request, res:Response) => {
    try{ 
        res.json(await ParametrosRepo.ObtenerParametros(req.params.clave));

    } catch(error:any){
        let msg = "Error al intentar obtener parametros.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ParametrosRepo.ActualizarParametro(req.body));

    } catch(error:any){
        let msg = "Error al intentar guardar un parametro.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-facturacion', async (req:Request, res:Response) => {
    try{ 
        res.json(await ParametrosRepo.ObtenerParametrosFacturacion());

    } catch(error:any){
        let msg = "Error al intentar obtener parametros de facturacion.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/actualizar-facturacion', async (req:Request, res:Response) => {
    try{ 
        res.json(await ParametrosRepo.ActualizarFacturacion(req.body));

    } catch(error:any){
        let msg = "Error al intentar guardar parametros de facturación.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

//Modo en red
router.get('/modo-server/', async (req, res) => {
    res.json(config.esServer);
});

router.post('/actualizar-backups', async (req:Request, res:Response) => {
    try{ 
        let data = req.body;
        
        if(data){
            let expresion = await GenerarExpresion(data);

            ParametrosRepo.ActualizarParametro({clave:'expresion', valor:expresion})
            ParametrosRepo.ActualizarParametro({clave:'backups', valor:data.activar==1?"true":"false"})
            ParametrosRepo.ActualizarParametro({clave:'dias', valor:data.dias.join(",")})
            ParametrosRepo.ActualizarParametro({clave:'hora', valor:data.hora})
            res.json("OK");

        }else
            throw {message:"No se proporcionó data"};
        

    } catch(error:any){
        let msg = "Error al intentar guardar los parametros de backup.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

async function GenerarExpresion(data:any){
    let expresion:string = "";
    const diasSemana = {
        "Domingo": 0,
        "Lunes": 1,
        "Martes": 2,
        "Miércoles": 3,
        "Jueves": 4,
        "Viernes": 5,
        "Sábado": 6
    };
    
    //Dividimos en horas y minutos
    const [hh, mm] = data.hora.split(":");
    data.hh = hh;
    data.mm = mm;

    //Obtenemos el nro del dia seleccionado por el usurio
    const diasNro = data.dias.map(dia => diasSemana[dia]);

    //Armamos la expresion cron 
    expresion = `${mm} ${hh} * * ${diasNro.join(",")}`;
    
    return expresion;
}


// Export the router
export default router; 