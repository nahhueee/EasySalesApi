import loggerFacturacion from "../logger/loggerFacturacion";
import {ParametrosRepo} from '../data/parametrosRepository';
import { Afip } from "afip.ts";
import { AdminServ } from "./adminService";
import fs from "fs";
import path from "path";
import { ObjFacturar } from "../models/objFacturar";
import config from '../conf/app.config';
import { VentasRepo } from '../data/ventasRepository';
import moment from "moment";
import { SesionServ } from "./sesionService";
import { HabilitacionServ } from "./habilitacionService";
import { AppError } from "../logger/AppError";
import { CodigoError } from "../logger/CodigosError";

const afipInstances: Record<string, any> = {};
const QRCode = require('qrcode');

class FacturacionService{
    async Facturar(objFactura:ObjFacturar){

        const datosFacturacion = await ParametrosRepo.ObtenerParametrosFacturacion();
        const afip = await ObtenerInstanciaAfip(datosFacturacion.cuil);
        
        //Verificamos el estado del servidor ARCA
        const serverStatus = await afip.electronicBillingService.getServerStatus();
        if (
        !serverStatus ||
        serverStatus.FEDummyResult.AppServer !== 'OK' ||
        serverStatus.FEDummyResult.DbServer !== 'OK' ||
        serverStatus.FEDummyResult.AuthServer !== 'OK'
        ) {
            throw new AppError(
                CodigoError.AFIP_NO_DISPONIBLE,
                'Servicio de ARCA no disponible.',
                503
            );
        }

        //Tipos de comprobante
        // 1 → Factura A
        // 6 → Factura B
        // 11 → Factura C

        // Tipos de IVA
        // 3 → 0%
        // 4 → 10,5%
        // 5 → 21%
        // 6 → 27%
        
        const date = new Date(Date.now() - ((new Date()).getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        // Factura A discrimina IVA
        // Factura B no discrimina IVA pero es necesario pasar el IVA incluido en ImpIVA
        // Factura C no necesita de IVA en ningun sentido, neto será igual al total
        let neto = 0;
        let iva = 0;

        if(objFactura.tipoFactura === 1 || objFactura.tipoFactura === 6){
            neto = Math.round((objFactura.total! / 1.21) * 100) / 100;
            iva = Math.round((objFactura.total! - neto) * 100) / 100;
        }else{
            neto = objFactura.total!;
        }

        let data : any = {
            CantReg: 1, // Cantidad de comprobantes a registrar
            PtoVta: datosFacturacion.puntoVta, // Punto de venta
            CbteTipo: objFactura.tipoFactura, // Tipo de comprobante (ver tipos disponibles)
            Concepto: 1, // Concepto del Comprobante: (1)Productos, (2)Servicios, (3)Productos y Servicios
            DocTipo: objFactura.docTipo, // Tipo de documento del comprador (99 consumidor final, ver tipos disponibles)
            DocNro: objFactura.docNro, // Número de documento del comprador (0 consumidor final)
            CbteDesde: 1, // Número de comprobante o numero del primer comprobante en caso de ser mas de uno
            CbteHasta: 1, // Número de comprobante o numero del último comprobante en caso de ser mas de uno
            CbteFch: date.replace(/-/g, ""), // (Opcional) Fecha del comprobante (yyyymmdd) o fecha actual si es nulo
            ImpTotal: objFactura.total, // Importe total del comprobante
            ImpTotConc: 0, // Importe neto no gravado
            ImpNeto: neto, // Importe neto gravado
            ImpOpEx: 0, // Importe exento de IVA
            ImpIVA: iva, //Importe total de IVA
            CondicionIVAReceptorId: objFactura.condReceptor, //Condicion frente al iva del receptor
            ImpTrib: 0, //Importe total de tributos
            MonId: "PES", //Tipo de moneda usada en el comprobante (ver tipos disponibles)('PES' para pesos argentinos)
            MonCotiz: 1, // Cotización de la moneda usada (1 para pesos argentinos)
        };

        // Solo agregamos el campo `Iva` si es una Factura A o B
        if (objFactura.tipoFactura === 1 || objFactura.tipoFactura === 6) {
            data.Iva = [
            {
                Id: 5, // 21%
                BaseImp: neto,
                Importe: iva
            }
            ];
        }

        let res;
        try {
            res = await afip.electronicBillingService.createNextVoucher(data);
        } catch (err: any) {
            if (err?.code === 'ECONNRESET' || err?.message?.includes('socket')) {
                throw new AppError(
                    CodigoError.AFIP_TIMEOUT, 'ARCA no respondió (timeout)', 504,
                    { modulo: 'FacturacionService', metodo: 'createNextVoucher' },
                    err
                );
            }else{
                throw new AppError(
                    CodigoError.AFIP_ERROR, 'Ocurrió un error al intentar generar el comprobante', 500,
                    { modulo: 'FacturacionService', metodo: 'createNextVoucher' },
                    err
                );
            }
        }

        //Detalle de la respuesta
        const detalle = res.response?.FeDetResp?.FECAEDetResponse?.[0];

        //COMPROBANTE APROBADO
        if (detalle?.Resultado === 'A') {
            const lastVoucher = await afip.electronicBillingService.getLastVoucher(
                datosFacturacion.puntoVta,
                objFactura.tipoFactura!
            );

            await SesionServ.RegistrarMovimiento(
                `Nueva Factura tipo ${objFactura.tipoFactura} nro ${lastVoucher.CbteNro}`
            );

            return {
                estado: 'Aprobado',
                cae: detalle.CAE,
                caeVto: moment(detalle.CAEFchVto, 'YYYYMMDD'),
                ticket: lastVoucher.CbteNro,
                ptoVenta: datosFacturacion.puntoVta,
                neto,
                iva
            };
        }

        //COMPROBANTE RECHAZADO
        const observacionesAfip = detalle?.Observaciones?.Obs ?? [];
        const erroresAfip = res.response?.Errors?.Err ?? [];

        const mensajes = [
        ...observacionesAfip.map(o => `OBS ${o.Code}: ${o.Msg}`),
        ...erroresAfip.map(e => `ERR ${e.Code}: ${e.Msg}`)
        ];

        if (mensajes.length === 0) {
            mensajes.push('ARCA rechazó el comprobante sin detalles');
        };

        //logeamos mensajes por separado
        mensajes.forEach(m => loggerFacturacion.error(m));

        //Devolvemos y logeamos error tecnico
        throw new AppError(
            CodigoError.AFIP_RECHAZO, 'El comprobante fue rechazado por ARCA', 422,
            {
                modulo: 'FacturacionService',
                metodo: 'createNextVoucher',
                detallesAfip: mensajes,
                resultadoAfip: detalle?.Resultado
            }
        );
    }

    async ObtenerQRFactura(idVenta){
        try {

            let datosQR = await VentasRepo.ObtenerQRFactura(idVenta);
            const datosFacturacion = await ParametrosRepo.ObtenerParametrosFacturacion();

            if(datosQR){
                datosQR.cuit = datosFacturacion.cuil;

                const jsonBase64 = Buffer.from(JSON.stringify(datosQR)).toString('base64');
                const url = `https://www.arca.gob.ar/fe/qr/?p=${jsonBase64}`;

                return await QRCode.toDataURL(url);
            }
          
            return null;

        } catch (error) {
            throw new AppError(
                CodigoError.QR_ERROR,
                'No se pudo generar el QR de la factura.', 500,
                { modulo: 'FacturacionService', metodo: 'ObtenerQRFactura' }
            );
        }
    }
}

async function ObtenerInstanciaAfip(cuilTitular): Promise<Afip> {
    const dniCliente = await ParametrosRepo.ObtenerParametros('dni');
    if (!dniCliente) {
        throw new AppError(
            CodigoError.DNI_NO_ENCONTRADO,
            'No se encontró DNI del cliente', 400,
            { modulo: 'FacturacionService', metodo: 'ObtenerInstanciaAfip' }
        );
    }

    //Verificar habilitacion
    await VerificarHabilitacion(dniCliente);

    // Reutilizar instancia ARCA
    if (afipInstances[cuilTitular]) {
        return afipInstances[cuilTitular];
    }

    //#region Certificados y Token TA
    const certPath = path.resolve(__dirname, '../certs/cert');
    const keyPath  = path.resolve(__dirname, '../certs/key');

    if (!fs.existsSync(certPath)) throw new AppError(CodigoError.CERTIFICADOS, 'No se encontró archivo cert',400);
    if (!fs.existsSync(keyPath)) throw new AppError(CodigoError.CERTIFICADOS, 'No se encontró archivo key',400);

    const cert = fs.readFileSync(certPath, 'utf8').trim();
    const key  = fs.readFileSync(keyPath, 'utf8').trim();

    const ticketPath = path.resolve(__dirname, `../tokens/TA-${cuilTitular}.json`);
    fs.mkdirSync(path.dirname(ticketPath), { recursive: true });
    //#endregion

    const afip = new Afip({
        key,
        cert,
        cuit: cuilTitular,
        production: config.produccion,
        ticketPath
    });

    afipInstances[cuilTitular] = afip;
    return afip;
}

async function VerificarHabilitacion(dni: string): Promise<void> {
  const token = await HabilitacionServ.Obtener(dni);

  if (token && token.expiracion > new Date()) {
    return; // cache válido 
  }

  //Obtener Habilitacion en la web
  const habilitado = await AdminServ.ObtenerHabilitacion(dni);
  if (!habilitado) {
    throw new AppError(
        CodigoError.AUTH_NO_HABILITADO, 
        'Cliente inexistente o inhabilitado para generar facturas', 401,
        { modulo: 'FacturacionService', metodo: 'ObtenerInstanciaAfip' }
    );
  }

  await HabilitacionServ.Guardar({
    dni,
    habilitado: true,
    expiracion: new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hs
  });
}

export const FacturacionServ = new FacturacionService();


