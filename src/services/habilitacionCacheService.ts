export interface TokenHabilitacion {
  terminal: string;
  habilitado: boolean;
  expiracion: Date;
}


const habilitacionCache = new Map<string, TokenHabilitacion>();

class HabilitacionCacheService{
  async Obtener(terminal: string): Promise<TokenHabilitacion | null> {
    const token = habilitacionCache.get(terminal);

    if (!token) return null;

    // si venció, lo limpiamos
    if (token.expiracion <= new Date()) {
      habilitacionCache.delete(terminal);
      return null;
    }

    return token;
  };

  async Guardar(token: TokenHabilitacion): Promise<void> {
    habilitacionCache.set(token.terminal, token);
  };

  async Eliminar(terminal: string): Promise<void> {
    habilitacionCache.delete(terminal);
  };

  async limpiarVencidos(): Promise<void> {
    const now = new Date();
    for (const [terminal, token] of habilitacionCache.entries()) {
      if (token.expiracion <= now) {
        habilitacionCache.delete(terminal);
      }
    }
  }
};

export const HabilitacionCacheServ = new HabilitacionCacheService();