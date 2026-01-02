import path from "path";
import PdfPrinter from 'pdfmake';
import { ObjComprobante } from "../models/impresion/ObjComprobante";
import { ObjTicketFactura } from "../models/impresion/ObjTicketFactura";
import { ParametrosRepo } from "../data/parametrosRepository";
import { FacturacionServ } from "./facturacionService";
import { Venta } from "../models/Venta";

const fonts = {
  Roboto: {
    normal: path.join(__dirname, '../fonts/Roboto-Regular.ttf'),
    bold: path.join(__dirname, '../fonts/Roboto-Medium.ttf'),
    italics: path.join(__dirname, '../fonts/Roboto-Italic.ttf'),
    bolditalics: path.join(__dirname, '../fonts/Roboto-MediumItalic.ttf')
  }
};

const printer = new PdfPrinter(fonts);

class ComprobanteService {
    async GenerarComprobantePDF(pedido, parametrosImpresion, tipoComprobante) {
        const comprobante = this.GenerarDatosComunes(pedido, parametrosImpresion.papel);

        comprobante.papel = parametrosImpresion.papel;
        comprobante.margenDer = parametrosImpresion.margenDer;
        comprobante.margenIzq = parametrosImpresion.margenIzq;
        comprobante.nombreLocal = parametrosImpresion.nomLocal;
        comprobante.desLocal = parametrosImpresion.desLocal;
        comprobante.dirLocal = parametrosImpresion.dirLocal;
        let docDefinition;  

        if(tipoComprobante === "interno"){ //Comprobantes internos
            switch (comprobante.papel) {
                case "58mm":
                    docDefinition = this.ArmarInterno58(comprobante);
                    break;
                case "80mm":
                    docDefinition = this.ArmarInterno80(comprobante)
                    break;
                case "A4":
                    docDefinition = this.ArmarInternoA4(comprobante)
                    break;
            }
        }else{  //Comprobantes tipo factura
    
            //Obtenemos los datos de la venta facturada
            const datosFactura:ObjTicketFactura = new ObjTicketFactura({
                puntoVta : pedido.factura?.ptoVenta,
                ticket : pedido.factura?.ticket,
                neto : pedido.factura?.neto,
                iva : pedido.factura?.iva,
                cae : pedido.factura?.cae,
                nroTipoFactura: pedido.factura?.tipoFactura,
                DNI: pedido.factura?.dni,
                tipoDNI: pedido.factura?.tipoDni
            });
    
            //Formateamos la fecha
            const fecha = new Date(pedido.factura?.caeVto!);
            datosFactura.caeVto = fecha.toLocaleDateString('es-ES', {
            day: '2-digit', month: '2-digit', year: '2-digit'
            });
    
            //Indicamos el tipo de factura realizada
            switch (datosFactura.nroTipoFactura) {
            case 1:
                datosFactura.tipoFactura = "A";
                break;
            case 6:
                datosFactura.tipoFactura = "B";
                break;
            case 11:
                datosFactura.tipoFactura = "C";
                break;
            }
    
            //Obtenemos datos grabados para la facturacion
            const parametrosFacturacion = await ParametrosRepo.ObtenerParametrosFacturacion();
            if(parametrosFacturacion.condicion == 'responsable_inscripto'){
                datosFactura.condicion = "RESPONSABLE INSCRIPTO";
            }else{
            datosFactura.condicion = "MONOTRIBUTISTA";
            }
            datosFactura.CUIL = parametrosFacturacion.cuil;
            datosFactura.direccion = parametrosFacturacion.direccion;
            datosFactura.razon = parametrosFacturacion.razon;

            //Definimos datos del receptor
            if(datosFactura.nroTipoFactura == 1){
            datosFactura.condReceptor = "IVA Responsable Inscripto";
            }else{
            datosFactura.condReceptor = "Consumidor Final";
            }

            //Obtenemos el codigo QR
            datosFactura.qr = await FacturacionServ.ObtenerQRFactura(pedido.id!);
            
            switch (comprobante.papel) {
                case "58mm":
                    docDefinition = this.ArmarFactura58(comprobante, datosFactura);
                    break;
                case "80mm":
                    docDefinition = this.ArmarFactura80(comprobante, datosFactura);
                    break;
                case "A4":
                    docDefinition = this.ArmarFacturaA4(comprobante, datosFactura);
                    break;
            }
        }

        return new Promise<Buffer>((resolve, reject) => {
            try {
                const chunks: Uint8Array[] = [];
                const pdfDoc = printer.createPdfKitDocument(docDefinition);

                pdfDoc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
                pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
                pdfDoc.on('error', reject);

                pdfDoc.end();
            } catch (err) {
                reject(err);
            }
        });

    }

