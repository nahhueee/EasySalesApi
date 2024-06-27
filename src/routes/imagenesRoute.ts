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
        const imagePath = path.join(__dirname, "../images/", req.params.imgName);
  
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