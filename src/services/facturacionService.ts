import logger from "../log/loggerGeneral";
import loggerFacturacion from "../log/loggerFacturacion";
import {ParametrosRepo} from '../data/parametrosRepository';
import { Afip } from "afip.ts";
import { AdminServ } from "./adminService";
import fs from "fs";
import path from "path";
import { ObjFacturar } from "../models/objFacturar";
import config from '../conf/app.config';
import { VentasRepo } from '../data/ventasRepository';
import moment from "moment";
const QRCode = require('qrcode');

class FacturacionService{
    async Facturar(objFactura:ObjFacturar){

        try {
            const datosFacturacion = await ParametrosRepo.ObtenerParametrosFacturacion();
            const afip = await getAfipInstance(datosFacturacion.cuil);

           
            //Verificamos el estado del servidor
            const serverStatus = await afip.electronicBillingService.getServerStatus();
            if(serverStatus && serverStatus.FEDummyResult.AppServer == "OK" && serverStatus.FEDummyResult.DbServer == "OK" && serverStatus.FEDummyResult.AuthServer == "OK")
            {
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
                const res = await afip.electronicBillingService.createNextVoucher(data);

                //Detalle de la respuesta
                const detalle = res.response?.FeDetResp?.FECAEDetResponse[0];
                const errores = res.response?.Errors?.Err || [];

                //Resultado general
                const resultado = detalle?.Resultado;
                if (resultado === "A") {
                    const lastVoucher = await afip.electronicBillingService.getLastVoucher(datosFacturacion.puntoVta, objFactura.tipoFactura!); //Obtenemos el nro del ultimo comprobante creado

                    return {
                        estado: "Aprobado",
                        cae: detalle.CAE,
                        caeVto:  moment(detalle.CAEFchVto, "YYYYMMDD"),
                        ticket: lastVoucher.CbteNro,
                        ptoVenta: datosFacturacion.puntoVta,
                        neto,
                        iva
                    }; 
                } else {
                    const observaciones = detalle?.Observaciones || [];
                    let mensajes: string[] = [];

                    if(observaciones && observaciones.Obs){
                        mensajes = [
                            ...observaciones.Obs.map(o => `${o.Code}: ${o.Msg}`),
                        ];
    
                        //logeamos observaciones
                        if (observaciones.Obs && Array.isArray(observaciones.Obs)) {
                            observaciones.Obs.forEach((obs: any) => {
                              loggerFacturacion.error(`Observación ${obs.Code}: ${obs.Msg}`);
                            });
                        }
                    }else
                    {
                        //logeamos errores
                        errores.forEach(err => {
                            loggerFacturacion.error(`Error ${err.Code}: ${err.Msg}`);
                        });                    
                    }
                    
                    return { estado: "Rechazado"};
                }

            }else{
                logger.error('Ocurrió un error al intentar conectar con los servicios de arca.');
            }
        } catch (error) {
            throw error;
        }
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
            throw error;
        }
    }
}


async function getAfipInstance(cuilTitular): Promise<Afip> {
    const dniCliente = await ParametrosRepo.ObtenerParametros('dni');

    //verificamos que el usuario este habilitado para facturar
    const habilitado = await AdminServ.ObtenerHabilitacion(dniCliente);
    if (!habilitado) throw new Error(`Cliente inexistente o inhabilitado para generar facturas.`);

    //Verificamos el cuit del titular
    if(!cuilTitular || cuilTitular=="") throw new Error(`No se encontró en la base de datos CUIL válido.`);

    //Verificamos que existan los archivos de clave y certificado
    const cert = fs.readFileSync(path.resolve(__dirname, '../certs/', "cert"), "utf8");
    const key = fs.readFileSync(path.resolve(__dirname, '../certs/', "key"), "utf8");
    
    if(key.trim().length === 0) throw new Error(`No se encontró archivo key.`);
    if(cert.trim().length === 0) throw new Error(`No se encontró archivo cert.`);

    const afip = new Afip({
        key: key,
        cert: cert,
        cuit: cuilTitular,
        production: config.produccion
    });

    return afip;
}

export const FacturacionServ = new FacturacionService();


