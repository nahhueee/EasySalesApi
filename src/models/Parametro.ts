export class Parametro {
    DNI?:number;
    expresion?:string;

    constructor(data?: any) {
        if (data) {
          this.DNI = data.DNI;
          this.expresion = data.expresion;
        }
    }
}