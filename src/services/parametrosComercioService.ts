import db from '../db';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { EventosRepo } from '../data/eventosRepository';
import { auditoriaDesde } from '../utils/auditoria';

// Fase 3.4-P (ver documentos/handoff_fase3_4p_config_comercio.md): configuración de Preferencias
// a nivel COMERCIO (tabla `parametros`), igual para todas las PCs. Antes vivía en localStorage.
//
// - `valor` NO admite NULL (VARCHAR(50) NOT NULL en el schema real), así que "sin migrar" se guarda
//   con el centinela SIN_MIGRAR (lo inserta la migration 20261104090000_parametros_comercio).
// - La lista de claves y sus defaults es ESTA y la del front (EasySalesApp: config-comercio.ts).
//   Si cambia una, cambia la otra.

export const SIN_MIGRAR = '__sin_migrar__';

// Marca del aviso único al admin. No es una clave de comercio: no se configura desde Preferencias.
export const CLAVE_REVISADA = 'configComercioRevisada';

// Default = comportamiento histórico con localStorage vacío (parametros.service.ts del front):
// todos `=== 'true'` salvo borrarVentas y ventaCC (`!== 'false'`).
export const CLAVES_COMERCIO: Readonly<Record<string, boolean>> = {
    ventasYtotales: false,
    resumenCaja: false,
    ventasCliente: false,
    gestionClientes: false,
    cambioPrecio: false,
    borrarVentas: true,
    ventaCC: true,
    iva: false,
    listasPrecios: false,
    presupuestos: false,
    vencimientos: false,
    precioEditableVenta: false,
    edicionResultadoUnico: false,
};

const NOMBRES = Object.keys(CLAVES_COMERCIO);

export type ValoresComercio = Record<string, boolean | null>;

// 'true' / 'false' -> boolean; cualquier otra cosa (centinela, '', basura) -> null = sin migrar.
function parsear(valor: any): boolean | null {
    if (valor === 'true') return true;
    if (valor === 'false') return false;
    return null;
}

class ParametrosComercioService {

    // Un solo proceso de backend: alcanza con invalidar al escribir, sin TTL.
    private cache: ValoresComercio | null = null;

    private Error(mensaje: string, status: number, contexto: object): AppError {
        return new AppError(CodigoError.VALIDACION, mensaje, status, { modulo: 'ParametrosComercioService', ...contexto });
    }

    // Body { clave: boolean }: clave desconocida o valor no booleano => 400. Estricto a propósito:
    // un 'true' en string o un 1 no se coercionan, el front manda booleanos.
    private Validar(valores: any): Record<string, boolean> {
        if (valores === null || typeof valores !== 'object' || Array.isArray(valores)) {
            throw this.Error('Formato de configuración inválido.', 400, {});
        }

        const limpio: Record<string, boolean> = {};
        for (const [clave, valor] of Object.entries(valores)) {
            if (!(clave in CLAVES_COMERCIO)) {
                throw this.Error(`Configuración desconocida: ${clave}.`, 400, { clave });
            }
            if (typeof valor !== 'boolean') {
                throw this.Error(`El valor de ${clave} tiene que ser verdadero o falso.`, 400, { clave });
            }
            limpio[clave] = valor;
        }
        return limpio;
    }

    // Una sola query para las 13 claves. null = sin migrar (o fila inexistente).
    private async Leer(connection: any, bloquear = false): Promise<ValoresComercio> {
        const [rows] = await connection.query(
            `SELECT clave, valor FROM parametros WHERE clave IN (?)${bloquear ? ' FOR UPDATE' : ''}`, [NOMBRES]
        ) as [any[], any];

        const valores: ValoresComercio = {};
        for (const clave of NOMBRES) valores[clave] = null;
        for (const fila of rows) valores[fila.clave] = parsear(fila.valor);
        return valores;
    }

    async Obtener(): Promise<{ valores: ValoresComercio }> {
        if (!this.cache) {
            const connection = await db.getConnection();
            try {
                this.cache = await this.Leer(connection);
            } finally {
                connection.release();
            }
        }
        return { valores: { ...this.cache } };
    }

    // Uso interno del backend: si todavía está sin migrar devuelve el default histórico.
    async ObtenerBool(clave: string): Promise<boolean> {
        if (!(clave in CLAVES_COMERCIO)) {
            throw new Error(`ParametrosComercio.ObtenerBool: clave desconocida (${clave}).`);
        }
        const { valores } = await this.Obtener();
        return valores[clave] ?? CLAVES_COMERCIO[clave];
    }

