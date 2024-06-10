import multer from 'multer';
import config from './app.config';
const path = require('path');

let desPath: string = config.imgPath;
let fullFilePath: string = "";

//multer - Subida de archivos
const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, desPath); //Direccion donde se guarda la imagen
    },
    filename: function (_req, file, cb) {
        const uniqueName = Date.now() + path.extname(file.originalname); // Nombre del archivo con fecha para evitar duplicados
        fullFilePath = path.join(desPath, uniqueName); // Obtiene el path completo donde se sube el archivo con el nombre
        cb(null, uniqueName);
    }
});

const upload = multer({ storage: storage });

export { upload, fullFilePath };  //Exporto la configuracion de multer y el path completo


