import { Router, Request, Response, NextFunction } from 'express';
import moment from 'moment';
import { EventosConsultas, FiltroEventos } from '../data/eventosRepository';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { esUuidV4 } from '../utils/puestos';

// Fase 3.2-D (ver documentos/handoff_fase3_2cd_usuarios_baja_y_visor_eventos.md): visor de eventos.
// Solo lectura, sin evento propio y sin Zod (llega en Fase 4): validación manual y explícita.
// SIN autenticación real hasta la Fase 4: el acceso "solo ADMINISTRADOR" es del front (menú y
// botones); estos endpoints responden igual a cualquier cliente de la LAN.
const router: Router = Router();

const RANGO_MAX_DIAS = 366;
const TAMANIO_PAGINA_MAX = 100;
const TAMANIO_PAGINA_DEFAULT = 50;
const TEXTO_MAX = 100;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFICADOR = /^[A-Za-z_]{1,40}$/;

const invalido = (mensaje: string) => new AppError(CodigoError.VALIDACION, mensaje, 400);

/** Fecha 'YYYY-MM-DD' (o ISO: se toma el día); ausente => undefined; basura => 400. */
function fechaOpcional(valor: unknown, campo: string): string | undefined {
    if (valor === undefined || valor === null || valor === '') return undefined;
    const dia = typeof valor === 'string' ? valor.slice(0, 10) : '';
    if (!FECHA.test(dia) || !moment(dia, 'YYYY-MM-DD', true).isValid()) {
        throw invalido(`La fecha '${campo}' es inválida (formato AAAA-MM-DD).`);
    }
    return dia;
}

function enteroOpcional(valor: unknown, campo: string): number | undefined {
    if (valor === undefined || valor === null || valor === '') return undefined;
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0) throw invalido(`El campo '${campo}' debe ser un número entero positivo.`);
    return n;
}

function parsearFiltros(body: any): FiltroEventos {
    body = body ?? {};

    let desde = fechaOpcional(body.desde, 'desde');
    const hasta = fechaOpcional(body.hasta, 'hasta');

    // Si solo viene 'hasta', el default de 7 días cuenta hacia atrás desde ahí.
    if (!desde && hasta) desde = moment(hasta, 'YYYY-MM-DD').subtract(6, 'days').format('YYYY-MM-DD');

    if (desde || hasta) {
        const ini = moment(desde ?? moment().subtract(6, 'days').format('YYYY-MM-DD'), 'YYYY-MM-DD');
        const fin = moment(hasta ?? moment().format('YYYY-MM-DD'), 'YYYY-MM-DD');
        if (fin.isBefore(ini)) throw invalido("La fecha 'hasta' no puede ser anterior a 'desde'.");
        if (fin.diff(ini, 'days') > RANGO_MAX_DIAS) {
            throw invalido(`El rango de fechas no puede superar ${RANGO_MAX_DIAS} días. Acotá la búsqueda.`);
        }
    }

    let idPuesto: string | undefined;
    if (body.idPuesto !== undefined && body.idPuesto !== null && body.idPuesto !== '') {
        if (!esUuidV4(body.idPuesto)) throw invalido("El campo 'idPuesto' es inválido.");
        idPuesto = body.idPuesto.toLowerCase();
    }

    let entidad: string | undefined;
    if (body.entidad !== undefined && body.entidad !== null && body.entidad !== '') {
        if (typeof body.entidad !== 'string' || !IDENTIFICADOR.test(body.entidad)) throw invalido("El campo 'entidad' es inválido.");
        entidad = body.entidad;
    }

    let acciones: string[] | undefined;
    if (body.accion !== undefined && body.accion !== null && body.accion !== '') {
        const lista = Array.isArray(body.accion) ? body.accion : [body.accion];
        if (lista.length > 50 || lista.some((a: unknown) => typeof a !== 'string' || !IDENTIFICADOR.test(a))) {
            throw invalido("El campo 'accion' es inválido.");
        }
        acciones = lista;
    }

    let texto: string | undefined;
    if (typeof body.texto === 'string' && body.texto.trim() !== '') texto = body.texto.trim().slice(0, TEXTO_MAX);

    const pagina = enteroOpcional(body.pagina, 'pagina') ?? 1;
    const tamanio = enteroOpcional(body.tamanioPagina, 'tamanioPagina') ?? TAMANIO_PAGINA_DEFAULT;

    return {
        desde, hasta,
        idUsuario: enteroOpcional(body.idUsuario, 'idUsuario'),
        idPuesto, entidad, acciones,
        entidadId: enteroOpcional(body.entidadId, 'entidadId'),
        texto,
        pagina,
        tamanioPagina: Math.min(tamanio, TAMANIO_PAGINA_MAX),
    };
}

router.post('/obtener', async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.json(await EventosConsultas.Obtener(parsearFiltros(req.body)));
    } catch (error: any) {
        next(error);
    }
});

router.get('/entidad/:entidad/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!IDENTIFICADOR.test(req.params.entidad)) throw invalido("El parámetro 'entidad' es inválido.");
        const id = enteroOpcional(req.params.id, 'id');
        if (id === undefined) throw invalido("El parámetro 'id' es inválido.");
        res.json(await EventosConsultas.ObtenerPorEntidad(req.params.entidad, id));
    } catch (error: any) {
        next(error);
    }
});

router.get('/filtros', async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.json(await EventosConsultas.ObtenerFiltros());
    } catch (error: any) {
        next(error);
    }
});

export default router;
