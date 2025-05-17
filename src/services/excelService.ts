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

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const datos: FilaExcel[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    const unidadesPermitidas = ['UNI', 'KG', 'LIT'];
    const redondeosPermitidos = [0, 5, 10];

    for (let i = 0; i < datos.length; i++) {
      const fila = datos[i];
      const filaNum = i + 2; // +2 porque los encabezados están en la fila 1

      if (!fila.codigo || !fila.nombre || fila.cantidad == null || !fila.unidad || fila.costo == null ) {
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

      datosValidos.push(fila); 
    }
  } finally {
    // Elimina archivo temporal
    fs.unlinkSync(filePath);
  }

  return { errores, datosValidos };
}
