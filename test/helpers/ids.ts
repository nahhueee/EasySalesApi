// Ids fijos del seed (scripts/test/seed-test.js) y de las semillas de la migration base.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seed = require('../../scripts/test/seed-test');

export const IDS: {
  usuarioAdmin: number; usuarioEmpleado: number; listaMayorista: number;
  productoSimple: number; productoMultiprecio: number;
  clienteConSaldo: number; clienteSinSaldo: number;
  cajaAbierta: number; cajaCerrada: number;
} = seed.IDS;
export const PASS_TEST: string = seed.PASS_TEST;

export const CONSUMIDOR_FINAL = 1;
export const TP = { EFECTIVO: 1, TRANSFERENCIA: 2, QR: 3, TARJETA: 4, CC: 6, SAF: 7, SENIA: 8 } as const;
export const TP_NOMBRE: Record<number, string> = {
  1: 'EFECTIVO', 2: 'TRANSFERENCIA', 3: 'QR', 4: 'TARJETA', 6: 'CUENTA CORRIENTE', 7: 'SALDO A FAVOR', 8: 'SEÑA',
};
