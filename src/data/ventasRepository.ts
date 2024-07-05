import db from '../db';
import { Venta } from '../models/Venta';
import { Cliente } from '../models/Cliente';
import { pagoVenta } from '../models/PagoVenta';
import { DetalleVenta } from '../models/DetalleVenta';
import { Producto } from '../models/Producto';
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
                        entrega: parseFloat(row['entrega']), //Dinero entregado a la venta
                        restante: venta.total - parseFloat(row['entrega']), //Restante a pagar

                        tipoPago: row['tipoPago'],
                        realizado: row['realizado'],
                    });

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
            await InsertPagoVenta(connection, venta);

            //Insertamos los detalles de la venta
            venta.detalles.forEach(element => {
                element.idVenta = venta.id;
                InsertDetalleVenta(connection, element)
            });

            //Actualizamos el total de ventas caja
            await connection.query("UPDATE cajas SET ventas = ventas + ? WHERE id = ?", [venta.total, venta.idCaja]);
            
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

    async Eliminar(venta:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            //Eliminamos el pago relacionado
            await connection.query("DELETE FROM ventas_pago WHERE idVenta = ?", [venta.id]);

            //Eliminamos los detalles de la venta
            await connection.query("DELETE FROM ventas_detalle WHERE idVenta = ?", [venta.id]);

            //Borramos la venta
            await connection.query("DELETE FROM ventas_detalle WHERE idVenta = ?", [venta.id]);

            //Actualizamos el total de ventas caja
            await connection.query("UPDATE cajas SET ventas = ventas - ? WHERE id = ?", [venta.total, venta.idCaja]);
            
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
    async EntregaDinero(data:any): Promise<string>{
        
        //Obtenemos el listado de ventas del cliente en estado impagas
        let resultado = await this.Obtener({cliente: data.idCliente, estado: "Impagas", caja:0});
       
        const connection = await db.getConnection();
        
        try {
            resultado.registros.reverse();

            //Iniciamos una transaccion
            await connection.beginTransaction();

            let totalAPagar:number = 0;
            let residuo:number = data.monto;

            for (let i = 0; i < resultado.registros.length; i++) { 
                const row = resultado.registros[i];

                totalAPagar = row.total! - row.pago?.entrega!;
                residuo = data.monto - totalAPagar;

                if(residuo >= 0) //Todavia hay monto para otras ventas, significa que podemos cerrar esta, y continuar con otra
                {
                    const consulta = " UPDATE ventas_pago " +
                                     " SET realizado = 1, " +
                                     "     entrega = ? " +
                                     " WHERE idVenta = ? ";

                    connection.query(consulta, [row.total, row.id]);
                    
                    data.monto -= row.total!; //Descontamos el monto que se pagó en esta venta

                    if (residuo == 0) break;
                }
                else if (residuo < 0) //Ya no hay monto para otras ventas, asique procedemos a colocar el resto del monto como entrega de venta
                {
                    const consulta = " UPDATE ventas_pago " +
                                     " SET entrega = ? " +
                                     " WHERE idVenta = ? ";

                    connection.query(consulta, [(row.pago?.entrega + data.monto), row.id]);
                    break;
                }
            }

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

    async ActualizarEstadoPago(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            if (data.realizado==0) data.total = 0;  //Si resulta que esta revirtiendo, quitamos la entrega

            const consulta = " UPDATE ventas_pago " +
                             " SET realizado = ?, " +
                             " entrega = ? " +
                             " WHERE idVenta = ?";

            const parametros = [data.realizado, data.total, data.id];
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
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
                " SELECT v.*, vpag.*, " +
                " COALESCE(cli.nombre, 'ELIMINADO') cliente, " +
                " COALESCE(tp.nombre, 'ELIMINADO') tipoPago " +
                " FROM ventas v " +
                " INNER JOIN ventas_pago vpag ON vpag.idVenta = v.id " +
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

async function InsertPagoVenta(connection, venta):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_pago(idVenta, idPago, efectivo, digital, entrega, realizado) " +
                         " VALUES(?, ?, ?, ?, ?, ?) ";

        const parametros = [venta.id, venta.pago.idTipoPago, venta.pago.efectivo, venta.pago.digital, venta.pago.entrega, venta.pago.realizado];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}
//#endregion

//#region DETALLE VENTA
async function ObtenerDetalleVenta(connection, idVenta:number){
    try {
        const consulta = " SELECT dv.*, p.precio precioProducto, COALESCE(p.nombre, 'ELIMINADO') producto FROM ventas_detalle dv " +
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
                detalle.producto = new Producto({id:row['idProducto'], nombre:row['producto'], precio:parseFloat(row['precioProducto'])});


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
//#endregion


export const VentasRepo = new VentasRepository();