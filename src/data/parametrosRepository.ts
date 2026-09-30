import db from '../db';
import { Parametro } from '../models/Parametro';
import { esNombreLogoValido } from '../services/logoService';

// ─── parametros_impresion: columnas editables y cómo normalizar cada valor ───────────────────
const texto = (max: number) => (v: any) => String(v ?? '').trim().slice(0, max);
const textoOpcional = (max: number) => (v: any) => texto(max)(v) || null;
const booleano = (v: any) => (v === false || v === 0 || v === 'false' || v === '0') ? 0 : (v ? 1 : 0);
const entero = (v: any) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0;

const CAMPOS_IMPRESION: Record<string, (v: any) => any> = {
  impresora:            texto(100),
  papel:                texto(10),
  margenIzq:            entero,
  margenDer:            entero,
  nomLocal:             texto(100),
  desLocal:             texto(100),
  dirLocal:             texto(150),
  telefonoLocal:        textoOpcional(30),
  mensajeExtra:         textoOpcional(200),
  textoObservaciones:   (v: any) => texto(60)(v) || 'Observaciones',
  mostrarObservaciones: booleano,
  mostrarDireccion:     booleano,
  mostrarTelefono:      booleano,
  mostrarMensaje:       booleano,
  // null/'' = quitar el logo; un nombre con el formato que genera el server (ver logoService) = ese
  // logo; cualquier otra cosa devuelve undefined y se IGNORA (un valor hostil o un bug del front
  // no debe borrar el logo vigente).
  logo:                 (v: any) => (v === null || v === '') ? null : (esNombreLogoValido(v) ? v : undefined),
  mostrarLogo:          booleano,
  mostrarNombre:        booleano,
};

/**
 * Whitelist + normalización de un body de parametros_impresion: descarta claves desconocidas,
 * recorta strings, coerciona booleanos/enteros y omite lo que no viene (undefined). Lo usan el
 * UPDATE (ActualizarImpresion) y la vista previa (borrador sin guardar) — una sola definición
 * de qué es un valor válido.
 */
export function normalizarParametrosImpresion(data: any): Record<string, any> {
  const resultado: Record<string, any> = {};
  for (const [columna, normalizar] of Object.entries(CAMPOS_IMPRESION)) {
    if (data?.[columna] === undefined) continue;
    const valor = normalizar(data[columna]);
    if (valor === undefined) continue;   // valor inválido: se ignora, no se pisa el actual
    resultado[columna] = valor;
  }
  return resultado;
}

class ParametrosRepository{

  async ObtenerParametros(clave:string){
    const connection = await db.getConnection();

    try {
        
        let consulta = `SELECT valor FROM parametros WHERE clave = ?`;
        const rows = await connection.query(consulta,[clave]);
      
        if(rows[0][0]){
          if(rows[0][0].valor!="")
            return rows[0][0].valor
        }
        return null;

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

  async ActualizarParametro(data:any): Promise<string>{
    const connection = await db.getConnection();
    try {
        const consulta = `UPDATE parametros SET valor = ? WHERE clave = ?`;
        const parametros = [data.valor, data.clave];
        
        await connection.query(consulta, parametros);
        return "OK";

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

  async ActualizarFacturacion(data:any): Promise<string>{
    const connection = await db.getConnection();
    try {
        const consulta = `UPDATE parametros_facturacion 
                          SET 
                          condicion = ?, 
                          cuil = ?, 
                          puntoVta = ?,
                          razon = ?,
                          direccion = ?`;

        const parametros = [data.condicion, data.cuil, data.puntoVta, data.razon, data.direccion];
        
        await connection.query(consulta, parametros);
        return "OK";

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

  /**
   * Actualiza parametros_impresion (tabla de una sola fila) armando el UPDATE desde una
   * whitelist de columnas con nombre — antes era posicional (un `?` mal ordenado guardaba un
   * campo en otro sin error). Agregar una preferencia = una línea en CAMPOS_IMPRESION.
   * Solo se actualizan las claves presentes en `data`: un caller que no conoce un campo
   * nuevo no lo pisa.
   */
  async ActualizarImpresion(data:any): Promise<string>{
    const connection = await db.getConnection();
    try {
        const campos = normalizarParametrosImpresion(data);
        const columnas = Object.keys(campos);

        if (!columnas.length) return "OK";

        const sets = columnas.map(c => `${c} = ?`).join(', ');
        await connection.query(`UPDATE parametros_impresion SET ${sets}`, Object.values(campos));
        return "OK";

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

  async ObtenerParametrosImpresion(){
    const connection = await db.getConnection();

    try {
        
        const rows = await connection.query(`SELECT * FROM parametros_impresion`);
      
        if(rows[0][0]){
          return rows[0][0];
        }
        return null;

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }
  
  async ObtenerParametrosFacturacion(){
    const connection = await db.getConnection();

    try {
        
        const rows = await connection.query(`SELECT * FROM parametros_facturacion`);
      
        if(rows[0][0]){
          return rows[0][0];
        }
        return null;

    } catch (error:any) {
        throw error;
    } finally{
        connection.release();
    }
  }

}


export const ParametrosRepo = new ParametrosRepository();