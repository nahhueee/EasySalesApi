import logger from "../log/loggerGeneral";

const Afip = require('@afipsdk/afip.js');

//Conectar con un certificado y CUIL propio
// const fs = require('fs');

// // Certificado (Puede estar guardado en archivos, DB, etc)
// const cert = fs.readFileSync('./certificado.crt', {encoding: 'utf8'});

// // Key (Puede estar guardado en archivos, DB, etc)
// const key = fs.readFileSync('./key.key', {encoding: 'utf8'});

// // Tu CUIT
// const taxId = 20111111112;

// const afip = new Afip({ 
//     CUIT: taxId,
//     cert: cert
//     key: key
// });

//Conectar afip modo desarrollo - provisorio
const afip = new Afip({ CUIT: 20409378472 });

class FacturacionService{

    async EstadoServidor(){
        const serverStatus = await afip.ElectronicBilling.getServerStatus();
        return serverStatus;
    }

    async Facturar(){

        //Verificamos el estado del servidor
        const serverStatus = await afip.ElectronicBilling.getServerStatus();
        if(serverStatus && serverStatus.AppServer == "OK" && serverStatus.DbServer == "OK" && serverStatus.AuthServer == "OK")
        {
            
            const date = new Date(Date.now() - ((new Date()).getTimezoneOffset() * 60000)).toISOString().split('T')[0];

            // Info del comprobante
            let data = {
                'CantReg' 	    : 1,  // Cantidad de comprobantes a registrar
                'PtoVta' 	    : 1,  // Punto de venta
                'CbteTipo' 	    : 6,  // Tipo de comprobante (ver tipos disponibles) 
                'Concepto' 	    : 1,  // Concepto del Comprobante: (1)Productos, (2)Servicios, (3)Productos y Servicios
                'DocTipo' 	    : 99, // Tipo de documento del comprador (99 consumidor final, ver tipos disponibles)
                'DocNro' 	    : 0,  // Número de documento del comprador (0 consumidor final)
                'CbteDesde' 	: 1,  // Número de comprobante o numero del primer comprobante en caso de ser mas de uno
                'CbteHasta' 	: 1,  // Número de comprobante o numero del último comprobante en caso de ser mas de uno
                'CbteFch' 	    : parseInt(date.replace(/-/g, '')), // (Opcional) Fecha del comprobante (yyyymmdd) o fecha actual si es nulo
                'ImpTotal' 	    : 121, // Importe total del comprobante
                'ImpTotConc' 	: 0,   // Importe neto no gravado
                'ImpNeto' 	    : 100, // Importe neto gravado
                'ImpOpEx' 	    : 0,   // Importe exento de IVA
                'ImpIVA' 	    : 21,  //Importe total de IVA
                'ImpTrib' 	    : 0,   //Importe total de tributos
                'MonId' 	    : 'PES', //Tipo de moneda usada en el comprobante (ver tipos disponibles)('PES' para pesos argentinos) 
                'MonCotiz' 	    : 1,     // Cotización de la moneda usada (1 para pesos argentinos)  
                'Iva' 		: [ // (Opcional) Alícuotas asociadas al comprobante
                    {
                        'Id' 		: 5, // Id del tipo de IVA (5 para 21%)(ver tipos disponibles) 
                        'BaseImp' 	: 100, // Base imponible
                        'Importe' 	: 21 // Importe 
                    }
                ]
            };

            const res = await afip.ElectronicBilling.createNextVoucher(data, true);
            console.log(res)

            return {cae:res['CAE'], caeVto:res['CAEFchVto']};
            
        }else{
            logger.error('Ocurrió un error al intentar conectar con los servicios de arca.');
        }
    }
}

async function ObtenerUltimoComprobante() {
    // Numero de punto de venta //Obtener de la tabla facturacion
    const puntoDeVenta = 1;

    // Tipo de comprobante //Obtener de la tabla facturacion
    const tipoDeComprobante = 6; // 6 = Factura B

    const lastVoucher = await afip.ElectronicBilling.getLastVoucher(puntoDeVenta, tipoDeComprobante);
}

export const FacturacionServ = new FacturacionService();


