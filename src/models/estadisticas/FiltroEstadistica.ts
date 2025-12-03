export class FiltroEstadistica {
    rango: 'hoy' | 'semana' | 'mes' | 'anio' | 'personalizado' = 'hoy';
    inicio?:Date;
    fin?:Date;
}