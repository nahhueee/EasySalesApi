import {Router} from 'express';
import logger from '../log/loggerGeneral';
import {ServidorServ} from '../services/servidorService';
import {ParametrosRepo} from '../data/parametrosRepository';

const router : Router  = Router();

router.post('/discovery', async (req, res) => {
    try{ 
        const estado = req.body.estado;
        console.log(estado)
        const resultado = estado
            ? await ServidorServ.StartUDPDiscovery()
            : ServidorServ.StopUDPDiscovery(false);

        if (resultado) {
            await ParametrosRepo.ActualizarParametro({clave: 'habilitaServidor', valor: estado ? 'true' : 'false'});
        }

        res.json({
            success: resultado,
            message: resultado
            ? `Discovery ${estado ? 'activado' : 'desactivado'} correctamente`
            : `No se pudo ${estado ? 'activar' : 'desactivar'} discovery`,
        });
    } catch(error:any){
        let msg = "Error al intentar habilitar o deshabilitar el descubrimiento del servidor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 