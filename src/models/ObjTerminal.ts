export class ObjTerminal {
    idCliente?:number;
    nombre?:string;
    terminal?:number;
    habilitado?:boolean;

    constructor(data?: any) {
        if (data) {
          this.idCliente = data.idCliente;
          this.nombre = data.nombre;
          this.terminal = data.terminal;
          this.habilitado = data.habilitado;
        }
    }
}