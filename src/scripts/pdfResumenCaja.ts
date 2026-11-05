/**
 * Genera en disco los PDF del resumen de caja (58mm, 80mm y A4) SIN impresora, para revisar el
 * layout y probar casos de la verificación de la 3.4-C (handoff_fase3_4c_impresion_resumen_caja.md §7).
 *
 * Uso:
 *   npx ts-node src/scripts/pdfResumenCaja.ts                  -> con datos de ejemplo (no toca la base)
 *   npx ts-node src/scripts/pdfResumenCaja.ts <idCaja> [idCierre] [ciego]
 *        -> con la caja real (lee la base; no modifica nada). "ciego" simula un arqueo ciego.
 *
 * Genera reportes/resumen_caja_<modo>_<papel>.pdf en la raíz del proyecto API.
 */
import fs from 'fs';
import path from 'path';
import { ComprobanteService, ResumenCajaImpresion } from '../services/comprobanteService';

const PAPELES = ['58mm', '80mm', 'A4'];

const PARAMETROS: any = {
  papel: '80mm', margenIzq: 5, margenDer: 5, nomLocal: 'Kiosco Demo', desLocal: 'Golosinas y más',
  dirLocal: 'Av. Siempre Viva 742', telefonoLocal: '11 5555-0000',
  mostrarDireccion: 1, mostrarTelefono: 1, mostrarMensaje: 0, mostrarLogo: 0, mostrarNombre: 1,
};

function ejemplo(): ResumenCajaImpresion {
  return {
    modo: 'cierre', ciego: false, reimpresion: { numero: 1, total: 2 },
    cierre: { fecha: '26/10/2026', hora: '20:15', usuario: 'María', puesto: 'Caja 1',
              esperado: 216900, contado: 215400, diferencia: -1500, observacion: 'Faltó un billete de $1.000 que se entregó de cambio y no se anotó en la planilla.' },
    impreso: '04/11/2026 23:50',
    resumen: {
      caja: { id: 12, responsable: 'María', apertura: { fecha: '2026-10-26', hora: '08:00:00' }, historica: false },
      cajon: { cambioInicial: 20000, ventasEfectivo: 180000, cobrosImputados: 25000, ingresos: 5000, egresos: 8000,
               pagosProveedorSinFondo: 0, excedenteProveedores: 5100, esperado: 216900 },
      fondo: { asignado: 50000, pagado: 55100, disponible: 0, excedente: 5100, pagos: [] },
      otrosMedios: [{ medio: 'DÉBITO', cantidadVentas: 14, total: 98000 }, { medio: 'TRANSFERENCIA', cantidadVentas: 3, total: 41500 }],
      info: {
        totalVendido: 340000, cantidadVentas: 52, fiado: 12000, saldoAFavorUsado: 3000,
        cobrosFueraDeCaja: { cantidad: 2, total: 9000, items: [{ hora: '10:20:00', cliente: 'Juan Pérez', metodo: 'TRANSFERENCIA', monto: 5000 }, { hora: '17:05:00', cliente: 'Lucía Gómez', metodo: 'DÉBITO', monto: 4000 }] },
        notasCredito: { cantidad: 1, total: 2500 },
        anulaciones: { cantidad: 2, total: 7800, items: [{ idVenta: 1021, hora: '11:02', total: 4300, usuario: 'María' }, { idVenta: 1044, hora: '15:40', total: 3500, usuario: 'Pedro' }] },
      },
      control: { ventasAcumulador: 340000, ventasRecalculado: 340000, desvio: 0 },
    },
  };
}

async function main() {
  const [idCaja, idCierre, flag] = process.argv.slice(2);
  const servicio = new ComprobanteService();
  let casos: { nombre: string; datos: ResumenCajaImpresion }[];

  if (idCaja) {
    // Import tardío: sin argumentos no se necesita la base.
    const { CierreCajaServ } = await import('../services/cierreCajaService');
    const datos = await CierreCajaServ.ArmarImpresion(Number(idCaja), idCierre && idCierre !== '-' ? Number(idCierre) : null,
                                                       flag === 'ciego' ? null : process.env.USUARIO_ID ?? '1');
    casos = [{ nombre: datos.modo, datos }];
  } else {
    const base = ejemplo();
    const ciego: ResumenCajaImpresion = { ...base, ciego: true, reimpresion: null,
      resumen: { caja: base.resumen.caja }, cierre: { ...base.cierre!, esperado: null, diferencia: null } };
    const sinContar: ResumenCajaImpresion = { ...base, reimpresion: null,
      cierre: { ...base.cierre!, contado: null, diferencia: null, observacion: null } };
    const parcial: ResumenCajaImpresion = { ...base, modo: 'parcial', reimpresion: null, cierre: null };
    const sinFondo: ResumenCajaImpresion = { ...sinContar, resumen: { ...base.resumen, fondo: null, otrosMedios: [] } };
    const incompleto: ResumenCajaImpresion = { ...base, reimpresion: null, resumen: { caja: base.resumen.caja, cajon: { esperado: 100 } } };
    casos = [
      { nombre: 'reimpresion', datos: base }, { nombre: 'ciego', datos: ciego }, { nombre: 'sin_contar', datos: sinContar },
      { nombre: 'parcial', datos: parcial }, { nombre: 'sin_fondo', datos: sinFondo }, { nombre: 'foto_incompleta', datos: incompleto },
    ];
  }

  const salida = path.join(__dirname, '..', '..', 'reportes');
  fs.mkdirSync(salida, { recursive: true });
  for (const c of casos) {
    for (const papel of PAPELES) {
      const pdf = await servicio.generarResumenCajaPDF(c.datos, PARAMETROS, papel);
      const archivo = path.join(salida, `resumen_caja_${c.nombre}_${papel}.pdf`);
      fs.writeFileSync(archivo, pdf);
      console.log('OK', archivo);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
