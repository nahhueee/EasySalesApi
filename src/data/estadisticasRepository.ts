import db from '../db';
import { DatoVentaCaja } from '../models/DatoVentasCaja';

class EstadisticasRepository{

   //Obtiene los datos de venta de la caja
    async ObtenerDatoVentasCaja(idCaja:string){
        const connection = await db.getConnection();
        
        try {
            const consulta = " SELECT SUM(((vd.precio - vd.costo) * vd.cantidad)) ganancias, COUNT(vd.id) cantVentas, SUM(vd.precio * vd.cantidad) totalVentas  " +
                             " FROM ventas_detalle vd " +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " WHERE v.idCaja = ? " +
                             " GROUP BY v.idCaja; ";

            const rows = await connection.query(consulta, [parseInt(idCaja)]);
            const row = rows[0][0];

            let datoVenta:DatoVentaCaja = new DatoVentaCaja();

            if(row!=undefined){
                datoVenta.ganancias = parseFloat(row['ganancias']);
                datoVenta.totalVentas = parseFloat(row['totalVentas']);    
                datoVenta.cantVentas = row['cantVentas'];
            }
            
            return datoVenta;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Obtiene los 5 productos más populares 
    async ObtenerGraficoProductos(idCaja:string){
        const connection = await db.getConnection();
        
        let condicion = "";
        if(idCaja != "0") condicion = " AND v.idCaja = ? "; //Si la caja es distinto de 0, filtramos por caja

        try {
            const consulta = " SELECT COUNT(vd.idProducto) EjeY, p.nombre EjeX " +
                             " FROM ventas_detalle vd" +
                             " INNER JOIN productos p ON p.id = vd.idProducto" +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " WHERE vd.idProducto <> 1 " +
                               condicion + 
                             " GROUP BY vd.idProducto" +
                             " LIMIT 5;";

            const [rows] = await connection.query(consulta, [parseInt(idCaja)]);
            return await TransformarDatos([rows][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Obtiene los las ganancias por caja
    async ObtenerGraficoGanancias(idCaja:string){
        const connection = await db.getConnection();
        
        let condicion = "";
        if(idCaja != "0") condicion = " WHERE c.id <= ? "; //Si la caja es distinto de 0, filtramos por caja

        try {
            const consulta = " SELECT SUM(((vd.precio - vd.costo) * vd.cantidad)) EjeY, c.id EjeX " +
                             " FROM ventas_detalle vd" +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " INNER JOIN cajas c ON v.idCaja = c.id " +
                               condicion + 
                             " GROUP BY c.id " +
                             " ORDER BY c.id ASC" +
                             " LIMIT 10;";

            const [rows] = await connection.query(consulta, [parseInt(idCaja)]);
            return await TransformarDatos([rows][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
}

async function TransformarDatos(inputArray:any){
    try {
        const ejeX: number[] = [];
        const ejeY: number[] = [];

        // Iteramos sobre cada elemento del array de entrada
        inputArray.forEach(item => {
            // Agregamos el primer elemento al array de ejeY
            ejeY.push(item.EjeY);
            // Agregamos el segundo elemento al array de ejeX
            ejeX.push(item.EjeX);
        });

        // Devolvemos un objeto con los dos arrays
        return { ejeY, ejeX };
    } catch (error) {
        throw error; 
    }
}

export const EstadisticasRepo = new EstadisticasRepository();

