import {EtiquetasRepo} from '../data/etiquetasRepository';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
import { v4 as uuid } from 'uuid';
import { ParametrosRepo } from '../data/parametrosRepository';
import { EtiquetaService } from '../services/etiquetaService';
const router : Router  = Router();
const path = require('path');
const fs = require('fs');
const printer = require('pdf-to-printer');

const EtiquetaServ = new EtiquetaService();

//#region OBTENER
router.get('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Obtener(""));

    } catch(error:any){
        let msg = "Error al obtener el listado de etiquetas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.get('/obtener/:descripcion', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Obtener(req.params.descripcion));

    } catch(error:any){
        let msg = "Error al obtener el listado de etiquetas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-etiqueta/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.ObtenerEtiqueta(req.params.id));

    } catch(error:any){
        let msg = "Error al obtener la etiqueta nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar una etiqueta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar una etiqueta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar una etiqueta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region IMPRESION
// Impresión silenciosa de etiquetas en papel térmico (58mm/80mm): sin diálogo del
// navegador, mismo patrón que files/imprimir-pdf (pdf-to-printer, scale:'noscale').
// El flujo A4 sigue generándose en el front (abre el visor de PDF para revisar antes
// de imprimir) y no pasa por acá.
router.post('/imprimir-pdf', async (req: Request, res: Response) => {
  try {
    const { etiqueta, productos } = req.body;
    const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();

    if (!parametrosImpresion?.impresora) {
      res.status(400).send('No hay una impresora configurada en Parámetros de Impresión.');
      return;
    }

    const { buffer: pdfBuffer, orientation } = await EtiquetaServ.generarEtiquetasPDF(etiqueta, productos);

    const tempName = `etiquetas_${uuid()}.pdf`;
    const tempPath = path.join(__dirname, '..', 'temp', tempName);

    fs.writeFileSync(tempPath, pdfBuffer);

    //orientation se calcula según la forma real de la página (ver etiquetaService.ts) -
    //a diferencia de tickets, acá NO siempre es 'portrait'.
    await printer.print(tempPath, {
      printer: parametrosImpresion.impresora,
      orientation,
      scale: 'noscale'
    });

    fs.unlinkSync(tempPath);

    res.status(200).json('OK');

  } catch (error: any) {
    let msg = "Error al imprimir las etiquetas.";
    logger.error(msg + " " + error.message);
    res.status(500).send(msg);
  }
});
//#endregion

// Export the router
export default router;