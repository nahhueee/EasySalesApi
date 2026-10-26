import logger from "../logger/loggerGeneral";

const fs = require('fs');
const path = require('path');
// Ruta del archivo de sesión
const sessionFile = path.join(__dirname, '../', 'session.json');

class SesionService{

    GuardarSesion(id, nombre, cargo) {
        const sesion = {
            id,
            nombre,
            cargo,
            fecha: new Date().toISOString() 
        };

        fs.writeFileSync(sessionFile, JSON.stringify(sesion, null, 2), 'utf8');
    }

    LeerSesion() {
        if (fs.existsSync(sessionFile)) {
            const data = fs.readFileSync(sessionFile, 'utf8');
            return JSON.parse(data);
        } else {
            logger.error("No existe un archivo de sesión para leer.");
            return null;
        }
    }
}
export const SesionServ = new SesionService();