import multer from 'multer';
const path = require('path');

let uniqueName: string = "";
let uploadPath: string = path.join(__dirname, "../upload/"); //Direccion donde se guardan los archivos
let fullPath:string;

//multer - Subida de archivos
const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, uploadPath); 
    },
    filename: function (_req, file, cb) {
        uniqueName = Date.now() + path.extname(file.originalname); // Nombre del archivo con fecha para evitar duplicados
        cb(null, uniqueName);

        fullPath = path.join(uploadPath, uniqueName); //Obtengo la ruta absoluta del archivo
    }
});

const upload = multer(
    { 
        storage: storage,   
        limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
    }
);

export { upload, uniqueName, fullPath, uploadPath };  //Exporto la configuracion de multer, el nombre unico, el path completo
// y uploadPath (carpeta de destino) -- este ultimo lo usa procesar-lista-precios para
// reconstruir la ruta de un archivo por su nombre (files/previsualizar-lista-precios,
// documentos/handoff_importacion_precios_proveedor.md), sin depender de `fullPath`.


