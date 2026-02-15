import config from '../conf/app.config';
import FormData from 'form-data';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';

class AdminService{
     async ObtenerVersionApp() {
        try {
            const version = (await axios.get(`${config.adminUrl}actualizaciones/ultima-version/${config.idApp}`)).data;
            return version;
        } catch (error) {
            throw error;
        }
    }

    async ValidarIdentidad(dni:string){
        const cliente = await this.VerificarExistenciaCliente(dni);
        if(!cliente){
            return { existe:false };
        }

        const appCliente = await this.ObtenerAppCliente(dni);
        return {
            existe: true,
            cliente: appCliente.cliente,
            habilitado: appCliente.habilitado,
            terminal: appCliente.terminal
        };
    }

    async ObtenerHabilitacion(terminal:string){
        try {
            return (await axios.get(`${config.adminUrl}appscliente/habilitado/${terminal}/${config.idApp}`)).data;
        } catch (error) {
            mapAxiosError(error,'AdminService','ObtenerHabilitacion');
        }
    }

    async ObtenerAppCliente(dni:string){
        try {

            const response = await axios.get(`${config.adminUrl}appscliente/obtener/${dni}/${config.idApp}`);

            if(response.data){
                return response.data;
            }

            return await this.GenerarAppCliente(dni);

        } catch (error) {
            mapAxiosError(error,'AdminService','ObtenerAppCliente');
        }
    }


    async GenerarAppCliente(dni:string){
        try {

            const response = await axios.post(`${config.adminUrl}appscliente/generar`, {dni, idApp:config.idApp});

            if(!response.data){
                throw new AppError(
                    CodigoError.APPCLIENTE_CREACION_ERROR,
                    'No se pudo generar AppCliente', 500,
                    { modulo:'AdminService', metodo:'GenerarAppCliente' }
                );
            }

            GuardarTerminalLocal(response.data.terminal);

            return response.data;

        } catch (error) {
            mapAxiosError(error,'AdminService','GenerarAppCliente');
        }
    }


    async VerificarExistenciaCliente(DNI:string){
        try {

            const response = await axios.get(`${config.adminUrl}clientes/obtener/${DNI}`);
            return !!response.data;

        } catch (error) {
            mapAxiosError(error,'AdminService','VerificarExistenciaCliente');
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

function GuardarTerminalLocal(terminal: string) {
    const ROOT_DIR = process.cwd();

    const data = {
        terminal,
        fechaRegistro: new Date().toISOString()
    };

    fs.writeFileSync(path.join(ROOT_DIR, 'terminal.json'), JSON.stringify(data, null, 2));
}

function mapAxiosError(error:any, modulo:string, metodo:string){
   throw new AppError(
      CodigoError.ADMIN_SERVER_ERROR,
      'Error al comunicarse con AdminServer',
      error.response?.status || 500,
      {
         modulo,
         metodo,
         cause: error.message
      }
   );
}

  
export const AdminServ = new AdminService();