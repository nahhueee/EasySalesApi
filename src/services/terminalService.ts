import fs from 'fs';
import path from 'path';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { HabilitacionCacheServ } from './habilitacionCacheService';
import { AdminServ } from './adminService';

/**
 * SERVICIO DE TERMINAL
 * ====================
 * "Terminal" acá significa **la instalación completa del comercio** — la LAN entera
 * o la PC única, que es la unidad de licencia y lo que AdminServer habilita.
 * NO es una máquina física. Todos los puestos de una LAN comparten este id.
 *
 * Para identificar una máquina se usa el PUESTO (UUID generado por el front).
 * Ver architecture.md §1.2, §9.1, §9.2 y §18.5.
 *
 * ⚠️ NO RENOMBRAR `terminal.json` NI MOVERLO.
 * Lo lee también `updater/config/CheckearActualizacion.ts`, con su propia copia
 * de la lógica de lectura. El updater NO viaja en el ZIP de release
 * (scripts/build-update.js empaqueta solo dist/src y package.json), así que el
 * que está instalado en cada comercio no se actualiza remotamente.
 * Si se renombra el archivo, el updater de las 8 instalaciones existentes falla
 * al leerlo y deja de chequear actualizaciones de forma permanente: la
 * recuperación es una visita presencial a cada comercio.
 * Detalle completo en architecture.md §9.5 y §16.7.
 */
class TerminalService {

  private terminalCache: string = "";

  //Obtiene el nro de terminal (id de instalación) desde el archivo local
  private async ObtenerTerminal(): Promise<string> {

    if (this.terminalCache) return this.terminalCache;

    const ROOT_DIR = process.cwd();
    const TERMINAL_FILE = path.join(ROOT_DIR, 'terminal.json');

    //Si no existe el usuario aun no se autentico
    if (!fs.existsSync(TERMINAL_FILE)) {
      throw new AppError(
        CodigoError.TERMINAL_NO_ENCONTRADA,
        'No se encontró archivo terminal.json', 400,
        { modulo: 'TerminalHabilitacionService', metodo: 'obtenerTerminal' }
      );
    }

    //Verificamos que el archivo no este vacio
    const raw = fs.readFileSync(TERMINAL_FILE, 'utf-8');
    if (!raw || raw.trim().length === 0) {
      throw new AppError(
        CodigoError.TERMINAL_NO_ENCONTRADA,
        'Archivo terminal.json vacío', 400,
        { modulo: 'TerminalHabilitacionService', metodo: 'obtenerTerminal' }
      );
    }

    //Verificamos que el archivo tenga la propiedad TERMINAL
    const data = JSON.parse(raw);
    if (!data.terminal) {
      throw new AppError(
        CodigoError.TERMINAL_NO_ENCONTRADA,
        'Terminal no definida en archivo', 400,
        { modulo: 'TerminalHabilitacionService', metodo: 'obtenerTerminal' }
      );
    }

    this.terminalCache = data.terminal;
    return this.terminalCache;
  }

  async VerificarTerminalHabilitada(): Promise<void> {

    const terminal = await this.ObtenerTerminal();

    // verificar cache de AdminServer
    const token = await HabilitacionCacheServ.Obtener(terminal);

    if (token && token.expiracion > new Date()) {
      return;
    }

    // consultar admin si esta vencido el cache
    const habilitado = await AdminServ.ObtenerHabilitacion(terminal);

    if (!habilitado) {
      throw new AppError(
        CodigoError.AUTH_NO_HABILITADO,
        'Terminal inexistente o inhabilitado', 401,
        { modulo: 'TerminalHabilitacionService', metodo: 'VerificarTerminalHabilitada' }
      );
    }

    await HabilitacionCacheServ.Guardar({
      terminal,
      habilitado: true,
      expiracion: new Date(Date.now() + 1000 * 60 * 60 * 24)
    });
  }
}

export const TerminalServ = new TerminalService();
