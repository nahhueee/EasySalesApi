import moment from 'moment';
import db from '../db';
import { DatoVentaCaja } from '../models/DatoVentasCaja';
import { FiltroEstadistica } from '../models/estadisticas/FiltroEstadistica';
import { TotalAcumulado } from '../models/estadisticas/TotalAcumulado';

class EstadisticasRepository{

    async TotalesCantGenerales(filtros:FiltroEstadistica){
        const connection = await db.getConnection();
        
        try {
            const { fechaDesde, fechaHasta } = obtenerRangosFecha(filtros);

            //#region CONSULTAS
            const consulta1 = 
                              " SELECT SUM(t.total_venta) AS total_ventas, COUNT(*) AS cant_ventas FROM (" +
                              " SELECT SUM(dv.cantidad * dv.precio) AS total_venta from ventas v " +
                              " INNER JOIN ventas_detalle dv ON dv.idVenta = v.id " +
                              " INNER JOIN cajas c ON c.id = v.idCaja " +
                              " WHERE (v.fecha BETWEEN ? AND ?) AND c.fechaBaja IS NULL " +
                              " GROUP BY v.id " +
                              " ) AS t";
            
            const [consultaTotalesVentas] = await connection.query(consulta1, [fechaDesde, fechaHasta]);

            const consulta2 = 
                              " SELECT SUM(t.total_factura) AS total_facturas, COUNT(*) AS cant_facturas FROM (" +
                              " SELECT SUM(dv.cantidad * dv.precio) AS total_factura " +
                              " FROM ventas_factura vf " +
                              " INNER JOIN ventas v ON v.id = vf.idVenta " +
                              " INNER JOIN ventas_detalle dv ON dv.idVenta = v.id " +
                              " INNER JOIN cajas c ON c.id = v.idCaja " +
                              " WHERE (v.fecha BETWEEN ? AND ?) AND c.fechaBaja IS NULL " +
                              " GROUP BY v.id " +
                              " ) AS t";
            
            const [consultaTotalesFactura] = await connection.query(consulta2, [fechaDesde, fechaHasta]);
            //#endregion

            const resultados = {
                cantidad_ventas: consultaTotalesVentas[0].cant_ventas || 0,
                total_ventas: parseFloat(consultaTotalesVentas[0].total_ventas || 0),
                cantidad_facturas: consultaTotalesFactura[0].cant_facturas || 0,
                total_facturas: parseFloat(consultaTotalesFactura[0].total_facturas || 0),
            };

            return resultados;


        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesXTipoPago(filtros:FiltroEstadistica){
        const connection = await db.getConnection();
        
        try {
            const { fechaDesde, fechaHasta } = obtenerRangosFecha(filtros);

            //#region CONSULTAS
            const consultaTotales =  " SELECT  " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 1 THEN efectivo ELSE 0 END), 0) AS efectivo, " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 2 THEN digital ELSE 0 END), 0) AS tarjetas, " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 3 THEN digital ELSE 0 END), 0) AS transferencias, " +
                                     " COALESCE(SUM(CASE WHEN vpag.idPago = 4 THEN digital ELSE 0 END), 0) AS otros " +
                                     " FROM ventas_pago vpag " +
                                     " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                                     " INNER JOIN cajas c ON c.id = v.idCaja " +
                                     " WHERE (v.fecha BETWEEN ? AND ?) AND vpag.realizado = 1 AND c.fechaBaja IS NULL ";

            const [resultTotales] = await connection.query(consultaTotales, [fechaDesde, fechaHasta]);

            const consultaCantidad = " SELECT  " +
                                     " SUM(CASE WHEN vpag.idPago = 1 THEN 1 ELSE 0 END) AS cant_efectivo, " +
                                     " SUM(CASE WHEN vpag.idPago = 2 THEN 1 ELSE 0 END) AS cant_tarjetas, " +
                                     " SUM(CASE WHEN vpag.idPago = 3 THEN 1 ELSE 0 END) AS cant_transferencias, " +
                                     " SUM(CASE WHEN vpag.idPago = 4 THEN 1 ELSE 0 END) AS cant_otros " +
                                     " FROM ventas_pago vpag " +
                                     " INNER JOIN ventas v ON v.id = vpag.idVenta " +
                                     " INNER JOIN cajas c ON c.id = v.idCaja " +
                                     " WHERE (v.fecha BETWEEN ? AND ?)AND  vpag.realizado = 1 AND c.fechaBaja IS NULL ";

