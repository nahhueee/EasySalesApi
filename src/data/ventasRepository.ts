import db from '../db';
import { Venta } from '../models/Venta';
import { Cliente } from '../models/Cliente';
import { pagoVenta } from '../models/PagoVenta';
import { DetalleVenta } from '../models/DetalleVenta';
import { Producto } from '../models/Producto';
import { FacturaVenta } from '../models/FacturaVenta';
import { ObjQR } from '../models/ObjQR';
import { ObjTicketFactura } from '../models/ObjTicketFactura';
import { ParametrosRepo } from './parametrosRepository';
const moment = require('moment');

class VentasRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();

        try {
             //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQuery(filtros,false);
            let queryTotal = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            const ventas:Venta[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let venta:Venta = new Venta();
                    venta.id = row['id'];
                    venta.idCaja = row['idCaja'];
                    venta.fecha = row['fecha'];
                    venta.hora = row['hora'];
                    
                    //Obtiene la lista de detalles de la venta
                    venta.detalles = await ObtenerDetalleVenta(connection, row['id']); 

                    //Obtenemos la suma total de las ventas
                    venta.total = venta.detalles.reduce((accum, detalle) => {
                        return accum + detalle.total!;
                    }, 0);

                    venta.cliente = new Cliente({id: row['idCliente'], nombre: row['cliente']});
                    venta.pago = new pagoVenta({
                        efectivo: parseFloat(row['efectivo']), 
                        digital: parseFloat(row['digital']), 
                        recargo: parseFloat(row['recargo']), 
                        descuento: parseFloat(row['descuento']), 
                        entrega: parseFloat(row['entrega']), //Dinero entregado a la venta
                        tipoPago: row['tipoPago'],
                        realizado: row['realizado'],
                    });

                    venta.factura = new FacturaVenta({
                        cae: row['cae'], 
                        caeVto: row['caeVto'], 
                        ticket: row['ticket'], 
                        tipoFactura: row['tipoFactura'], 
                        neto: parseFloat(row['neto']), 
                        iva: parseFloat(row['iva']), 
                        dni: row['dni'],
                        tipoDni: row['tipoDni'],
                        ptoVenta: row['ptoVenta'],
                        condReceptor: row['condReceptor'],
                    });


                    //Aplicamos descuentos
                    if(venta.pago.descuento > 0)
                        venta.total = venta.total - (venta.total * (venta.pago.descuento / 100));

                    //Aplicamos recargos
                    if(venta.pago.recargo > 0)
                        venta.total = venta.total + (venta.total * (venta.pago.recargo / 100));

                    venta.pago.restante = venta.total - venta.pago.entrega!, //Restante a pagar

                    ventas.push(venta);
                  }
            }

            return {total:resultado[0][0].total, registros:ventas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TiposPagoSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM tipos_pago');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesXTipoPago(idCaja){
        const connection = await db.getConnection();
        
        try {
            const consultaEfectivo = " SELECT COALESCE(SUM(efectivo), 0) AS efectivo FROM ventas_pago vpag " +
                                     " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                                     " WHERE v.idCaja = ? AND vpag.realizado = 1 ";

            const [resultEfectivo] = await connection.query(consultaEfectivo, [idCaja]);

            const consultaDigital =  " SELECT COALESCE(SUM(CASE WHEN vpag.idPago = 2 THEN digital ELSE 0 END), 0) AS tarjetas, " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 3 THEN digital ELSE 0 END), 0) AS transferencias, " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 4 THEN digital ELSE 0 END), 0) AS otros FROM ventas_pago vpag " +
                                     " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                                     " WHERE v.idCaja = ? ";

            const [resultDigital] = await connection.query(consultaDigital, [idCaja]);

            return {
                efectivo: parseFloat(resultEfectivo[0].efectivo),
                tarjetas: parseFloat(resultDigital[0].tarjetas),
                transferencias: parseFloat(resultDigital[0].transferencias),
                otros: parseFloat(resultDigital[0].otros)
            };


        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesPagasImpagas(idCaja){
        const connection = await db.getConnection();
        
        try {
            const consulta =  " SELECT  COUNT(CASE WHEN vpag.realizado = 1 THEN 1 END) AS pagas, " +
                              " COUNT(CASE WHEN vpag.realizado = 0 THEN 1 END) AS impagas FROM ventas_pago vpag " +
                              " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                              " WHERE v.idCaja = ? ";

            const [resultado] = await connection.query(consulta, [idCaja]);

            return {
                pagas: parseInt(resultado[0].pagas),
                impagas: parseInt(resultado[0].impagas)
            };


        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async Agregar(venta:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            //Obtenemos el proximo nro de venta a insertar
            venta.id = await ObtenerUltimaVenta(connection);

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la venta
            await InsertVenta(connection,venta);

            //insertamos los datos del pago de la venta
            venta.pago.idVenta = venta.id;
            await InsertPagoVenta(connection, venta.pago);

            //insertamos los datos de la factura de la venta
            if(venta.factura){
                venta.factura.idVenta = venta.id;
                await InsertFacturaVenta(connection, venta.factura);
            }
             
            //Insertamos los detalles de la venta
            for (const element of  venta.detalles) {
                element.idVenta = venta.id;
                InsertDetalleVenta(connection, element);
                ActualizarInventario(connection, element, "-")
            };

            //Actualizamos el total de ventas caja
            await connection.query("UPDATE cajas SET ventas = ventas + ? WHERE id = ?", [venta.total, venta.idCaja]);
            
            //Mandamos la transaccion
            await connection.commit();
            return venta.id;

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    async GuardarFactura(data:any){
        const connection = await db.getConnection();
        
        try {
            data.factura.idVenta = data.idVenta;
            await InsertFacturaVenta(connection, data.factura);
            return("OK");

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Eliminar(venta:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Eliminamos el pago relacionado
            await connection.query("DELETE FROM ventas_pago WHERE idVenta = ?", [venta.id]);

             //Eliminamos la factura relacionada
             await connection.query("DELETE FROM ventas_factura WHERE idVenta = ?", [venta.id]);

            //Eliminamos los detalles de la venta
            await connection.query("DELETE FROM ventas_detalle WHERE idVenta = ?", [venta.id]);

            //Borramos la venta
            await connection.query("DELETE FROM ventas WHERE id = ?", [venta.id]);

            //Actualizamos el total de ventas caja
            await connection.query("UPDATE cajas SET ventas = ventas - ? WHERE id = ?", [venta.total, venta.idCaja]);
            
            //EActualizamos el inventario
            venta.detalles.forEach(element => {
                ActualizarInventario(connection, element, "+")
            });

            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region OTROS
    async ObtenerQRFactura(idVenta:number){
        const connection = await db.getConnection();

        try {
            const consulta = " SELECT vf.cae, vf.ticket, vf.tipoFactura, vf.neto, vf.iva, vf.dni, vf.tipodni, vf.ptoVenta, v.fecha " +
                             " FROM ventas_factura vf " +
                             " INNER JOIN ventas v on v.id = vf.idVenta " +
                             " WHERE vf.idVenta = ? "

            const [resultado] = await connection.query(consulta, idVenta);
            const row = resultado[0];

            const objQR = new ObjQR({
                ver: 1,
                fecha : moment(row['fecha']).format('YYYY-MM-DD'),
                ptoVta : row['ptoVenta'],
                tipoCmp : row['tipoFactura'],
                nroCmp : row['ticket'],
                importe : parseFloat(row['neto']) + parseFloat(row['iva']), 
                moneda : "PES",
                ctz : 1,
                tipoDocRec : row['tipodni'],
                nroDocRec : row['dni'],
                tipoCodAut : "E",
                codAut : row['cae']
            })

            return objQR;
            
        } catch (error) {
            throw error;
        }finally{
            connection.release();
        }
    }
    //#endregion
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.caja != 0)
            filtro += " AND v.idCaja = " + filtros.caja;
        
        if (filtros.cliente != 0)
            filtro += " AND v.idCliente = " + filtros.cliente;
        
        
        if (filtros.estado == "Pagas")
            filtro += " AND vpag.realizado = 1";
        if (filtros.estado == "Impagas")
            filtro += " AND vpag.realizado = 0";
        // #endregion

        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if (filtros.tamanioPagina != null)
                paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
        }
            
        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
                " SELECT v.*, " + 
                " vpag.idPago, vpag.efectivo, vpag.digital, vpag.recargo, vpag.descuento, vpag.entrega, vpag.realizado, " + //Pago
                " vfac.cae, vfac.caeVto, vfac.ticket, vfac.tipoFactura, vfac.neto, vfac.iva, vfac.dni, vfac.tipoDni, vfac.ptoVenta, vfac.condReceptor, " + //Factura
                " COALESCE(cli.nombre, 'ELIMINADO') cliente, " +
                " COALESCE(tp.nombre, 'ELIMINADO') tipoPago " +
                " FROM ventas v " +
                " INNER JOIN ventas_pago vpag ON vpag.idVenta = v.id " +
                " LEFT JOIN ventas_factura vfac ON vfac.idVenta = v.id " +
                " LEFT JOIN tipos_pago tp ON tp.id = vpag.idPago " +
                " LEFT JOIN clientes cli ON cli.id = v.idCliente " +
                " WHERE 1 = 1 " +
                filtro +
                " ORDER BY v.id DESC" +
                paginado +
                endCount;
        
        return query;
            
    } catch (error) {
        throw error; 
    }
}

//#region INSERT
async function ObtenerUltimaVenta(connection):Promise<number>{
    try {
        const rows = await connection.query(" SELECT id FROM ventas ORDER BY id DESC LIMIT 1 ");
        let resultado:number = 0;

        if([rows][0][0].length==0){
            resultado = 1;
        }else{
            resultado = rows[0][0].id + 1;
        }

        return resultado;

    } catch (error) {
        throw error; 
    }
}

async function InsertVenta(connection, venta):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas(id, idCaja, idCliente, fecha, hora) " +
                         " VALUES(?, ?, ?, ?, ?) ";

        const parametros = [venta.id, venta.idCaja, venta.cliente.id, moment(venta.fecha).format('YYYY-MM-DD'), venta.hora];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertPagoVenta(connection, pago):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_pago(idVenta, idPago, efectivo, digital, recargo, descuento, entrega, realizado) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [pago.idVenta, pago.idTipoPago, pago.efectivo, pago.digital, pago.recargo, pago.descuento, pago.entrega, pago.realizado];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertFacturaVenta(connection, factura):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_factura(idVenta, cae, caeVto, ticket, tipoFactura, neto, iva, dni, tipoDni, ptoVenta, condReceptor) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [factura.idVenta, factura.cae, moment(factura.caeVto).format('YYYY-MM-DD'), factura.ticket, factura.tipoFactura, factura.neto, factura.iva, factura.dni, factura.tipoDni, factura.ptoVenta, factura.condReceptor];
        await connection.query(consulta, parametros);

    } catch (error) {
        throw error; 
    }
}
//#endregion

