import dgram from 'dgram';
import os from 'os';
import { logger } from '../logger/logger';
import { CodigoError } from '../logger/CodigosError';
import config from '../conf/app.config';
import isOnline from 'is-online';
import { TerminalServ } from './terminalService';
const fs = require("fs-extra");

let udpServer;
const udpPort = 41234;

class ServidorService {

  async IniciarModoServidor(){
      try{ 
          //Verificamos que este conectado a internet
          const conectado = await isOnline();
          if(!conectado) return;
          
          //Verificamos que el cliente este habilitado para usar este modo
          await TerminalServ.VerificarTerminalHabilitada();
          
          if(config.esServer){
            this.StartUDPDiscovery();
          }else{
            this.StopUDPDiscovery(false);
          }
                
      } catch(error:any){
          logger.error({
              code:    CodigoError.INTERNAL_ERROR,
              message: error.message || 'Error al iniciar modo servidor',
              modulo:  'servidorService',
              cause:   error.cause?.message,
              stack:   error.stack,
          });
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

    udpServer.on('error', (err: any) => {
      logger.error({
          code:    CodigoError.INTERNAL_ERROR,
          message: err.message || 'Error en socket UDP de discovery',
          modulo:  'servidorService',
          cause:   err.cause?.message,
          stack:   err.stack,
      });
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
