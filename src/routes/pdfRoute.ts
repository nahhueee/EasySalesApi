import {Router, Request, Response} from 'express';
import { upload, fullPath } from '../conf/upload_config'; // Importar configuración de Multer y las variables
import logger from '../logger/loggerGeneral';
const router : Router  = Router();

const printer = require('pdf-to-printer');
const fs = require('fs');

router.post('/imprimir', upload.single('doc'), (req:Request, res:Response) => {
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

// Export the router
export default router; 