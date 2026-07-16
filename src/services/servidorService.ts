import dgram from 'dgram';
import os from 'os';
import { logger } from '../logger/logger';
import { CodigoError } from '../logger/CodigosError';
import config, { configFilePath } from '../conf/app.config';
import isOnline from 'is-online';
import { TerminalServ } from './terminalService';
import { exec } from 'child_process';
const fs = require("fs-extra");

let udpServer;
const udpPort = 41234;

class ServidorService {

  /**
   * Persiste esServer en config.pc.json y reinicia PM2 para que tome efecto.
   *
   * Por qué hace falta el restart y no alcanza con mutar `config.esServer` en memoria:
   * el host de escucha del server (127.0.0.1 vs 0.0.0.0, ver index.ts) se decide una sola
   * vez en server.listen() al bootear el proceso. Node no puede re-bindear el socket a otro
   * host sin reiniciar.
   *
   * Antes esto lo hacía el front (Tauri, comando Rust change_config_reset) escribiendo el
   * archivo directo, asumiendo que `app` y `server` son carpetas hermanas — supuesto que se
   * rompe según cómo se instale el front. Se movió acá porque el backend siempre sabe resolver
   * su propio config.pc.json (ver configFilePath en app.config.ts), sin depender de dónde ni
   * cómo esté instalado el front.
   */
  async CambiarModoServidor(valor: boolean): Promise<void> {
    try {
      config.esServer = valor;

      await fs.writeJson(configFilePath, config, { spaces: 2 });

      logger.info(`Modo servidor actualizado a ${valor}, reiniciando PM2...`);

      // Se agenda el restart en vez de ejecutarlo ya mismo: así el caller (la ruta HTTP)
      // llega a mandar la respuesta OK antes de que el proceso se reinicie.
      setTimeout(() => this.RestartPm2(), 800);

    } catch (error: any) {
      logger.error({
          code:    CodigoError.INTERNAL_ERROR,
          message: error.message || 'Error al cambiar el modo servidor',
          modulo:  'servidorService',
          cause:   error.cause?.message,
          stack:   error.stack,
      });
      throw error;
    }
  }

  private RestartPm2(): void {
    const home = process.env.USERPROFILE || '';
    const pm2Path = `${home}\\AppData\\Roaming\\npm\\pm2.cmd`;

    exec(`"${pm2Path}" restart easysales`, (error, stdout, stderr) => {
      if (error) {
        logger.error({
            code:    CodigoError.INTERNAL_ERROR,
            message: `PM2 no pudo reiniciar easysales: ${stderr || error.message}`,
            modulo:  'servidorService',
        });
      }
    });
  }

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
