import dgram from 'dgram';
import os from 'os';
import {ParametrosRepo} from '../data/parametrosRepository';
import {AdminServ} from '../services/adminService';
import logger from '../log/loggerGeneral';
import config from '../conf/app.config';
import path from 'path';
const fs = require("fs-extra");

let udpServer;
const udpPort = 41234;

class ServidorService {

  async IniciarModoServidor(){
      try{ 
          //Obtenemos los parametros necesarios
          const dniCliente = await ParametrosRepo.ObtenerParametros('dni');


          if(dniCliente!=""){
            //Verificamos que el cliente este habilitado para usar este modo
            const habilitado = await AdminServ.ObtenerHabilitacion(dniCliente)
            if (!habilitado) {
                logger.info('Cliente inexistente o inhabilitado para activar modo servidor.');
                this.StopUDPDiscovery(false);

                //Si esta activo, pero el usuario ya no esta habilitado, cambiamos el estado de la variable en el config
                if(config.esServer){
                  //#region Cambiar la propiedad 'esServer' a false en el archivo de configuración
                  const configFilePath = path.resolve(__dirname, '../../config.pc.json');
                  
                  const rawConfig = await fs.readFile(configFilePath, 'utf-8');
                  const configuracion = JSON.parse(rawConfig);

                  configuracion.esServer = false;

                  // Guardar los cambios en el archivo de configuración
                  await fs.writeFile(configFilePath, JSON.stringify(configuracion, null, 2), 'utf-8');

                  logger.info('Se desactivó la clave en el servidor.');
                  //#endregion
                }

                return;
            }

            
          }

          if(config.esServer){
              this.StartUDPDiscovery();
            }else{
              this.StopUDPDiscovery(false);
            }
                
      } catch(error:any){
          logger.error("Error al intentar iniciar el modo servidor. " + error.message);
      }
  }

  async StartUDPDiscovery(): Promise<boolean> {
    if (udpServer) {
      return false;
    }

    udpServer = dgram.createSocket('udp4');

    udpServer.on('message', async (msg, rinfo) => {
      if (msg.toString() === 'DISCOVER_SERVER') {
        const response = Buffer.from(`DISCOVERY_RESPONSE|${getLocalIPAddress()}|7500`);
        udpServer.send(response, rinfo.port, rinfo.address);
      }
    });

    udpServer.on('error', (err) => {
      logger.error("Error al intentar iniciar UPD: " + err);
      this.StopUDPDiscovery(true); 
    });

    try {
      await new Promise<void>((resolve, reject) => {
        udpServer!.bind(udpPort, () => {
          logger.info(`Discovery habilitado en el puerto ${udpPort}`);
          resolve();
        });
      });
      return true;
    } catch (error) {
        throw error;
    }
  }

  StopUDPDiscovery(error: boolean = false): boolean {
    if (udpServer) {
      udpServer.close(() => {
        logger.info(error ? 'Discovery detenido por error' : 'Discovery detenido manualmente');
      });
      udpServer = undefined;
      return true;
    }       
    return false;
  }
}

export const ServidorServ = new ServidorService();



function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        return config.address;
      }
    }
  }
  return '127.0.0.1';
}
