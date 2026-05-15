import {Router, Request, Response} from 'express';
import {BackupsServ} from '../services/backupService';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
const router : Router  = Router();


router.get('/forzar', async (req:Request, res:Response, next) => {
    try{
        BackupsServ.IniciarCron();
        res.json('OK');

    } catch(error:any){
        next(new AppError(
            CodigoError.CRON_INIT_ERROR,
            'Error al intentar forzar el inicio del cron de backups.',
            500,
            { modulo: 'backupRoute.forzar' },
            error
        ));
    }
});

router.get('/generar', async (req:Request, res:Response, next) => {
    try{
        res.json(await BackupsServ.GenerarBackupLocal());

    } catch(error:any){
        next(new AppError(
            CodigoError.BACKUP_GENERACION_ERROR,
            'Error al intentar generar un backup local.',
            500,
            { modulo: 'backupRoute.generar' },
            error
        ));
    }
});

// Export the router
export default router;
