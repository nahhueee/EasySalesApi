import * as XLSX from 'xlsx';
import fs from 'fs';

interface FilaExcel {
  codigo: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  precio: number;
  costo: number;
  porcentaje: number;
  redondeo: number;
  [key: string]: any;
}

interface ResultadoImportacion {
  errores: { fila: number; mensaje: string }[];
  datosValidos: FilaExcel[]
}

export async function procesarExcel(filePath: string, tipoPrecio:string): Promise<ResultadoImportacion> {
  const errores: { fila: number; mensaje: string }[] = [];
  const datosValidos: FilaExcel[] = [];
  const filasDeDatosValidos: number[] = []; // filaNum de cada elemento de datosValidos, mismo indice (para el chequeo de duplicados de abajo)

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const datos: FilaExcel[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    const unidadesPermitidas = ['UNI', 'KG', 'LIT'];
    const redondeosPermitidos = [0, 5, 10];

    // PR 2.2 (handoff_repuestos_fases1_2_3.md) — normaliza SOLO espacios en marca/vehiculo/
    // aplicacion, nunca el contenido: decision cerrada con Nahu de no corregir "PEUG" a
    // "PEUGEOT" en silencio (el importador no normaliza, el autocomplete evita que se
    // reproduzca de acá en adelante). Se reusa tambien para componer el nombre.
    const colapsarEspacios = (v: any): string => (v ?? '').toString().replace(/\s+/g, ' ').trim();

    for (let i = 0; i < datos.length; i++) {
      const fila = datos[i];
      const filaNum = i + 2; // +2 porque los encabezados están en la fila 1

      if (fila.marca !== undefined && fila.marca !== '') fila.marca = colapsarEspacios(fila.marca);
      if (fila.vehiculo !== undefined && fila.vehiculo !== '') fila.vehiculo = colapsarEspacios(fila.vehiculo);
      if (fila.aplicacion !== undefined && fila.aplicacion !== '') fila.aplicacion = colapsarEspacios(fila.aplicacion);

      // Si no viene nombre pero sí categoria/marca/vehiculo, se compone (PR 2.2). La
      // aplicacion NO entra: sumada se pasa de VARCHAR(100) en filas reales del cliente y
      // hace ilegible el ticket de 58mm (medido sobre 1927 filas — ver handoff).
      if (!fila.nombre) {
        const partes = [fila.categoria, fila.marca, fila.vehiculo]
          .map(p => colapsarEspacios(p))
          .filter(p => p.length > 0);
        if (partes.length > 0) fila.nombre = colapsarEspacios(partes.join(' '));
      }

      //Modo catalogo ('C'): solo el codigo es obligatorio. No es un tipoPrecio real,
      //es un modo de importacion; se completan defaults y se guarda como '$' (ver filesRoute/actualizar-varios).
      if (tipoPrecio === 'C') {
        if (!fila.codigo || !fila.nombre) {
          errores.push({ fila: filaNum, mensaje: 'Faltan campos obligatorios' });
          continue;
        }
        if (!fila.cantidad) fila.cantidad = 0;
        if (!fila.unidad) fila.unidad = 'UNI';
        fila.costo = 0;
        fila.precio = 0;
      } else if (!fila.codigo || !fila.nombre || fila.cantidad == null || !fila.unidad || fila.costo == null ) {
        errores.push({ fila: filaNum, mensaje: 'Faltan campos obligatorios' });
        continue;
      }

      //Validacion Campos para precio fijo
      if(tipoPrecio=="$"){
        if(fila.precio == null){
          errores.push({ fila: filaNum, mensaje: 'Faltan campos obligatorios: precio' });
          continue;
        }
        if (isNaN(Number(fila.cantidad)) || isNaN(Number(fila.precio)) || isNaN(Number(fila.costo))) {
          errores.push({ fila: filaNum, mensaje: 'Cantidad, precio o costo no son números válidos' });
          continue;
        }
      }
      
      //Validacion Campos para precio porcentaje
      if(tipoPrecio=="%"){
        if (fila.porcentaje == null || fila.redondeo == null) {
          errores.push({ fila: filaNum, mensaje: 'Faltan campos obligatorios: porcentaje o redondeo' });
          continue;
        }

        if (isNaN(Number(fila.cantidad)) || isNaN(Number(fila.porcentaje)) || isNaN(Number(fila.costo)) || isNaN(Number(fila.redondeo))) {
          errores.push({ fila: filaNum, mensaje: 'Cantidad, costo, porcentaje o redondeo no son números válidos' });
          continue;
        }

        if (!redondeosPermitidos.includes(fila.redondeo)) {
          errores.push({ fila: filaNum, mensaje: 'Redondeo inválido (solo se permiten 0, 5 o 10)' });
          continue;
        }
      }
            

      if (!unidadesPermitidas.includes(fila.unidad.toUpperCase())) {
        errores.push({ fila: filaNum, mensaje: 'Unidad inválida (solo se permiten UNI, KG o LIT)' });
        continue;
      }

      fila.filaExcel = filaNum; // fila real del archivo (con encabezado); usada para reportar advertencias (PR 1.2b) sin volver a buscarla
      datosValidos.push(fila); 
      filasDeDatosValidos.push(filaNum);
    }

    // PR 1.2a — duplicados de codigo dentro del propio archivo (handoff_repuestos_fases1_2_3.md).
    // Se detectan aparte del bucle principal porque hace falta ver el archivo completo antes de
    // saber que un codigo se repite. Se descartan TODAS las filas del grupo, no solo la segunda:
    // sin el dato correcto no hay forma de saber cual de las dos es la valida.
    const indicesPorCodigo = new Map<string, number[]>();
    datosValidos.forEach((fila, idx) => {
      const codigoNorm = fila.codigo.toString().trim().toUpperCase();
      if (!indicesPorCodigo.has(codigoNorm)) indicesPorCodigo.set(codigoNorm, []);
      indicesPorCodigo.get(codigoNorm)!.push(idx);
    });

    const indicesRepetidos = new Set<number>();
    for (const indices of indicesPorCodigo.values()) {
      if (indices.length <= 1) continue;
      for (const idx of indices) {
        const otrasFilas = indices.filter(i => i !== idx).map(i => filasDeDatosValidos[i]).join(', ');
        errores.push({
          fila: filasDeDatosValidos[idx],
          mensaje: `Código repetido en el archivo (filas ${otrasFilas}). Corregir o eliminar una.`
        });
        indicesRepetidos.add(idx);
      }
    }

    const datosValidosSinDuplicados = indicesRepetidos.size > 0
      ? datosValidos.filter((_, idx) => !indicesRepetidos.has(idx))
      : datosValidos;

    return { errores, datosValidos: datosValidosSinDuplicados };
  } finally {
    // Elimina archivo temporal
    fs.unlinkSync(filePath);
  }
}