    //Genera los datos comunes del documento y la estructura de la tabla
    private GenerarDatosComunes(venta:Venta, papel:string): ObjComprobante {
      let comprobante = new ObjComprobante();
      
      comprobante.horaVenta = venta.hora;
      const fecha = new Date(venta.fecha!);
      comprobante.fechaVenta = fecha.toLocaleDateString('es-ES', {
        day: '2-digit', month: '2-digit', year: '2-digit'
      });
  
      const FormatearCantidad = (cantidad) => {
        const cantNumero = parseFloat(cantidad);
        return cantNumero % 1 === 0 ? cantNumero.toFixed(0) : cantNumero.toFixed(1);
      };
  
      const FormatearPrecio = (precio) => {
        const pNumero = parseFloat(precio);
        return pNumero.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      };
  
      const CortarNombreProducto = (nombreProd) => {
            if(papel == "58mm")
            return nombreProd.length > 25 ? nombreProd.substring(0, 25) + '...' : nombreProd;

            if(papel == "80mm")
            return nombreProd.length > 35 ? nombreProd.substring(0, 35) + '...' : nombreProd;

            if(papel == "A4")
            return nombreProd;
        };
  
      comprobante.filasTabla = [
        [
          { text: 'C', style: 'tableHeader', alignment: 'left' },
          { text: 'Producto', style: 'tableHeader', alignment: 'left' },
          { text: 'Precio', style: 'tableHeader', alignment: 'right' },
          { text: 'Total', style: 'tableHeader', alignment: 'right' }
        ]
      ];
  
      venta.detalles!.forEach(item => {
        comprobante.filasTabla?.push([
          FormatearCantidad(item.cantidad),
          CortarNombreProducto(item.nomProd),
          { text: FormatearPrecio(item.precio), alignment: 'right' },
          { text: FormatearPrecio(item.total), alignment: 'right' }
        ]);
      });
  
      let totalProducto = venta.detalles!.reduce((sum, item) => sum + (item.cantidad! * item.precio!), 0);
      let total = totalProducto;
      if (venta.pago!.descuento != 0) {
        total -= (totalProducto * (venta.pago!.descuento! / 100));
      }
      if (venta.pago!.recargo != 0) {
        total += (totalProducto * (venta.pago!.recargo! / 100));
      }
  
      comprobante.totalProductos = totalProducto;
      comprobante.descuento = venta.pago!.descuento;
      comprobante.recargo = venta.pago!.recargo;
      comprobante.totalFinal = total;
  
      return comprobante;
    }

