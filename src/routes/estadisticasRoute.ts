import {EstadisticasRepo} from '../data/estadisticasRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();


router.get('/datos-ventas/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await EstadisticasRepo.ObtenerDatoVentasCaja(req.params.id));

    } catch(error:any){
        let msg = "Error al obtener los datos de venta de la caja.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/ventas-acumuladas', async (req:Request, res:Response) => {
    try{ 
        res.json(await EstadisticasRepo.ObtenerTotalesAcumulado(req.body));

    } catch(error:any){
        let msg = "Error al obtener los datos de venta acumulados.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/grafico-productos/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await EstadisticasRepo.ObtenerGraficoProductos(req.params.id));

    } catch(error:any){
        let msg = "Error al obtener los datos para el gráfico de productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/grafico-ganancias/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await EstadisticasRepo.ObtenerGraficoGanancias(req.params.id));

    } catch(error:any){
        let msg = "Error al obtener los datos para el gráfico de ganancias.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 