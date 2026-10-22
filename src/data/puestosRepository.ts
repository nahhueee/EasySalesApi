import db from '../db';
import { ResultSetHeader } from 'mysql2';

// Fase 3.2-A (ver documentos/handoff_fase3_2a_puestos.md). Toda fecha la pone MySQL (NOW()),
// nunca Node (architecture.md §11.6). "Puesto activo" = visto en las últimas 24 horas.

const VENTANA_ACTIVO_HORAS = 24;

export interface Puesto {
    id: string;
    nombre: string | null;
    hostname: string | null;
    esServidor: boolean;
    primerVisto: Date;
    ultimoVisto: Date;
    so: string | null;
    versionFront: string | null;
    ipUltima: string | null;
    activo: boolean;
    segundosDesdeVisto: number;
}

class PuestosRepository {

    /**
     * Alta o actualización de los datos de la máquina. NO pisa `nombre` ni `primerVisto`.
     */
    async Registrar(data: {
        id: string;
        hostname: string | null;
        so: string | null;
        versionFront: string | null;
        ip: string | null;
        esServidor: boolean;
    }): Promise<void> {
        const connection = await db.getConnection();
        try {
            const consulta = `INSERT INTO puestos (id, hostname, so, versionFront, ipUltima, esServidor)
                              VALUES (?, ?, ?, ?, ?, ?)
                              ON DUPLICATE KEY UPDATE
                                  hostname     = VALUES(hostname),
                                  so           = VALUES(so),
                                  versionFront = VALUES(versionFront),
                                  ipUltima     = VALUES(ipUltima),
                                  esServidor   = VALUES(esServidor),
                                  ultimoVisto  = NOW()`;
            await connection.query(consulta, [
                data.id, data.hostname, data.so, data.versionFront, data.ip, data.esServidor ? 1 : 0
            ]);
        } finally {
            connection.release();
        }
    }

    /**
     * Marca el puesto como visto ahora. Un único INSERT ... ON DUPLICATE KEY (atómico): cubre el
     * puesto desconocido (front viejo que nunca llamó a /registrar) sin la carrera
     * UPDATE-luego-INSERT cuando llegan dos requests simultáneos.
     */
    async Tocar(id: string, ip: string | null, esServidor: boolean): Promise<void> {
        const connection = await db.getConnection();
        try {
            const consulta = `INSERT INTO puestos (id, ipUltima, esServidor) VALUES (?, ?, ?)
                              ON DUPLICATE KEY UPDATE
                                  ultimoVisto = NOW(),
                                  ipUltima    = VALUES(ipUltima),
                                  esServidor  = VALUES(esServidor)`;
            await connection.query(consulta, [id, ip, esServidor ? 1 : 0]);
        } finally {
            connection.release();
        }
    }

    async Obtener(): Promise<Puesto[]> {
        const connection = await db.getConnection();
        try {
            const consulta = `SELECT id, nombre, hostname, esServidor, primerVisto, ultimoVisto,
                                     so, versionFront, ipUltima,
                                     (ultimoVisto >= NOW() - INTERVAL ${VENTANA_ACTIVO_HORAS} HOUR) AS activo,
                                     TIMESTAMPDIFF(SECOND, ultimoVisto, NOW()) AS segundosDesdeVisto
                              FROM puestos
                              ORDER BY ultimoVisto DESC`;
            const [rows]: any = await connection.query(consulta);
            return rows.map((r: any) => ({
                ...r,
                esServidor: !!r.esServidor,
                activo: !!r.activo,
            }));
        } finally {
            connection.release();
        }
    }

    /** Nombre recortado; vacío = NULL (vuelve a mostrarse el hostname). Devuelve false si el puesto no existe. */
    async Renombrar(id: string, nombre: string): Promise<boolean> {
        const connection = await db.getConnection();
        try {
            const limpio = nombre.trim();
            const [res] = await connection.query<ResultSetHeader>(
                `UPDATE puestos SET nombre = ? WHERE id = ?`, [limpio === '' ? null : limpio, id]
            );
            return res.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    async ContarActivos(): Promise<number> {
        const connection = await db.getConnection();
        try {
            const [rows]: any = await connection.query(
                `SELECT COUNT(*) AS total FROM puestos WHERE ultimoVisto >= NOW() - INTERVAL ${VENTANA_ACTIVO_HORAS} HOUR`
            );
            return Number(rows[0].total);
        } finally {
            connection.release();
        }
    }
}

export const PuestosRepo = new PuestosRepository();