    // Guarda (PUT). El permiso (solo ADMINISTRADOR) lo valida la ruta: acá no se importa utils/permisos
    // para no armar un import circular con EsArqueoCiego, que usa este servicio.
    async Guardar(valores: any, usuarioId?: number | string | null, puestoId?: string | null): Promise<{ valores: ValoresComercio }> {
        const nuevos = this.Validar(valores);
        const claves = Object.keys(nuevos);
        if (!claves.length) {
            throw this.Error('No se recibió ninguna configuración para guardar.', 400, {});
        }

        const auditoria = auditoriaDesde(usuarioId, puestoId);
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Por si la fila faltara (migration a medias), y para tomar el lock de las filas.
            await connection.query(
                `INSERT IGNORE INTO parametros (clave, valor) VALUES ?`, [claves.map(c => [c, SIN_MIGRAR])]
            );
            const actuales = await this.Leer(connection, true);   // FOR UPDATE: el 'antes' del evento no puede ser de una lectura vieja

            // Solo lo que cambia el valor EFECTIVO (el default cuenta como valor si estaba sin migrar).
            const datosAntes: Record<string, boolean> = {};
            const datosDespues: Record<string, boolean> = {};
            for (const clave of claves) {
                const antes = actuales[clave] ?? CLAVES_COMERCIO[clave];
                if (antes !== nuevos[clave]) {
                    datosAntes[clave] = antes;
                    datosDespues[clave] = nuevos[clave];
                }
            }

            for (const clave of claves) {
                await connection.query(`UPDATE parametros SET valor = ? WHERE clave = ?`, [String(nuevos[clave]), clave]);
            }

            // Guardar Preferencias = el admin ya revisó: se apaga el aviso único.
            await this.MarcarRevisada(connection, 'true');

            const cambiadas = Object.keys(datosDespues);
            if (cambiadas.length) {
                await EventosRepo.Registrar(connection, {
                    accion: 'PARAMETROS_COMERCIO_ACTUALIZAR',
                    entidad: 'parametros',
                    datosAntes,
                    datosDespues,
                    descripcion: `Configuración del comercio modificada: ${cambiadas.join(', ')}`.slice(0, 255),
                    auditoria,
                });
            }

            await connection.commit();

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        this.cache = null;
        return this.Obtener();
    }

    // Importación única desde localStorage (POST). Cualquiera puede llamarla porque SOLO escribe
    // sobre claves en SIN_MIGRAR: nunca pisa un valor ya migrado. Gana la primera terminal; la
    // segunda recibe lo que quedó en la base.
    async Importar(valores: any, usuarioId?: number | string | null, puestoId?: string | null): Promise<{ valores: ValoresComercio, importadas: string[] }> {
        const aImportar = this.Validar(valores);
        const claves = Object.keys(aImportar);
        const importadas: string[] = [];

        if (claves.length) {
            const auditoria = auditoriaDesde(usuarioId, puestoId);
            const connection = await db.getConnection();

            try {
                await connection.beginTransaction();

                await connection.query(
                    `INSERT IGNORE INTO parametros (clave, valor) VALUES ?`, [claves.map(c => [c, SIN_MIGRAR])]
                );

                for (const clave of claves) {
                    const [resultado] = await connection.query(
                        `UPDATE parametros SET valor = ? WHERE clave = ? AND valor = ?`,
                        [String(aImportar[clave]), clave, SIN_MIGRAR]
                    ) as [any, any];

                    if (resultado.affectedRows > 0) importadas.push(clave);
                }

                if (importadas.length) {
                    const importados: Record<string, boolean> = {};
                    importadas.forEach(c => importados[c] = aImportar[c]);

                    await this.MarcarRevisada(connection, 'false');   // dispara el aviso único al admin
                    await EventosRepo.Registrar(connection, {
                        accion: 'PARAMETROS_COMERCIO_IMPORTAR',
                        entidad: 'parametros',
                        datosDespues: importados,
                        descripcion: `Configuración del comercio importada desde una terminal: ${importadas.join(', ')}`.slice(0, 255),
                        auditoria,
                    });
                }

                await connection.commit();

            } catch (error: any) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

            this.cache = null;
        }

        return { ...(await this.Obtener()), importadas };
    }

    private async MarcarRevisada(connection: any, valor: 'true' | 'false'): Promise<void> {
        await connection.query(
            `INSERT INTO parametros (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
            [CLAVE_REVISADA, valor]
        );
    }
}

export const ParametrosComercio = new ParametrosComercioService();
