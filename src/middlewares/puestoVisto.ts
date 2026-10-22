import { Request, Response, NextFunction } from 'express';
import { PuestosRepo } from '../data/puestosRepository';
import { logger } from '../logger/logger';
import { esLoopback, ipDeRequest, puestoIdDeRequest } from '../utils/puestos';

// Fase 3.2-A (ver documentos/handoff_fase3_2a_puestos.md): mantiene puestos.ultimoVisto sin
// agregar costo perceptible a cada request. Escribe como mucho una vez cada INTERVALO_MS por
// puesto (Map en memoria), fire-and-forget. Nunca bloquea ni rompe un request.
const INTERVALO_MS = 5 * 60 * 1000;

// Acotado por la cantidad de puestos distintos (UUIDs v4 válidos) que le hablan al backend.
const ultimaEscritura = new Map<string, number>();

export function puestoVisto(req: Request, _res: Response, next: NextFunction): void {
    try {
        const id = puestoIdDeRequest(req);
        if (id) {
            const ahora = Date.now();
            const previa = ultimaEscritura.get(id);
            if (previa === undefined || ahora - previa >= INTERVALO_MS) {
                ultimaEscritura.set(id, ahora);
                PuestosRepo.Tocar(id, ipDeRequest(req), esLoopback(req)).catch((error: any) => {
                    // Si falló, permitimos reintentar en el próximo request en vez de esperar 5 min.
                    ultimaEscritura.delete(id);
                    logger.warn({
                        type: 'PUESTO_VISTO_WARN',
                        message: `No se pudo actualizar ultimoVisto del puesto: ${error.message}`,
                        modulo: 'puestoVisto',
                    });
                });
            }
        }
    } catch {
        // Nunca romper el request por un fallo de auditoría.
    }
    next();
}
