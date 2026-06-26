import { ParametrosRepo } from '../data/parametrosRepository';
import { ObtenerInstanciaAfip } from './afipClienteFactory';
import { MapearSugerenciaPadron, SugerenciaPadron } from '../utils/padronAfipMapper';
import { EsCuitCuilValido } from '../utils/datosFiscales';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { SesionServ } from './sesionService';

class PadronService {

    /**
     * Consulta el padrón de ARCA (ws_sr_constancia_inscripcion) por CUIT/CUIL y devuelve
     * una sugerencia editable de razonSocial/condicionIva para precargar el alta de cliente.
     * Nunca debe usarse como dato autoritativo: ValidarConsistenciaFiscal sigue siendo
     * el guardrail final al guardar el cliente.
     */
    async ConsultarContribuyente(cuit: string): Promise<SugerenciaPadron> {
        if (!EsCuitCuilValido(cuit)) {
            throw new AppError(CodigoError.VALIDACION, 'El CUIT/CUIL ingresado no es válido.', 400);
        }

        const datosFacturacion = await ParametrosRepo.ObtenerParametrosFacturacion();
        if (!datosFacturacion) {
            throw new AppError(CodigoError.CERTIFICADOS, 'No hay parámetros de facturación configurados.', 400);
        }

        const afip = await ObtenerInstanciaAfip(datosFacturacion.cuil);
        const MSG_NO_ENCONTRADO = 'No se encontró el CUIT/CUIL en el padrón de ARCA.';

        let personaReturn;
        try {
            personaReturn = await afip.registerInscriptionProofService.getTaxpayerDetails(Number(cuit));
        } catch (err: any) {
            if (err?.code === 'ECONNRESET' || err?.message?.includes('socket')) {
                throw new AppError(
                    CodigoError.AFIP_TIMEOUT, 'ARCA no respondió (timeout)', 504,
                    { modulo: 'PadronService', metodo: 'getTaxpayerDetails' },
                    err
                );
            }
            // ARCA señala "no encontrado" de dos formas distintas según el caso: a veces
            // getTaxpayerDetails devuelve null (manejado abajo), a veces el WS tira un
            // SOAP Fault explícito con este texto. Mismo resultado de negocio (404), no
            // un error de comunicación/infraestructura (500).
            if (err?.message?.includes('No existe persona')) {
                throw new AppError(CodigoError.NOT_FOUND, MSG_NO_ENCONTRADO, 404);
            }
            throw new AppError(
                CodigoError.AFIP_ERROR, 'Ocurrió un error al consultar el padrón de ARCA', 500,
                { modulo: 'PadronService', metodo: 'getTaxpayerDetails' },
                err
            );
        }

        if (!personaReturn || !personaReturn.datosGenerales) {
            throw new AppError(CodigoError.NOT_FOUND, MSG_NO_ENCONTRADO, 404);
        }

        await SesionServ.RegistrarMovimiento(`Consulta a padrón ARCA: CUIT ${cuit}`);

        return MapearSugerenciaPadron(personaReturn);
    }
}

export const PadronServ = new PadronService();