            const [resultCantidad] = await connection.query(consultaCantidad, [fechaDesde, fechaHasta]);
            //#endregion

            return {
                total_efectivo: parseFloat(resultTotales[0].efectivo),
                total_tarjetas: parseFloat(resultTotales[0].tarjetas),
                total_transferencias: parseFloat(resultTotales[0].transferencias),
                total_otros: parseFloat(resultTotales[0].otros),

                cantidad_efectivo:resultCantidad[0].cant_efectivo,
                cantidad_tarjetas:resultCantidad[0].cant_tarjetas,
                cantidad_transferencias:resultCantidad[0].cant_transferencias,
                cantidad_otros:resultCantidad[0].cant_otros,
            };

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesXCajas(filtros:FiltroEstadistica){
        const connection = await db.getConnection();
        
        try {
            const { fechaDesde, fechaHasta } = obtenerRangosFecha(filtros);

            const consulta =  " SELECT u.nombre AS responsable, t.idCaja,  SUM(t.total_venta) AS total_ventas, COUNT(*) AS cant_ventas  " +
                            " FROM ( " +
                            " SELECT v.idCaja, SUM(dv.cantidad * dv.precio) AS total_venta FROM ventas v " +
                            " INNER JOIN ventas_detalle dv ON dv.idVenta = v.id " +
                            " WHERE v.fecha BETWEEN ? AND ? " +
                            " GROUP BY v.id, v.idCaja " +
                            " ) AS t " +
                            " INNER JOIN cajas c ON c.id = t.idCaja " +
                            " INNER JOIN usuarios u ON u.id = c.idResponsable " +
                            " WHERE c.fechaBaja IS NULL " +
                            " GROUP BY t.idCaja, u.nombre " +
                            " ORDER BY total_ventas DESC " +
                            " LIMIT 5";

            const [rows] = await connection.query(consulta, [fechaDesde, fechaHasta]);
            
            return rows;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

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

    //Obtiene los totales de venta acumulado por producto 
    async ObtenerTotalesAcumulado(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let queryRegistros = await ObtenerAcumuladosQuery(filtros,false);
            let queryTotal = await ObtenerAcumuladosQuery(filtros,true);

            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            const registros:TotalAcumulado[] = [];

            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let elemento:TotalAcumulado = new TotalAcumulado({
                        nombre: row['nombre'],
                        total: parseFloat(row['total']),
                    });

                    registros.push(elemento);
                }
            }

            return {total:resultado[0][0].total, registros};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Obtiene los 5 productos más populares 
    async ObtenerGraficoProductos(filtros:FiltroEstadistica){
        const connection = await db.getConnection();
        const { fechaDesde, fechaHasta } = obtenerRangosFecha(filtros);

        try {
            const consulta = " SELECT SUM(vd.cantidad) EjeY, p.nombre EjeX " +
                             " FROM ventas_detalle vd" +
                             " INNER JOIN productos p ON p.id = vd.idProducto" +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " INNER JOIN cajas c ON c.id = v.idCaja " +
                             " WHERE vd.idProducto <> 1 AND p.soloPrecio = 0 " +
                             " AND v.fecha BETWEEN ? AND ? " +
                             " AND c.fechaBaja IS NULL " +
                             " GROUP BY vd.idProducto" +
                             " ORDER BY EjeY DESC " +
                             " LIMIT 5;";

            const [rows] = await connection.query(consulta, [fechaDesde, fechaHasta]);
            return await TransformarDatos([rows][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Obtiene las ganancias por caja
    async ObtenerGraficoGanancias(idCaja:string){
        const connection = await db.getConnection();
        
        let condicion = "";
        if(idCaja != "0") condicion = " WHERE c.id <= ? AND c.finalizada = 1 "; //Si la caja es distinto de 0, filtramos por caja

        try {
            const consulta = " SELECT SUM(((vd.precio - vd.costo) * vd.cantidad)) EjeY, c.id EjeX " +
                             " FROM ventas_detalle vd" +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " INNER JOIN cajas c ON v.idCaja = c.id " +
                               condicion + 
                             " GROUP BY c.id " +
                             " ORDER BY c.id DESC" +
                             " LIMIT 10;";

            const [rows] = await connection.query(consulta, [parseInt(idCaja)]);
            return await TransformarDatos([rows][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async GananciasComparativas(filtros:FiltroEstadistica){
        const connection = await db.getConnection();
        
        try {
            
            let { fechaDesde, fechaHasta } = obtenerRangosFecha(filtros);

            let groupBy = "DATE_FORMAT(v.fecha, '%d-%m-%y')";
            let orderBy = "MIN(v.fecha)";
            let limit = 7;

            if (filtros.rango === 'anio') {
                groupBy = "DATE_FORMAT(v.fecha, '%M-%y')"; 
                orderBy = "MIN(v.fecha)";
                limit = 12;
            } else if (filtros.rango === 'mes') {
                groupBy = "CONCAT('Semana ', WEEK(v.fecha, 1))";
                orderBy = "MIN(v.fecha)";
                limit = 5;
            } else if (filtros.rango === 'hoy') {
                fechaDesde = moment().subtract(5, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
                limit = 5;
            }

            const consulta = `
                SELECT 
                ${groupBy} AS EjeX,
                SUM((vd.precio - vd.costo) * vd.cantidad) AS EjeY
                FROM ventas_detalle vd
                INNER JOIN ventas v ON vd.idVenta = v.id
                INNER JOIN ventas_pago vp ON v.id = vp.idVenta
                INNER JOIN cajas c ON c.id = v.idCaja
                WHERE v.fecha BETWEEN ? AND ? 
                AND vp.realizado = 1
                AND c.fechaBaja IS NULL
                GROUP BY EjeX
                ORDER BY ${orderBy} ASC
                LIMIT ${limit};
            `;

            const [rows] = await connection.query(consulta, [fechaDesde, fechaHasta]);
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

async function ObtenerAcumuladosQuery(filtros:any,esTotal:boolean):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.nombre != null && filtros.nombre != "") 
            filtro += " AND p.nombre LIKE '%"+ filtros.nombre + "%' ";

        if(filtros.caja == 0){
            const { fechaDesde, fechaHasta } = obtenerRangosFecha(filtros);
            filtro += " AND (p.soloPrecio = 1 or p.codigo = '*') ";
            filtro += " AND (v.fecha BETWEEN '" + fechaDesde + "' AND '" + fechaHasta + "')";
        }else{
            filtro += " AND v.idCaja = " + filtros.caja;
        }
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
            " SELECT p.nombre, SUM(vd.precio * vd.cantidad) total FROM ventas_detalle vd " +
            " INNER JOIN productos p ON p.id = vd.idProducto " +
            " INNER JOIN ventas v ON v.id = vd.idVenta " +
            " INNER JOIN cajas c ON c.id = v.idCaja " +
            " WHERE c.fechaBaja IS NULL " + 
            filtro +
            " GROUP BY vd.idProducto " +
            " ORDER BY total DESC " +
            paginado +
            endCount;

            return query;
            
    } catch (error) {
        throw error; 
    }
}


function obtenerRangosFecha(filtro:FiltroEstadistica){
  const today = new Date();
  let fechaDesde, fechaHasta;

  switch (filtro.rango) {
    case 'hoy':
      fechaDesde = moment().startOf('day');
      fechaHasta = moment().endOf('day');
      break;

    case 'semana':
      fechaDesde = moment().startOf('week'); 
      fechaHasta = moment().endOf('day'); 
      break;

    case 'mes':
      fechaDesde = moment().startOf('month');
      fechaHasta = moment().endOf('day');
      break;

    case 'anio':
      fechaDesde = moment().startOf('year');
      fechaHasta = moment().endOf('day');
      break;

    case 'personalizado':
      fechaDesde = moment(filtro.inicio).startOf('day');
      fechaHasta = moment(filtro.fin).endOf('day');
      break;

    default:
      throw new Error('Rango inválido');
  }

  return {
    fechaDesde: fechaDesde.format('YYYY-MM-DD HH:mm:ss'),
    fechaHasta: fechaHasta.format('YYYY-MM-DD HH:mm:ss'),
  };
};

export const EstadisticasRepo = new EstadisticasRepository();

