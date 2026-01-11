export interface TokenHabilitacion {
  dni: string;
  habilitado: boolean;
  expiracion: Date;
}


const habilitacionCache = new Map<string, TokenHabilitacion>();

class HabilitacionService{
  async Obtener(dni: string): Promise<TokenHabilitacion | null> {
    const token = habilitacionCache.get(dni);

    if (!token) return null;

    // si venció, lo limpiamos
    if (token.expiracion <= new Date()) {
      habilitacionCache.delete(dni);
      return null;
    }

    return token;
  };

  async Guardar(token: TokenHabilitacion): Promise<void> {
    habilitacionCache.set(token.dni, token);
  };

  async Eliminar(dni: string): Promise<void> {
    habilitacionCache.delete(dni);
  };

  async limpiarVencidos(): Promise<void> {
    const now = new Date();
    for (const [dni, token] of habilitacionCache.entries()) {
      if (token.expiracion <= now) {
        habilitacionCache.delete(dni);
      }
    }
  }
};

export const HabilitacionServ = new HabilitacionService();