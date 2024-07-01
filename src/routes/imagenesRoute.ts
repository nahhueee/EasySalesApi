import {Router, Request, Response} from 'express';
import { upload, uniqueName } from '../conf/upload_config'; // Importar configuración de Multer y la variable
import logger from '../log/logger';
const router : Router  = Router();
const path = require('path');

router.post('/subir', upload.single('image'), (req:Request, res:Response) => {
    try{ 
        return res.json(uniqueName);

    } catch(error:any){
        let msg = "Error al subir una imagen.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener/:imgName', (req:Request, res:Response) => {
    try{ 
        const imagePath = path.join(__dirname, "../upload/", req.params.imgName);
  
        // Devolver la imagen
        res.sendFile(imagePath);

    } catch(error:any){
        let msg = "Error al obtener la imagen.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


const fs = require('fs');
const printerName:string = "XP-58 (copy 1)";
const printer = require('pdf-to-printer');

router.post('/imprimir', upload.single('doc'), (req:Request, res:Response) => {
    try{ 
        //        printer.print("D:\\1-CreationCode\\EasySales\\EasySalesApi\\src\\ticket.pdf", { printer: printerName })
        console.log(uniqueName)
        printer.print(uniqueName, { printer: printerName })
               .then(() => {
                    res.status(200).send('Impresión exitosa');
                    fs.unlinkSync(uniqueName); // Elimina el archivo temporal
                });

    } catch(error:any){
        let msg = "Error al intentar imprimir el documento.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 