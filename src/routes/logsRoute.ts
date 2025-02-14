import {Router, Request, Response} from 'express';
import logger, {limpiarLog } from '../log/logger';
import * as path from 'path';
const fs = require('fs').promises;

const router : Router  = Router();

router.get('/', async (req:Request, res:Response) => {
    try{ 

        const data = await fs.readFile(path.resolve(__dirname, '../log/error.json'), 'utf8');
        res.json(JSON.parse(data));

    } catch(error:any){
        logger.error("Eror al obtener listado de logs. " + error);
        res.status(500).send(false);
    }
});

router.delete('/', async (req:Request, res:Response) => {
    try{ 

        limpiarLog();
        res.status(200).json("OK");

    } catch(error:any){
        logger.error("Eror al intentar borrar el listado de logs. " + error);
        res.status(500).send(false);
    }
});


// Export the router
export default router; 