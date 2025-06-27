export class TotalAcumulado{
    nombre? : string;
    total? : number;

    constructor(data?: any) {
        if (data) {
        this.nombre = data.nombre;
        this.total = data.total;
        }
    }
}
  