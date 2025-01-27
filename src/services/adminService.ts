import config from '../conf/app.config';
import { ObjTerminal } from '../models/ObjTerminal';
const axios = require('axios');

class AdminService{
    
    async ObtenerVersionApp() {
        try {
            const version = (await axios.get(`${config.adminUrl}apps/obtener/${config.idApp}`)).data;
            return version;
        } catch (error) {
            throw error;
        }
    }

    async ObtenerHabilitacion(dni:string) {
        try {
            let mac = await GetMac();
            {
                if(mac)
                    return (await axios.get(`${config.adminUrl}appscliente/habilitado/${dni}/${config.idApp}/${mac}`)).data;
            }
        } catch (error) {
            throw error;
        }
    }

    async ObtenerAppCliente(dni:string){
        try {
            let appCliente:any;
            let mac = await GetMac();

            if(mac){
                //Obtiene el nro de terminal asociado a DNI y mac de esta app
                let response = await axios.get(`${config.adminUrl}appscliente/obtener/${dni}/${config.idApp}/${mac}`);
                console.log(response)
                if(response.data){
                    appCliente = response.data;
                }else{
                    //si no hay nro terminal generamos una nueva y retornamos la appcliente
                    appCliente = await this.GenerarAppCliente(dni, mac)
                }
            }
            
            return appCliente;
        
        } catch (error) {
            throw error;
        }
    }

    async GenerarAppCliente(dni:string, mac:string|any){
        try {
            const response = await axios.post(`${config.adminUrl}appscliente/generar`, {dni, idApp:config.idApp, mac});
            if (response.data) 
                return response.data;

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
  
export const AdminServ = new AdminService();