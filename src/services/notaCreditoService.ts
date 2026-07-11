import moment from 'moment';
import db from '../db';
import { VentasRepo } from '../data/ventasRepository';
import { NotasCreditoRepo, NotaCreditoInput, NotaCreditoDetalleInput, NotaCreditoRow } from '../data/notasCreditoRepository';
import { CuentaCorrienteRepo } from '../data/cuentaCorrienteRepository';
import { FacturacionServ } from './facturacionService';
import { ObjFacturar, TipoComprobante } from '../models/objFacturar';
import { ObjQR } from '../models/ObjQR';
import { NotaCreditoImpresion } from './comprobanteService';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import loggerFacturacion from '../logger/loggerFacturacion';

/** Línea a acreditar en una NC parcial. La cantidad la decide el usuario; precio/producto se resuelven server-side contra la venta real — nunca se confía en lo que mande el front. */
export interface LineaNotaCredito {
  idVentaDetalle: number;
  cantidad: number;
}

export interface EmitirNotaCreditoInput {
  idVenta: number;
  motivo?: string;
  /** Sin líneas (u omitido) → NC total. Con líneas → NC parcial. */
  lineas?: LineaNotaCredito[];
}

/** Factura A/B/C → Nota de Crédito A/B/C correspondiente (objFacturar.ts). */
function mapearTipoNC(tipoFactura: number): TipoComprobante {
  const mapa: Partial<Record<number, TipoComprobante>> = {
    [TipoComprobante.FACTURA_A]: TipoComprobante.NC_A,
    [TipoComprobante.FACTURA_B]: TipoComprobante.NC_B,
    [TipoComprobante.FACTURA_C]: TipoComprobante.NC_C,
  };

  const tipoNC = mapa[tipoFactura];
  if (!tipoNC) {
    throw new AppError(CodigoError.VALIDACION, `Tipo de comprobante de la factura original no reconocido: ${tipoFactura}.`, 400);
  }
  return tipoNC;
}

/**
 * NotaCreditoService
 * ------------------
 * Emite una Nota de Crédito (total o parcial) contra una venta facturada, siguiendo
 * el dominio descrito en documentos/plan_clientes_cuentacorriente_nc.md (Sub-fase C):
 *
 *   1. Validar que la venta tenga factura con CAE.
 *   2. Si es parcial: validar que la venta no tenga descuento/recargo y que no haya
 *      sobre-acreditación por línea.
 *   3. Calcular el monto a acreditar (total disponible, o suma de líneas seleccionadas).
 *   4. Armar el comprobante asociado (la factura original) y emitir en AFIP.
 *   5. Persistir NC + detalle (si aplica) + movimiento `haber` en el ledger, en una
 *      transacción DB — después de tener el CAE, porque AFIP no es transaccional con
 *      la DB (ver catch de EmitirNotaCredito).
 */
class NotaCreditoService {