//#region DETALLE VENTA
async function ObtenerDetalleVenta(connection, idVenta:number){
    try {
        const consulta = " SELECT dv.*, p.precio precioProducto, COALESCE(p.nombre, 'ELIMINADO') producto, p.soloPrecio FROM ventas_detalle dv " +
                         " LEFT JOIN productos p on p.id = dv.idProducto " +
                         " WHERE dv.idVenta = ?" +
                         " ORDER BY dv.id DESC ";

        const [rows] = await connection.query(consulta, [idVenta]);

        const detalles:DetalleVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let detalle:DetalleVenta = new DetalleVenta();
                detalle.id = row['id'];
                detalle.cantidad = row['cantidad'];
                detalle.precio = parseFloat(row['precio']);
                detalle.costo = parseFloat(row['costo']);
                detalle.total = detalle.precio! * detalle.cantidad!;
                detalle.producto = new Producto({
                    id: row['idProducto'], 
                    nombre: row['producto'], 
                    soloPrecio: row['soloPrecio'] == 1 ? true : false, 
                    precio: parseFloat(row['precioProducto'])
                });


                detalles.push(detalle)
              }
        }

        return detalles;

    } catch (error) {
        throw error; 
    }
}

async function InsertDetalleVenta(connection, detalle):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_detalle(idVenta, idProducto, cantidad, costo, precio) " +
                         " VALUES(?, ?, ?, ?, ?) ";

        const parametros = [detalle.idVenta, detalle.producto.id, detalle.cantidad, detalle.costo, detalle.precio];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function ActualizarInventario(connection, detalle, operacion):Promise<void>{
    try {
        if(detalle.producto.id === 1 || detalle.producto.soloPrecio) return; //No actualizamos el producto vario o productos que no trabajan cantidad

        const consulta = `UPDATE productos SET cantidad = cantidad ${operacion} ? 
                          WHERE id = ?`;

        const parametros = [detalle.cantidad, detalle.producto.id];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}
//#endregion


export const VentasRepo = new VentasRepository();