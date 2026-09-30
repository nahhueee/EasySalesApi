import {ParametrosRepo, normalizarParametrosImpresion} from '../data/parametrosRepository';
import multer from 'multer';
import { LOGO_MAX_BYTES, validarPNG, guardarLogo, eliminarLogo } from '../services/logoService';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
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

router.get('/obtener-impresion', async (req:Request, res:Response) => {
    try{ 
        res.json(await ParametrosRepo.ObtenerParametrosImpresion());

    } catch(error:any){
        let msg = "Error al intentar obtener parametros de impresion.";
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

router.post('/actualizar-impresion', async (req:Request, res:Response) => {
    try{ 
        const previo = await ParametrosRepo.ObtenerParametrosImpresion();
        const resultado = await ParametrosRepo.ActualizarImpresion(req.body);

        // Si el logo cambió (o se quitó), el archivo anterior ya no lo referencia nadie: se borra.
        const nuevo = normalizarParametrosImpresion(req.body);
        if ('logo' in nuevo && previo?.logo && previo.logo !== nuevo.logo) {
            await eliminarLogo(previo.logo);
        }

        res.json(resultado);

    } catch(error:any){
        let msg = "Error al intentar guardar parametros de impresion.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Sube el logo (PNG ya optimizado por el front). Memoria y no disco: se valida antes de escribir
// nada, y el nombre lo genera el server. La base se actualiza recién al Guardar (actualizar-impresion).
const subidaLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES } }).single('logo');

router.post('/subir-logo', (req:Request, res:Response) => {
    subidaLogo(req, res, async (error:any) => {
        try {
            if (error) {
                const msg = error.code === 'LIMIT_FILE_SIZE' ? 'El logo supera 1 MB.' : 'No se pudo leer el archivo del logo.';
                res.status(400).send(msg);
                return;
            }
            if (!req.file) {
                res.status(400).send('No se recibió ningún archivo.');
                return;
            }

            const problema = validarPNG(req.file.buffer);
            if (problema) {
                res.status(400).send(problema);
                return;
            }

            res.json({ logo: await guardarLogo(req.file.buffer) });

        } catch(err:any) {
            let msg = "Error al intentar guardar el logo.";
            logger.error(msg + " " + err.message);
            res.status(500).send(msg);
        }
    });
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