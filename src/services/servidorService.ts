import dgram from 'dgram';
import os from 'os';
import {ParametrosRepo} from '../data/parametrosRepository';

let udpServer;
const udpPort = 41234;

class ServidorService {
  async StartUDPDiscovery(): Promise<boolean> {
    if (udpServer) {
      console.log('🟡 Discovery ya estaba activo');
      return false;
    }

    udpServer = dgram.createSocket('udp4');

    udpServer.on('message', async (msg, rinfo) => {
      if (msg.toString() === 'DISCOVER_SERVER') {
        const enabled = await ParametrosRepo.ObtenerParametros('habilitaServidor');
        console.log(enabled)
        if (enabled) {
          const response = Buffer.from(`DISCOVERY_RESPONSE|${getLocalIPAddress()}|7500`);
          udpServer.send(response, rinfo.port, rinfo.address);
          console.log(`📡 Respondí a ${rinfo.address}`);
        }
      }
    });

    udpServer.on('error', (err) => {
      console.error('UDP error:', err);
      this.StopUDPDiscovery(true); 
    });

    try {
      await new Promise<void>((resolve, reject) => {
        udpServer!.bind(udpPort, () => {
          console.log(`🔎 Discovery habilitado en el puerto ${udpPort}`);
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
        console.log(error ? '⛔ Discovery detenido por error' : '🛑 Discovery detenido manualmente');
      });
      udpServer = undefined;
      return true;
    } else {
      console.log('⚠️ No había discovery activo para detener');
      return false;
    }
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
