import logger from "../logger/loggerGeneral";
import { UsuariosRepo } from "../data/usuariosRepository";

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

    // usuarioId/puestoId explícitos (Lote 6 + PR 1, Fase 2 — auditoría real por request, ver
    // documentos/handoff_fase2_correcciones.md y documentos/handoff_pr1_identidad_puesto.md).
    // Pasada incremental: por ahora solo ventasRepository, cuentasCorsRepository y
    // cajasRepository los mandan. El resto de los ~29 call sites sigue cayendo al fallback de
    // session.json de abajo hasta que se migren uno por uno — session.json queda vivo
    // mientras tanto, no se saca todavía.
    async RegistrarMovimiento(accion:string, usuarioId?:number|string|null, puestoId?:string|null){
        if(usuarioId != null){
            await UsuariosRepo.RegistrarMovimiento(accion, usuarioId, puestoId ?? null);
            return;
        }

        const sesion = this.LeerSesion();
        if(sesion){
            await UsuariosRepo.RegistrarMovimiento(accion, sesion.id)
        }
    }
}
export const SesionServ = new SesionService();