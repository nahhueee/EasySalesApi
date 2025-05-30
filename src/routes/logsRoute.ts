import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import * as path from 'path';
import moment from 'moment';
const fs = require('fs').promises;
const fileServer = require('fs');

const router : Router  = Router();

router.get('/general', async (req:Request, res:Response) => {
    try{ 
        const generalPath = path.resolve(__dirname, '../log/general.json');

        const data = await fs.readFile(generalPath, 'utf8');
        res.json(JSON.parse(data));

    } catch(error:any){
        logger.error("Error al obtener listado de logs generales. " + error);
        res.status(500).send(false);
    }
});

router.get('/backup', async (req:Request, res:Response) => {
    try{ 
        const backupPath = path.resolve(__dirname, '../log/backup.json');

        const data = await fs.readFile(backupPath, 'utf8');
        res.json(JSON.parse(data));

    } catch(error:any){
        logger.error("Error al obtener listado de logs backups. " + error);
        res.status(500).send(false);
    }
});

router.get('/update', async (req:Request, res:Response) => {
    try{ 
        const updatePath = path.resolve(__dirname, '../log/update.json');

        const data = await fs.readFile(updatePath, 'utf8');
        res.json(JSON.parse(data));

    } catch(error:any){
        logger.error("Error al obtener listado de logs updates. " + error);
        res.status(500).send(false);
    }
});

router.get('/facturacion', async (req:Request, res:Response) => {
    try{ 
        const updatePath = path.resolve(__dirname, '../log/facturacion.json');

        const data = await fs.readFile(updatePath, 'utf8');
        res.json(JSON.parse(data));

    } catch(error:any){
        logger.error("Error al obtener listado de logs facturacion. " + error);
        res.status(500).send(false);
    }
});


router.post('/general', async (req:Request, res:Response) => {
    try{ 
        const generalPath = path.resolve(__dirname, '../log/general.json');
        req.body.timestamp = moment().format('DD-MM-YY HH:mm');

        const logs = JSON.parse(fileServer.readFileSync(generalPath, 'utf8'));
        logs.push(req.body);
        fileServer.writeFileSync(generalPath, JSON.stringify(logs, null, 2)); 

        res.status(200).json("OK");

    } catch(error:any){
        logger.error("Error al intentar guardar un log de tipo general. " + error);
        res.status(500).send(false);
    }
});

router.delete('/', async (req:Request, res:Response) => {
    try{ 
        const generalPath = path.resolve(__dirname, '../log/general.json');
        const backupPath = path.resolve(__dirname, '../log/backup.json');
        const updatePath = path.resolve(__dirname, '../log/update.json');
        const facturacionPath = path.resolve(__dirname, '../log/facturacion.json');

        fileServer.writeFileSync(generalPath, '[]'); // Borramos archivo general
        fileServer.writeFileSync(backupPath, '[]'); // Borramos archivo buckups
        fileServer.writeFileSync(updatePath, '[]'); // Borramos archivo update
        fileServer.writeFileSync(facturacionPath, '[]'); // Borramos archivo facturacion

        res.status(200).json("OK");

    } catch(error:any){
        logger.error("Error al intentar borrar el listado de logs. " + error);
        res.status(500).send(false);
    }
});


// Export the router
export default router; 