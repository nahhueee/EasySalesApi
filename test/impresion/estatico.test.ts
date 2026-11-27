// handoff_impresion_escpos.md CA-13: guard estático, un solo punto de impresión por driver.
import fs from 'fs';
import path from 'path';

function listarTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listarTs(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('CA-13: printer.print solo en los lugares permitidos', () => {
  const src = path.resolve(__dirname, '..', '..', 'src');
  const con = listarTs(src)
    .filter(f => fs.readFileSync(f, 'utf8').includes('printer.print('))
    .map(f => path.relative(src, f).replace(/\\/g, '/'))
    .sort();
  expect(con).toEqual([
    'routes/etiquetasRoute.ts',
    'routes/pdfRoute.ts',
    // pedidosRoute.ts ya no está: la ampliación del handoff del 2026-11-26 (encabezado y CA-13) la pasa al servicio.
    'services/impresionTermicaService.ts',
  ]);
});
