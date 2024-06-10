const moment = require('moment');

export class Caja{
    id? : number;
    idResponsable? : number;
    responsable? : string;
    fecha? : Date;
    hora? : string;
    inicial? : number;
    ventas? : number;
    entradas? : number;
    salidas? : number;
    total? : number;
    finalizada? : boolean;

    constructor(data?: any) {
        if (data) {

            this.id = data.id;
            this.idResponsable = data.idResponsable;
            this.responsable = data.responsable;
            this.fecha = data.fecha;
            this.hora = data.hora;
            this.inicial = parseFloat(data.inicial);
            this.ventas = parseFloat(data.ventas);
            this.entradas = parseFloat(data.entradas);
            this.salidas = parseFloat(data.salidas);
            this.total = this.inicial + this.ventas + this.entradas - this.salidas;
            this.finalizada = data.finalizada == 1 ? true : false;
        }
    }
}
  
  