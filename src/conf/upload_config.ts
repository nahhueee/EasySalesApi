import multer from 'multer';
const path = require('path');

let uniqueName: string = "";

//multer - Subida de archivos
const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, path.join(__dirname, "../images/")); //Direccion donde se guarda la imagen
    },
    filename: function (_req, file, cb) {
        uniqueName = Date.now() + path.extname(file.originalname); // Nombre del archivo con fecha para evitar duplicados
        cb(null, uniqueName);
    }
});

const upload = multer({ storage: storage });

export { upload, uniqueName };  //Exporto la configuracion de multer y el path completo