  async EmitirNotaCredito(input: EmitirNotaCreditoInput): Promise<NotaCreditoImpresion> {
    if (!input?.idVenta) {
      throw new AppError(CodigoError.VALIDACION, 'Falta indicar la venta a acreditar.', 400);
    }

    // 1. Cargar la venta completa (detalles, pago, factura)
    // caja/cliente en 0 a propósito: ObtenerQuery() (ventasRepository.ts) concatena estos
    // filtros como string crudo con "!= 0" como sentinela de "sin filtro" — si se omiten,
    // quedan en undefined y termina armando "AND v.idCaja = undefined" (columna inexistente).
    const { registros } = await VentasRepo.Obtener({ idVenta: input.idVenta, caja: 0, cliente: 0 });
    const venta = registros[0];

    if (!venta) {
      throw new AppError(CodigoError.NOT_FOUND, 'La venta indicada no existe.', 404);
    }
    if (!venta.factura?.cae) {
      throw new AppError(CodigoError.VALIDACION, 'La venta no tiene una factura con CAE. No se puede emitir una Nota de Crédito.', 400);
    }

    const esParcial = Array.isArray(input.lineas) && input.lineas.length > 0;
    let montoNC = 0;
    const detallesNC: NotaCreditoDetalleInput[] = [];

    // 2-3. Validar restricciones y calcular el monto — lecturas, sin transacción propia
    // (el riesgo de concurrencia sobre la misma venta queda documentado, ver handoff).
    const connectionLectura = await db.getConnection();
    try {
      if (esParcial) {
        // Restricción del plan: NC parcial solo si la venta no tiene descuento ni recargo
        // (evita prorratear el ajuste global por línea — ver Sub-fase C, deuda documentada).
        if ((venta.pago.descuento ?? 0) > 0 || (venta.pago.recargo ?? 0) > 0) {
          throw new AppError(
            CodigoError.VALIDACION,
            'La venta tiene descuento o recargo aplicado: solo se puede emitir una Nota de Crédito total.',
            400
          );
        }

        const acreditadoPorLinea = await NotasCreditoRepo.ObtenerAcreditadoPorLinea(connectionLectura, venta.id!);

        for (const linea of input.lineas!) {
          const detalle = venta.detalles.find(d => d.id === linea.idVentaDetalle);
          if (!detalle) {
            throw new AppError(CodigoError.VALIDACION, `La línea ${linea.idVentaDetalle} no pertenece a la venta ${venta.id}.`, 400);
          }
          if (!linea.cantidad || linea.cantidad <= 0) {
            throw new AppError(CodigoError.VALIDACION, `Cantidad inválida para la línea "${detalle.nomProd}".`, 400);
          }

          const yaAcreditado = acreditadoPorLinea[detalle.id!] ?? 0;
          if (yaAcreditado + linea.cantidad > detalle.cantidad!) {
            throw new AppError(
              CodigoError.VALIDACION,
              `"${detalle.nomProd}" ya tiene ${yaAcreditado} de ${detalle.cantidad} unidades acreditadas: no se puede acreditar ${linea.cantidad} más.`,
              400
            );
          }

          detallesNC.push({
            idVentaDetalle: detalle.id!,
            idProducto:     detalle.producto!.id!,
            nomProd:        detalle.nomProd!,
            cantidad:       linea.cantidad,
            precio:         detalle.precio!, // precio congelado de la venta, no el que mande el front
          });

          montoNC += detalle.precio! * linea.cantidad;
        }

      } else {
        // NC total: lo que falta por acreditar de la venta (ya incluye descuento/recargo aplicado)
        const acreditadoPrevio = await NotasCreditoRepo.ObtenerAcreditadoVenta(connectionLectura, venta.id!);
        montoNC = venta.total! - acreditadoPrevio;

        if (montoNC <= 0) {
          throw new AppError(CodigoError.VALIDACION, 'La venta ya fue acreditada en su totalidad.', 400);
        }
      }
    } finally {
      connectionLectura.release();
    }

    montoNC = Math.round(montoNC * 100) / 100;

    // 4. Armar comprobante asociado (la factura original) y emitir en AFIP
    const tipoNC = mapearTipoNC(venta.factura.tipoComprobante!);

    const objFacturar: ObjFacturar = {
      total:         montoNC,
      tipoComprobante: tipoNC,
      docNro:        venta.factura.dni,
      docTipo:       venta.factura.tipoDni,
      condReceptor:  venta.factura.condReceptor,
      comprobanteAsociado: {
        tipo:      venta.factura.tipoComprobante!,
        puntoVenta: venta.factura.ptoVenta!,
        numero:    venta.factura.ticket!,
      },
    };

    const resultadoAfip = await FacturacionServ.Facturar(objFacturar);
    const caeVtoDate: Date = resultadoAfip.caeVto.toDate();
    const fechaNC = new Date();

    // 5. Persistir NC + detalle + haber en el ledger, en una transacción DB.
    // A partir de aca ya tenemos un CAE valido emitido en ARCA — si algo de esto falla,
    // queda una NC fantasma en ARCA sin registro local (ver catch).
    // Declarado fuera del try porque la fase 6 (armado del payload de impresión, fuera
    // de esta transacción) también lo necesita para loguear contexto en caso de error.
    let idNotaCredito!: number;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const ncInput: NotaCreditoInput = {
        idVenta:  venta.id!,
        tipo:     tipoNC,
        cae:      resultadoAfip.cae,
        caeVto:   caeVtoDate,
        ticket:   resultadoAfip.ticket,
        ptoVenta: resultadoAfip.ptoVenta,
        neto:     resultadoAfip.neto,
        iva:      resultadoAfip.iva,
        total:    montoNC,
        esParcial,
        fecha:    fechaNC,
        motivo:   input.motivo ?? null,
      };

      idNotaCredito = await NotasCreditoRepo.InsertarNotaCredito(connection, ncInput);

      if (esParcial) {
        for (const detalle of detallesNC) {
          await NotasCreditoRepo.InsertarDetalle(connection, idNotaCredito, detalle);
        }
      }

      // Ledger: solo si la venta tiene un cliente real cargado — una venta de mostrador
      // sin cliente (consumidor final ocasional) no tiene cuenta corriente que ajustar.
      if (venta.cliente?.id) {
        await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
          idCliente:   venta.cliente.id,
          tipo:        'nota_credito',
          descripcion: `Nota de Crédito ${esParcial ? 'parcial' : 'total'} — Venta ${venta.id}`,
          haber:       montoNC,
          idReferencia: idNotaCredito,
        });
      }

      // NC total: cerrar la venta. La NC es la anulación fiscal post-cierre.
      // Con fechaBaja seteada los botones de acción desaparecen y el badge muestra "NC Total".
      if (!esParcial) {
        await connection.query('UPDATE ventas SET fechaBaja = NOW() WHERE id = ?', [venta.id]);
      }

      await connection.commit();

    } catch (error) {
      await connection.rollback();

      // Riesgo documentado en el plan: AFIP no es transaccional con la DB. Llegar acá
      // significa que ARCA YA aprobó la NC (tenemos CAE) pero no pudimos registrarla
      // localmente. Se loguea todo lo necesario para conciliación manual — no hay
      // automatización de reintento en esta fase (ver plan, Sub-fase C, Riesgos).
      loggerFacturacion.error(
        `NC emitida en AFIP pero NO persistida en DB. idVenta=${venta.id} cae=${resultadoAfip.cae} ` +
        `caeVto=${caeVtoDate.toISOString()} ticket=${resultadoAfip.ticket} ptoVenta=${resultadoAfip.ptoVenta} ` +
        `tipo=${tipoNC} total=${montoNC}. Error original: ${(error as any)?.message}`
      );

      throw new AppError(
        CodigoError.INTERNAL_ERROR,
        `La Nota de Crédito fue aprobada por ARCA (CAE ${resultadoAfip.cae}) pero no se pudo registrar en el sistema. Contactar soporte indicando este CAE.`,
        500,
        { modulo: 'NotaCreditoService', metodo: 'EmitirNotaCredito', idVenta: venta.id, cae: resultadoAfip.cae },
        error
      );
    } finally {
      connection.release();
    }

    // 6. Armar el payload de impresión — delegado a ObtenerImpresion() (read-path puro
    // sobre lo ya persistido). Así, reimprimir esta misma NC más adelante (historial,
    // reclamo, reenvío al cliente) usa exactamente la misma lógica, sin volver a pasar
    // por AFIP. El costo es una lectura extra a la DB que ya tenemos en memoria —
    // aceptado a cambio de una única fuente de verdad para el comprobante.
    return this.ObtenerImpresion(idNotaCredito);
  }

  // Resumen de NCs emitidas para una caja — alimenta la pestaña "Notas de Crédito"
  // del resumen de caja (cantidad + total, informativo).
  async ObtenerResumenPorCaja(idCaja: number): Promise<{ cantidad: number; total: number }> {
    return NotasCreditoRepo.ObtenerResumenPorCaja(idCaja);
  }

  // Lista de NCs de una venta — alimenta el submenú Ver/Imprimir Comprobante del frontend
  // (NC 1, NC 2, ...) para ver/reimprimir comprobantes ya emitidos.
  async ObtenerPorVenta(idVenta: number): Promise<NotaCreditoRow[]> {
    const connection = await db.getConnection();
    try {
      return await NotasCreditoRepo.ObtenerPorVenta(connection, idVenta);
    } finally {
      connection.release();
    }
  }

  async ObtenerImpresion(idNotaCredito: number): Promise<NotaCreditoImpresion> {
    const connectionLectura = await db.getConnection();
    let nc!: NotaCreditoRow;
    let detallesNC: NotaCreditoDetalleInput[] = [];
    try {
      const ncRow = await NotasCreditoRepo.ObtenerPorId(connectionLectura, idNotaCredito);
      if (!ncRow) {
        throw new AppError(CodigoError.NOT_FOUND, 'La Nota de Crédito indicada no existe.', 404);
      }
      nc = ncRow;
      if (nc.esParcial) {
        detallesNC = await NotasCreditoRepo.ObtenerDetallePorNota(connectionLectura, idNotaCredito);
      }
    } finally {
      connectionLectura.release();
    }

    // Receptor + comprobante asociado se heredan de la venta/factura original.
    // caja/cliente en 0 por el mismo motivo que en EmitirNotaCredito() (ver comentario ahí).
    const { registros } = await VentasRepo.Obtener({ idVenta: nc.idVenta, caja: 0, cliente: 0 });
    const venta = registros[0];
    if (!venta?.factura) {
      throw new AppError(CodigoError.NOT_FOUND, 'No se encontró la venta/factura asociada a la Nota de Crédito.', 404);
    }

    try {
      const objQR = new ObjQR({
        ver:        1,
        fecha:      moment(nc.fecha).format('YYYY-MM-DD'),
        ptoVta:     nc.ptoVenta,
        tipoCmp:    nc.tipo,
        nroCmp:     nc.ticket,
        importe:    nc.total,
        moneda:     'PES',
        ctz:        1,
        tipoDocRec: venta.factura.tipoDni,
        nroDocRec:  venta.factura.dni,
        tipoCodAut: 'E',
        codAut:     nc.cae,
      });
      const qr = await FacturacionServ.GenerarQR(objQR);

      const impresion: NotaCreditoImpresion = {
        tipo:     nc.tipo,
        ticket:   nc.ticket,
        ptoVenta: nc.ptoVenta,
        cae:      nc.cae,
        caeVto:   nc.caeVto,
        neto:     nc.neto,
        iva:      nc.iva,
        total:    nc.total,
        fecha:    nc.fecha,
        motivo:   nc.motivo,
        detalles: detallesNC.map(d => ({ nomProd: d.nomProd, cantidad: d.cantidad, precio: d.precio })),

        dni:          venta.factura.dni,
        tipoDni:      venta.factura.tipoDni,
        condReceptor: venta.factura.condReceptor,
        clienteReceptor: venta.cliente?.razonSocial || venta.cliente?.nombre || 'Consumidor Final',

        comprobanteAsociado: {
          tipo:     venta.factura.tipoComprobante!,
          ptoVenta: venta.factura.ptoVenta!,
          ticket:   venta.factura.ticket!,
        },

        qr,
      };

      return impresion;

    } catch (error) {
      // La NC YA está registrada (idNotaCredito) — solo falló armar el QR/payload.
      throw new AppError(
        CodigoError.QR_ERROR,
        `La Nota de Crédito (CAE ${nc.cae}) está registrada correctamente, pero no se pudo generar el comprobante para imprimir. Podés reintentarlo más tarde.`,
        500,
        { modulo: 'NotaCreditoService', metodo: 'ObtenerImpresion', idNotaCredito },
        error
      );
    }
  }
}

export const NotaCreditoServ = new NotaCreditoService();
