import {Router, Request, Response} from 'express';
import { upload, fullPath } from '../conf/upload_config'; // Importar configuración de Multer y las variables
import logger from '../log/loggerGeneral';
import { v4 as uuid } from 'uuid';
const router : Router  = Router();
const path = require('path');

import { procesarExcel } from '../services/excelService';
import { ParametrosRepo } from '../data/parametrosRepository';
import ComprobanteServ from '../services/comprobanteService';

//#region IMPRESION DE PDFS
const printer = require('pdf-to-printer');
const fs = require('fs');

router.post('/imprimir-pdf', async (req: Request, res: Response) => {
  try {
    const venta = req.body.venta;
    const tipoComprobante = req.body.tipoComprobante;
    const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();
    const pdfBuffer = await ComprobanteServ.GenerarComprobantePDF(venta, parametrosImpresion, tipoComprobante) 

    //Crear archivo temporal
    const tempName = `impresion_${uuid()}.pdf`;
    const tempPath = path.join(__dirname, '..', 'temp', tempName);

    fs.writeFileSync(tempPath, pdfBuffer);

    //Enviar a la impresora
    await printer.print(tempPath, {
      printer: parametrosImpresion.impresora,
      orientation: 'portrait',
      scale: 'noscale'
    });

    //Eliminar archivo temporal
    fs.unlinkSync(tempPath);

    res.status(200).json('OK');

  } catch (error: any) {
    let msg = "Error al imprimir el documento.";
    logger.error(msg + " " + error.message);
    res.status(500).send(msg);
  }
});

router.post('/ver-comprobante/:tipoComprobante', async (req: Request, res: Response) => {
  try {
    const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();
    const pdfBuffer = await ComprobanteServ.GenerarComprobantePDF(req.body, parametrosImpresion, req.params.tipoComprobante);

    // Devolver el PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=comprobante.pdf');
    res.send(pdfBuffer);

  } catch (error: any) {
    let msg = "Error al generar el comprobante.";
    logger.error(msg + " " + error.message);
    res.status(500).send(msg);
  }
});
//#endregion

//#region IMPORTACION DE EXCEL
router.post('/importar-excel', upload.single('excel'), async (req, res) => {
  try {
    const tipoPrecio = req.body.tipoPrecio;
    res.json(await procesarExcel(fullPath, tipoPrecio));

  } catch(error:any){
        let msg = "Error al intentar importar el excel.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 