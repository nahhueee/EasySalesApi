import {Router, Request, Response} from 'express';
import { upload, uniqueName, uploadPath } from '../conf/upload_config'; // Importar configuración de Multer y la variable
import logger from '../logger/loggerGeneral';
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
        // imgName llega decodificado: "..%2F..%2Fconfig.pc.json" se convertía en "../../config.pc.json"
        // y sendFile servía cualquier archivo del servidor (certs AFIP, config con la password de la
        // DB, etc). Solo se sirven archivos que sean hijos directos de upload.
        const carpeta   = path.resolve(uploadPath);
        const imagePath = path.resolve(carpeta, req.params.imgName);

        if (path.dirname(imagePath) !== carpeta) {
            res.status(400).send("Nombre de imagen inválido.");
            return;
        }

        // Devolver la imagen
        res.sendFile(imagePath);

    } catch(error:any){
        let msg = "Error al obtener la imagen.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 