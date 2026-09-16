import * as XLSX from 'xlsx';
import { ImportacionCostosRepo } from '../data/importacionCostosRepository';

// MVP importación de precios desde lista de proveedor --
// documentos/handoff_importacion_precios_proveedor.md.
//
// Separado de excelService.ts (que arma PRODUCTOS completos para /importar-excel) porque acá
// el archivo no tiene una forma fija: encabezado y columnas los elige el usuario en el paso 2
// (mat-stepper), y sólo interesan código + precio -- nunca el resto de las columnas.

export function LeerPrimerasFilas(rutaArchivo: string): string[][] {
    const workbook = XLSX.readFile(rutaArchivo);
    const hoja = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, range: 0, defval: '' }) as string[][];
    return filas.slice(0, 15);
}

interface ProcesarParams {
    rutaArchivo: string;
    filaHeader: number;   // 1-indexado, tal como lo ve el usuario en la previsualización
    colCodigo: string;    // texto de la columna de encabezado elegida
    colPrecio: string;
    idProveedor: number;
}

interface FilaMatcheada {
    filaExcel: number; codigoArchivo: string; idProducto: number;
    codigoProducto: string; nombre: string;
    costoActual: number | null; precioActual: number | null;
    costoNuevo: number; matcheoPor: 'PROVEEDOR' | 'CODIGO';
}
interface FilaNoEncontrada {
    filaExcel: number; codigoArchivo: string; descripcion: string; motivo: string;
}
interface FilaError {
    fila: number; mensaje: string;
}

export async function ProcesarListaPrecios(params: ProcesarParams): Promise<{
    matcheados: FilaMatcheada[]; noEncontrados: FilaNoEncontrada[]; errores: FilaError[];
}> {
    const workbook = XLSX.readFile(params.rutaArchivo);
    const hoja = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, range: 0, defval: '' }) as any[][];

    // filaHeader viene 1-indexado -- misma fila que el usuario vio en la previsualización.
    // Se valida contra el rango real de la hoja (handoff, endpoint 2): asumir fila 1 rompe
    // con archivos que traen un título mergeado arriba del encabezado real (caso del cliente).
    if (!Number.isInteger(params.filaHeader) || params.filaHeader < 1 || params.filaHeader > filas.length) {
        throw new Error('La fila de encabezado indicada no existe en el archivo.');
    }
    const indiceHeader = params.filaHeader - 1;
    const encabezado = (filas[indiceHeader] || []).map((c: any) => (c ?? '').toString().trim());

    const idxCodigo = encabezado.indexOf(params.colCodigo);
    const idxPrecio = encabezado.indexOf(params.colPrecio);
    if (idxCodigo === -1 || idxPrecio === -1) {
        throw new Error('La columna de código o de precio no se encontró en la fila de encabezado indicada.');
    }

    const errores: FilaError[] = [];

    interface FilaValida { filaExcel: number; codigoNorm: string; codigoArchivo: string; precio: number; }
    const validas: FilaValida[] = [];

    for (let i = indiceHeader + 1; i < filas.length; i++) {
        const filaExcel = i + 1; // 1-indexado, real, tal como lo ve el usuario en el archivo
        const fila = filas[i] || [];
        const codigoArchivo = (fila[idxCodigo] ?? '').toString().trim();
        const precioCrudo = fila[idxPrecio];

        if (codigoArchivo.length === 0) {
            errores.push({ fila: filaExcel, mensaje: 'Código vacío.' });
            continue;
        }
        if (precioCrudo === '' || precioCrudo === null || precioCrudo === undefined) {
            errores.push({ fila: filaExcel, mensaje: 'Precio vacío.' });
            continue;
        }
        const precio = Number(precioCrudo);
        if (isNaN(precio)) {
            errores.push({ fila: filaExcel, mensaje: 'Precio no numérico.' });
            continue;
        }
        if (precio <= 0) {
            errores.push({ fila: filaExcel, mensaje: 'Precio menor o igual a cero.' });
            continue;
        }

        validas.push({ filaExcel, codigoNorm: Normalizar(codigoArchivo), codigoArchivo, precio });
    }

    // Código duplicado dentro del archivo: la primera gana, las demás a errores con el
    // número de fila de ambas (handoff, endpoint 2).
    const porCodigo = new Map<string, FilaValida[]>();
    for (const f of validas) {
        if (!porCodigo.has(f.codigoNorm)) porCodigo.set(f.codigoNorm, []);
        porCodigo.get(f.codigoNorm)!.push(f);
    }
    const unicas: FilaValida[] = [];
    for (const grupo of porCodigo.values()) {
        unicas.push(grupo[0]);
        for (let i = 1; i < grupo.length; i++) {
            const otras = grupo.filter((_, idx) => idx !== i).map(g => g.filaExcel).join(', ');
            errores.push({
                fila: grupo[i].filaExcel,
                mensaje: `Código repetido en el archivo (filas ${otras}). Se usó la primera.`,
            });
        }
    }

    const mapaMatches = await ImportacionCostosRepo.MatchearCodigos(
        params.idProveedor,
        unicas.map(f => f.codigoNorm)
    );

    const matcheados: FilaMatcheada[] = [];
    const noEncontrados: FilaNoEncontrada[] = [];

    for (const f of unicas) {
        const match = mapaMatches.get(f.codigoNorm);

        if (!match) {
            noEncontrados.push({
                filaExcel: f.filaExcel, codigoArchivo: f.codigoArchivo, descripcion: '',
                motivo: 'No se encontró ningún producto con ese código.',
            });
            continue;
        }
        if (match.ambiguo) {
            noEncontrados.push({
                filaExcel: f.filaExcel, codigoArchivo: f.codigoArchivo, descripcion: '',
                motivo: 'Código ambiguo: coincide con más de un producto.',
            });
            continue;
        }

        matcheados.push({
            filaExcel: f.filaExcel,
            codigoArchivo: f.codigoArchivo,
            idProducto: match.idProducto!,
            codigoProducto: match.codigoProducto!,
            nombre: match.nombre!,
            costoActual: match.costoActual ?? null,
            precioActual: match.precioActual ?? null,
            costoNuevo: f.precio,
            matcheoPor: match.matcheoPor!,
        });
    }

    return { matcheados, noEncontrados, errores };
}

// Misma normalización que usa todo el módulo de proveedores.
function Normalizar(v: any): string {
    return (v ?? '').toString().replace(/\s+/g, ' ').trim().toUpperCase();
}
