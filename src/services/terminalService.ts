import fs from 'fs';
import path from 'path';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { HabilitacionCacheServ } from './habilitacionCacheService';
import { AdminServ } from './adminService';

class TerminalService {

  private terminalCache: string = "";

  //Obtiene el nro de terminal desde el archivo local
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