    //#region COMPROBANTE INTERNO
    private ArmarInterno58(comprobante:ObjComprobante){
      return {
        pageSize: {
          width: 140,
          height: 800,
        },
        pageMargins: [comprobante.margenIzq, 0, comprobante.margenDer, 0],
        content: [
          { text: comprobante.nombreLocal?.toUpperCase(), style: 'titulo', alignment: 'center' },
          { text: comprobante.desLocal, style: 'subtitulo', alignment: 'center' },
          { text: comprobante.dirLocal, style: 'direccion', alignment: 'center' },
          
          { text: comprobante.fechaVenta + " " +  comprobante.horaVenta, alignment: 'center', style:'fecha' },
                    
          {
            table: {
              widths: ['auto', '*', 'auto', 'auto'],
              body: comprobante.filasTabla
            },
            layout: {
              fillColor: function (rowIndex, node, columnIndex) {
                return rowIndex === 0 ? '#CCCCCC' : null;
              },
              hLineWidth: function (i, node) {
                // Línea después del header (i == 1) y después de la última fila (i == node.table.body.length)
                return (i === 1 || i === node.table.body.length) ? 1 : 0;
              },
              vLineWidth: function (i, node) {
                return 0;
              },
              hLineColor: function (i, node) {
                return i === 1 ? 'black' : '#CCCCCC';
              },
              paddingTop: function (i, node) { return 2; },
              paddingBottom: function (i, node) { return 2; },
            },
            style: 'tableStyle' // Aplicar el estilo a la tabla
          },
          
          { text: `Productos: ${comprobante.totalProductos?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Descuento: ${comprobante.descuento}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Recargo: ${comprobante.recargo}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Total: $${comprobante.totalFinal?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'total', alignment: 'right' }
        ],
        styles: {
          titulo: {
            fontSize: 14,
            bold: true,
            margin: [0, 0, 0, 0]
          },
          subtitulo: {
            fontSize: 8,
            margin: [0, 0, 0, 1]
          },
          direccion: {
            fontSize: 8,
            italics: true,
            margin: [0, 0, 0, 0]
          },
          fecha: {
            fontSize: 8,
            margin: [0, 3, 0, 3]
          },
          total: {
            fontSize: 10,
            bold: true,
            margin: [3, 5, 3, 5]
          },
          recargaDescuento: {
            fontSize: 8,
            bold: false,
            margin: [3, 0, 3, 0]
          },
          tableStyle: {
            fontSize: 7, // Cambiar el tamaño de letra de la tabla
            margin: [0, 3, 0, 3]
          }
        }
      };
    }

    private ArmarInterno80(comprobante:ObjComprobante){
      return {
        pageSize: {
          width: 200, 
          height: 800,
        },
        pageMargins: [comprobante.margenIzq, 0, comprobante.margenDer, 0],
        content: [
          { text: comprobante.nombreLocal?.toUpperCase(), style: 'titulo', alignment: 'center' },
          { text: comprobante.desLocal, style: 'subtitulo', alignment: 'center' },
          { text: comprobante.dirLocal, style: 'direccion', alignment: 'center' },          
          { text: comprobante.fechaVenta + " " +  comprobante.horaVenta, alignment: 'center', style:'fecha' },
          
          {
            table: {
              widths: ['auto', '*', 'auto', 'auto'],
              body: comprobante.filasTabla
            },
            layout: {
              fillColor: function (rowIndex, node, columnIndex) {
                return rowIndex === 0 ? '#CCCCCC' : null;
              },
              hLineWidth: function (i, node) {
                // Línea después del header (i == 1) y después de la última fila (i == node.table.body.length)
                return (i === 1 || i === node.table.body.length) ? 1 : 0;
              },
              vLineWidth: function (i, node) {
                return 0;
              },
              hLineColor: function (i, node) {
                return i === 1 ? 'black' : '#CCCCCC';
              },
              paddingTop: function (i, node) { return 2; },
              paddingBottom: function (i, node) { return 2; },
            },
            style: 'tableStyle' // Aplicar el estilo a la tabla
          },
          
          { text: `Productos: ${comprobante.totalProductos?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Descuento: ${comprobante.descuento}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Recargo: ${comprobante.recargo}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Total: $${comprobante.totalFinal?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'total', alignment: 'right' }
        ],
        styles: {
          titulo: {
            fontSize: 16,
            bold: true,
            margin: [0, 0, 0, 0]
          },
          subtitulo: {
            fontSize: 11,
            margin: [0, 0, 0, 1]
          },
          direccion: {
            fontSize: 11,
            italics: true,
            margin: [0, 0, 0, 0]
          },
          fecha: {
            fontSize: 11,
            margin: [0, 3, 0, 3]
          },
          total: {
            fontSize: 13,
            bold: true,
            margin: [3, 5, 3, 5]
          },
          recargaDescuento: {
            fontSize: 11,
            bold: false,
            margin: [3, 0, 3, 0]
          },
          tableStyle: {
            fontSize: 9, // Cambiar el tamaño de letra de la tabla
            margin: [0, 6, 0, 3]
          }
        }
      };
    }
  
    private ArmarInternoA4(comprobante:ObjComprobante){
      return {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [comprobante.margenIzq, 0, comprobante.margenDer, 0],
        content: [
          {
            columns: [
              { text: comprobante.nombreLocal?.toUpperCase(), style: 'titulo', alignment: 'left' },
              { text: comprobante.fechaVenta + " " + comprobante.horaVenta, style: 'fecha', alignment: 'right' }
            ]
          },        
          {
            table: {
              widths: ['auto', '*', 'auto', 'auto'],
              body: comprobante.filasTabla
            },
            layout: {
              fillColor: function (rowIndex, node, columnIndex) {
                return rowIndex === 0 ? '#CCCCCC' : null;
              },
              hLineWidth: function (i, node) {
                // Línea después del header (i == 1) y después de la última fila (i == node.table.body.length)
                return (i === 1 || i === node.table.body.length) ? 1 : 0;
              },
              vLineWidth: function (i, node) {
                return 0;
              },
              hLineColor: function (i, node) {
                return i === 1 ? 'black' : '#CCCCCC';
              },
              paddingTop: function (i, node) { return 2; },
              paddingBottom: function (i, node) { return 2; },
            },
            style: 'tableStyle' // Aplicar el estilo a la tabla
          },
          
          { text: `Productos: $${comprobante.totalProductos?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Descuento: ${comprobante.descuento}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Recargo: ${comprobante.recargo}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Total: $${comprobante.totalFinal?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'total', alignment: 'right' }
        ],
        styles: {
          titulo: {
            fontFamily: "LEMONMILK",
            fontSize: 15,
            bold: true,
            margin: [0, 0, 0, 5]
          },
          fecha: {
            fontSize: 12, 
            margin: [0, 0, 0, 5]
          },
          total: {
            fontSize: 12,
            bold: true,
            margin: [3, 12, 3, 5]
          },
         
          recargaDescuento: {
            fontSize: 11,
            bold: false,
            margin: [3, 1, 3, 1]
          },
          tableStyle: {
            fontSize: 11, // Cambiar el tamaño de letra de la tabla
            margin: [0, 0, 0, 12]
          }
        }
      };
    }
    //#endregion

    //#region COMPROBANTE FACTURA
    private ArmarFactura58(comprobante:ObjComprobante, datosFactura:ObjTicketFactura){
      return {
        pageSize: {
          width: 140,
          height: 800,
          pageOrientation: 'portrait',
        },
        pageMargins: [comprobante.margenIzq, 0, comprobante.margenDer, 0],
        content: [
          { text: datosFactura.tipoFactura, style:"tipoComprobante", alignment: 'center'},
          { text: "Cod." + datosFactura.nroTipoFactura, fontSize: 5,  alignment: 'center', margin: [0, 0, 0, 3]},

  
          { text: comprobante.nombreLocal?.toUpperCase(), style: 'titulo', alignment: 'center' },
          { text: comprobante.fechaVenta + " " +  comprobante.horaVenta, alignment: 'center', style:'fecha' },
  
          { text: datosFactura.condicion, style:'condicion' },
          { text: datosFactura.razon, style:'simple' },
          { text: datosFactura.direccion, style:'simple' },
          { text: datosFactura.puntoVta + "-" + datosFactura.ticket, style:"ticket" },
          
          {
            table: {
              widths: ['auto', '*', 'auto', 'auto'],
              body: comprobante.filasTabla
            },
            layout: {
              fillColor: function (rowIndex, node, columnIndex) {
                return rowIndex === 0 ? '#CCCCCC' : null;
              },
              hLineWidth: function (i, node) {
                // Línea después del header (i == 1) y después de la última fila (i == node.table.body.length)
                return (i === 1 || i === node.table.body.length) ? 1 : 0;
              },
              vLineWidth: function (i, node) {
                return 0;
              },
              hLineColor: function (i, node) {
                return i === 1 ? 'black' : '#CCCCCC';
              },
              paddingTop: function (i, node) { return 2; },
              paddingBottom: function (i, node) { return 2; },
            },
            style: 'tableStyle' // Aplicar el estilo a la tabla
          },
          
          { text: `Productos: $${comprobante.totalProductos?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Descuento: ${comprobante.descuento}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Recargo: ${comprobante.recargo}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Total: $${comprobante.totalFinal?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'total', alignment: 'right' },
  
         ...((datosFactura.nroTipoFactura != 11) ? [
            { text: 'IVA 21% Incluido', fontSize: 6, margin: [0, 5, 0, 3], alignment: 'center' },
            { text: `NETO: $${datosFactura.neto?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, alignment: 'center', fontSize: 8 },
            { text: `IVA: $${datosFactura.iva?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, alignment: 'center', fontSize: 8, margin: [0, 0, 0, 3] }
          ] : []),
  
          {
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    stack: [
                      { text: 'CAE Validador ARCA', alignment: 'center', fontSize: 7},
                      { text: datosFactura.cae, alignment: 'center', bold: true, fontSize: 10 },
                      { text: datosFactura.caeVto, alignment: 'center', bold: false, fontSize: 8 }
                    ]
                  }
                ]
              ]
            },
            layout: {
              hLineWidth: function (i, node) {
                return (i === 0 || i === node.table.body.length) ? 1 : 0; // borde solo arriba y abajo
              },
              vLineWidth: function () {
                return 0; // sin bordes verticales
              }
            },
            margin: [0, 2, 0, 10] 
          },
  
          {
            image: datosFactura.qr,
            width: 80,
            alignment: 'center'
          }
        ],
        styles: {
          tipoComprobante: {
            fontSize: 20,
            bold: true,
            decoration: 'underline',
          },
          condicion: {
            alignment: 'center', 
            margin: [0, 3, 0, 1],
            bold:true, 
            fontFamily: "LEMONMILK",
            fontSize: 9
          },
          simple: {
            alignment: 'center', 
            fontSize: 8
          },
          ticket:{
            alignment: 'center',  
            margin: [0, 3, 0, 5], 
            bold:true,
            fontSize: 9,
          },
          titulo: {
            fontFamily: "LEMONMILK",
            fontSize: 11,
            bold: true,
            margin: [0, 0, 0, 2]
          },
          total: {
            fontSize: 10,
            bold: true,
            margin: [3, 5, 3, 5]
          },
          recargaDescuento: {
            fontSize: 8,
            bold: false,
            margin: [3, 0, 3, 0]
          },
          fecha: {
            fontSize: 8, // Cambiar el tamaño de letra de la tabla
            margin: [0, 0, 0, 5]
          },
          tableStyle: {
            fontSize: 7, // Cambiar el tamaño de letra de la tabla
            margin: [0, 0, 0, 3]
          }
        }
      };
    }

    private ArmarFactura80(comprobante:ObjComprobante, datosFactura:ObjTicketFactura){
      return {
        pageSize: {
          width: 227,
          height: 800,
          pageOrientation: 'portrait',
        },
        pageMargins: [comprobante.margenIzq, 0, comprobante.margenDer, 0],
        content: [
          { text: datosFactura.tipoFactura, style:"tipoComprobante", alignment: 'center'},
          { text: "Cod." + datosFactura.nroTipoFactura, fontSize: 7,  alignment: 'center', margin: [0, 0, 0, 3]},

  
          { text: comprobante.nombreLocal?.toUpperCase(), style: 'titulo', alignment: 'center' },
          { text: comprobante.fechaVenta + " " +  comprobante.horaVenta, alignment: 'center', style:'fecha' },
  
          { text: datosFactura.condicion, style:'condicion' },
          { text: datosFactura.razon, style:'simple' },
          { text: datosFactura.direccion, style:'simple' },
          { text: datosFactura.puntoVta + "-" + datosFactura.ticket, style:"ticket" },
          
          {
            table: {
              widths: ['auto', '*', 'auto', 'auto'],
              body: comprobante.filasTabla
            },
            layout: {
              fillColor: function (rowIndex, node, columnIndex) {
                return rowIndex === 0 ? '#CCCCCC' : null;
              },
              hLineWidth: function (i, node) {
                // Línea después del header (i == 1) y después de la última fila (i == node.table.body.length)
                return (i === 1 || i === node.table.body.length) ? 1 : 0;
              },
              vLineWidth: function (i, node) {
                return 0;
              },
              hLineColor: function (i, node) {
                return i === 1 ? 'black' : '#CCCCCC';
              },
              paddingTop: function (i, node) { return 2; },
              paddingBottom: function (i, node) { return 2; },
            },
            style: 'tableStyle' // Aplicar el estilo a la tabla
          },
          
          { text: `Productos: $${comprobante.totalProductos?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Descuento: ${comprobante.descuento}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Recargo: ${comprobante.recargo}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Total: $${comprobante.totalFinal?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'total', alignment: 'right' },
  
         ...((datosFactura.nroTipoFactura != 11) ? [
            { text: 'IVA 21% Incluido', fontSize: 10, margin: [0, 5, 0, 3], alignment: 'center' },
            { text: `NETO: $${datosFactura.neto?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, alignment: 'center', fontSize: 11 },
            { text: `IVA: $${datosFactura.iva?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, alignment: 'center', fontSize: 11, margin: [0, 0, 0, 3] }
          ] : []),
  
          {
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    stack: [
                      { text: 'CAE Validador ARCA', alignment: 'center', fontSize: 10},
                      { text: datosFactura.cae, alignment: 'center', bold: true, fontSize: 12 },
                      { text: datosFactura.caeVto, alignment: 'center', bold: false, fontSize: 10 }
                    ]
                  }
                ]
              ]
            },
            layout: {
              hLineWidth: function (i, node) {
                return (i === 0 || i === node.table.body.length) ? 1 : 0; // borde solo arriba y abajo
              },
              vLineWidth: function () {
                return 0; // sin bordes verticales
              }
            },
            margin: [0, 2, 0, 10] 
          },
  
          {
            image: datosFactura.qr,
            width: 130,
            alignment: 'center'
          }
        ],
        styles: {
          tipoComprobante: {
            fontSize: 25,
            bold: true,
            decoration: 'underline',
          },
          condicion: {
            alignment: 'center', 
            margin: [0, 3, 0, 1],
            bold:true, 
            fontFamily: "LEMONMILK",
            fontSize: 12
          },
          simple: {
            alignment: 'center', 
            fontSize: 10
          },
          ticket:{
            alignment: 'center',  
            margin: [0, 3, 0, 5], 
            bold:true,
            fontSize: 12,
          },
          titulo: {
            fontFamily: "LEMONMILK",
            fontSize: 15,
            bold: true,
            margin: [0, 0, 0, 2]
          },
          total: {
            fontSize: 13,
            bold: true,
            margin: [3, 5, 3, 5]
          },
          recargaDescuento: {
            fontSize: 11,
            bold: false,
            margin: [3, 0, 3, 0]
          },
          fecha: {
            fontSize: 11, 
            margin: [0, 0, 0, 5]
          },
          tableStyle: {
            fontSize: 9, // Cambiar el tamaño de letra de la tabla
            margin: [0, 0, 0, 3]
          }
        }
      };
    }
  
    private ArmarFacturaA4(comprobante:ObjComprobante, datosFactura:ObjTicketFactura){
      return {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [30, 30, 30, 30],
        content: [

          //Datos de Factura y titular
          {
            table: {
              widths: ['45%', '10%', '45%'],
              body: [
                [
                  {
                    stack: [
                      { text: comprobante.nombreLocal?.toUpperCase(), style: 'titulo', alignment: 'center' },
                      {
                        text: [
                          { text: 'Condición Frente IVA: ', bold: true },
                          { text: datosFactura.condicion }
                        ],
                        style: 'simple'
                      },
                      {
                        text: [
                          { text: 'Razón Social: ', bold: true },
                          { text: datosFactura.razon }
                        ],
                        style: 'simple'
                      },
                      {
                        text: [
                          { text: 'Dirección: ', bold: true },
                          { text: datosFactura.direccion }
                        ],
                        style: 'simple'
                      }
                    ]
                  },
                  {
                    stack: [
                      { text: datosFactura.tipoFactura, style: 'tipoComprobante' },
                      { text: "Cod." + datosFactura.nroTipoFactura, fontSize: 7 }
                    ],
                    alignment: 'center'
                  },
                  {
                    stack: [
                      { text: 'FACTURA', style: 'titulo', alignment: 'center' },
                      {
                        text: [
                          { text: 'Punto y Nro Comp: ', bold: true },
                          { text: datosFactura.puntoVta + "-" + datosFactura.ticket }
                        ],
                        style: 'simple'
                      },
                      {
                        text: [
                          { text: 'Fecha Emisión: ', bold: true },
                          { text: comprobante.fechaVenta + ' - ' + comprobante.horaVenta }
                        ],
                        style: 'simple'
                      },
                      {
                        text: [
                          { text: 'CUIT: ', bold: true },
                          { text: datosFactura.CUIL }
                        ],
                        style: 'simple'
                      }
                    ]
                  }
                ]
              ]
            },
            layout: {
              hLineWidth: function () { return 0.5; },
              vLineWidth: function () { return 0.5; },
              hLineColor: function () { return '#aaa'; },
              vLineColor: function () { return '#aaa'; }
            }
          },

          //Datos Receptor
          ...((datosFactura.nroTipoFactura != 11) ? [ //Ocultamos para facturas C
            {
              table: {
                widths: ['*'],
                body: [
                  [
                    {
                      stack: [
                        {
                          text: [
                            { text: 'Condición de Venta: ', bold: true },
                            { text: 'Contado' }
                          ],
                          style: 'simple'
                        },                      {
                          text: [
                            { text: 'Condición del Receptor: ', bold: true },
                            { text: datosFactura.condReceptor }
                          ],
                          style: 'simple'
                        },
                        {
                          text: [
                            { text: 'Documento y Tipo: ', bold: true },
                            { text: datosFactura.DNI + " / " + datosFactura.tipoDNI }
                          ],
                          style: 'simple'
                        }
                      ]
                    },
                  ]
                ]
              },
              layout: {
                hLineWidth: function () { return 0.5; },
                vLineWidth: function () { return 0.5; },
                hLineColor: function () { return '#aaa'; },
                vLineColor: function () { return '#aaa'; }
              },
              margin: [0, 10, 0, 10]
            },
          ]: []),
          

          //Tabla de productos
          {
            table: {
              widths: ['auto', '*', 'auto', 'auto'],
              body: comprobante.filasTabla
            },
            layout: {
              fillColor: function (rowIndex, node, columnIndex) {
                return rowIndex === 0 ? '#CCCCCC' : null;
              },
              hLineWidth: function (i, node) {
                // Línea después del header (i == 1) y después de la última fila (i == node.table.body.length)
                return (i === 1 || i === node.table.body.length) ? 1 : 0;
              },
              vLineWidth: function (i, node) {
                return 0;
              },
              hLineColor: function (i, node) {
                return i === 1 ? 'black' : '#CCCCCC';
              },
              paddingTop: function (i, node) { return 2; },
              paddingBottom: function (i, node) { return 2; },
            },
            style: 'tableStyle' // Aplicar el estilo a la tabla
          },
          
          //Detalle totales tabla productos
          { text: `Productos: $${comprobante.totalProductos?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Descuento: ${comprobante.descuento}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Recargo: ${comprobante.recargo}%`, style: 'recargaDescuento', alignment: 'right' },
          { text: `Total: $${comprobante.totalFinal?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, style: 'total', alignment: 'right' },

          //Pie de página
          {
            columns: [
              //Columna QR
              {
                image: datosFactura.qr,
                width: 100,
                alignment: 'left',
                margin: [0, 0, 30, 0] 
              },

              // Columna central título ARCA y comprobante valido - CAE y CAEVTO
              {
                stack: [
                  { text: 'ARCA', style:"arca", alignment: 'left' },
                  { text: 'Comprobante Autorizado', fontSize: 10, italic:true, bold:true, margin: [8, 0, 0, 15], alignment: 'left' },
                  {
                    text: [
                      { text: 'CAE: ', bold: true },
                      { text: datosFactura.cae }
                    ],
                    style: 'simple'
                  },
                  {
                    text: [
                      { text: 'Vencimiento CAE: ', bold: true },
                      { text: datosFactura.caeVto }
                    ],
                    style: 'simple'
                  },
                ],
                width: 'auto' 
              },

              // Columna derecha descripcion del IVA
              ...((datosFactura.nroTipoFactura != 11) ? [ //Ocultamos para facturas C
                {
                  stack: [
                    { text: 'IVA 21% Incluido', fontSize: 10, margin: [0, 12, 0, 5] },
                    {
                      text: [
                        { text: 'Neto Total: ', bold: true },
                        { text: '$' + datosFactura.neto?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
                      ],
                      style: 'simple'
                    },
                    {
                      text: [
                        { text: 'IVA Total: ', bold: true },
                        { text: '$' + datosFactura.iva?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
                      ],
                      style: 'simple'
                    },
                    {
                      text: [
                        { text: 'Moneda: ', bold: true },
                        { text: 'PES' }
                      ],
                      style: 'simple'
                    }
                  ],
                  alignment: 'right',
                  width: '*'
                }
              ] : []),
              
            ],
            margin: [0, 15, 0, 0] 
          }

          
        ],
        styles: {
          simple: {
            fontSize: 11,
            margin: [8, 0, 0, 2]
          },
          tipoComprobante: {
            fontSize: 30,
            bold: true,
            decoration: 'underline',
            margin: [0, 10, 0, 3]
          },
          titulo: {
            fontFamily: "LEMONMILK",
            fontSize: 14,
            bold: true,
            margin: [0, 15, 0, 8]
          },
          arca: {
            fontFamily: "LEMONMILK",
            fontSize: 20,
            bold: true,
            margin: [8, 7, 0, 0]
          },
          fecha: {
            fontSize: 11, 
            margin: [0, 0, 0, 5]
          },
          total: {
            fontSize: 12,
            bold: true,
            margin: [3, 10, 3, 5]
          },
         
          recargaDescuento: {
            fontSize: 11,
            bold: false,
            margin: [3, 1, 3, 1]
          },
          tableStyle: {
            fontSize: 11, 
            margin: [0, 12, 0, 12]
          }
        }
      };
    }
    //#endregion
}

export default new ComprobanteService();
