import config from '../conf/app.config';
import FormData from 'form-data';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { ParametrosRepo } from '../data/parametrosRepository';


class AdminService{
    
    async ObtenerVersionApp() {
        try {
            const version = (await axios.get(`${config.adminUrl}actualizaciones/ultima-version/${config.idApp}`)).data;
            return version;
        } catch (error) {
            throw error;
        }
    }

    async ObtenerHabilitacion(dni:string) {
        try {
            const resultado = (await axios.get(`${config.adminUrl}appscliente/habilitado/${dni}/${config.idApp}`)).data

            //Informamos la versión actual
            // if(resultado){
            //     const versionLocal = await ParametrosRepo.ObtenerParametros('version');
            //     await axios.put(`${config.adminUrl}appscliente/informar`, {dni, idApp:config.idApp, version:versionLocal})
            // }

            return resultado;
        } catch (error) {
            throw error;
        }
    }

    async ObtenerAppCliente(dni:string){
        try {
            let appCliente:any;

            //Obtiene los datos de la app asociadas al dni del cliente
            let response = await axios.get(`${config.adminUrl}appscliente/obtener/${dni}/${config.idApp}`);
            if(response.data){
                appCliente = response.data;
            }else{
                //si no hay nro terminal generamos una nueva y retornamos la appcliente
                appCliente = await this.GenerarAppCliente(dni)
            }
            
            return appCliente;
        
        } catch (error) {
            throw error;
        }
    }

    async GenerarAppCliente(dni:string){
        try {
            const response = await axios.post(`${config.adminUrl}appscliente/generar`, {dni, idApp:config.idApp});
            if (response.data){
                GuardarTerminalLocal(response.data.terminal);
                return response.data;
            }

            return null;
        } catch (error) {
            throw error;
        }
    }

    async VerificarExistenciaCliente(DNI:string) {
        try {
            const response = await axios.get(`${config.adminUrl}clientes/obtener/${DNI}`);
            if (response.data) { // Si existe el cliente con este DNI
                return true;
            }else{
                return false;
            }
        } catch (error) {
            throw error;
        }
    }

    async SubirBackup(backupPath:string, DNI:string){
        try {
            const formData = new FormData();
            formData.append("backup", fs.createReadStream(backupPath));
            formData.append("app", config.idApp); // aplicacion
            formData.append("dni", DNI); // usuario

            const headers = formData.getHeaders();
            const response = await axios.post(`${config.adminUrl}backups/upload`, formData, {
                headers,
            });
            if (response.data) 
                return response.data;

            return null;
        } catch (error) {
            throw error;
        }
    }
}

async function GetMac() {
    const macaddress = require('macaddress');

    return new Promise((resolve, reject) => {
        macaddress.one((err, mac) => {
        if (err) {
            reject(err);
        } else {
            resolve(mac);
        }
        });
    });
}

function GuardarTerminalLocal(terminal: string) {
    const ROOT_DIR = process.cwd();

    const data = {
        terminal,
        fechaRegistro: new Date().toISOString()
    };

    fs.writeFileSync(path.join(ROOT_DIR, 'terminal.json'), JSON.stringify(data, null, 2));
}
  
export const AdminServ = new AdminService();