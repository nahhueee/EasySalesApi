import { Afip } from "afip.ts";
import fs from "fs";
import path from "path";
import config from '../conf/app.config';
import { AppError } from "../logger/AppError";
import { CodigoError } from "../logger/CodigosError";

// Factory de instancias Afip, compartida entre FacturacionService (WSFE) y
// PadronService (consulta de contribuyentes). Extraído de facturacionService.ts:
// misma lógica exacta (certificados, token TA, selección de ambiente), sin cambios
// de comportamiento, para no duplicarla al agregar un segundo consumidor.
const afipInstances: Record<string, any> = {};

export async function ObtenerInstanciaAfip(cuilTitular): Promise<Afip> {
    // Reutilizar instancia
    if (afipInstances[cuilTitular]) {
        return afipInstances[cuilTitular];
    }

    //#region Definir carpeta de certificados según entorno
    const certFolder = config.produccion
        ? path.resolve(__dirname, `../certs`)
        : path.resolve(__dirname, `../certs/test`);

    if (!fs.existsSync(certFolder)) {
        throw new AppError(
            CodigoError.CERTIFICADOS,
            `No existe la carpeta de certificados: ${certFolder}`,
            400
        );
    }
    //#endregion

   //#region Certificados y Token TA
    const certPath = path.join(certFolder, 'cert');
    const keyPath  = path.join(certFolder, 'key');

    if (!fs.existsSync(certPath)) {
        throw new AppError(CodigoError.CERTIFICADOS, `No se encontró archivo cert en ${certFolder}`, 400);
    }

    if (!fs.existsSync(keyPath)) {
        throw new AppError(CodigoError.CERTIFICADOS, `No se encontró archivo key en ${certFolder}`, 400);
    }

    const cert = fs.readFileSync(certPath, 'utf8').trim();
    const key  = fs.readFileSync(keyPath, 'utf8').trim();

    const isProd = config.produccion;
    const cuilCertificado = isProd ? cuilTitular : config.cuilTest;

    // La lib afip.js usa ticketPath como directorio base, no como archivo
    // Estructura resultante: tokens/test/ o tokens/{cuit}/
    const ticketPath = isProd
        ? path.resolve(__dirname, `../tokens/${cuilTitular}`)
        : path.resolve(__dirname, `../tokens/test`);

    fs.mkdirSync(ticketPath, { recursive: true });

    const afip = new Afip({
        key,
        cert,
        cuit: cuilCertificado,
        production: isProd,
        ticketPath
    });
    //#endregion

    afipInstances[cuilTitular] = afip;
    return afip;
}
