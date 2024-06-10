import {Router, Request, Response} from 'express';
import { upload, fullFilePath } from '../conf/upload_config'; // Importar configuración de Multer y la variable
import logger from '../log/logger';
const router : Router  = Router();

router.post('/subir', upload.single('image'), (req:Request, res:Response) => {
    try{ 

        //Luego de subida la imagen y obtenido el path full, devuelvo al front solo lo que necesita para acceder desde assets
        let frontPathImg = fullFilePath.substring(fullFilePath.indexOf("assets"));
        return res.json(frontPathImg);

    } catch(error:any){
        let msg = "Error al subir una imagen.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 