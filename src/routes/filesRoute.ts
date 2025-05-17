import {Router, Request, Response} from 'express';
import { upload, fullPath } from '../conf/upload_config'; // Importar configuración de Multer y las variables
import logger from '../log/loggerGeneral';
const router : Router  = Router();

import { procesarExcel } from '../services/excelService';

//#region IMPRESION DE PDFS
const printer = require('pdf-to-printer');
const fs = require('fs');

router.post('/imprimir-pdf', upload.single('doc'), (req:Request, res:Response) => {
    const printerName = req.body.printerName;

    printer.print(fullPath, { printer: printerName, orientation: 'portrait', scale: 'noscale'})
    .then(() => {
        res.status(200).json('OK');
        fs.unlinkSync(fullPath); // Elimina el archivo temporal
    })
    .catch((error) => {
        let msg = "Error al intentar imprimir el documento.";
        logger.error(msg + " " + error);
        res.status(500).send(msg);
    });   
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