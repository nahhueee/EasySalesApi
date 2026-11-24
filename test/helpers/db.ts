// Conexión propia para VERIFICAR el estado de la base con SQL (no pasa por la app).
// Solo puede apuntar a easysales_test.
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'config.test.json'), 'utf8'));
if (config.db.database !== 'easysales_test') throw new Error('Los tests solo corren contra easysales_test.');

let pool: mysql.Pool | null = null;
function obtenerPool() {
  if (!pool) pool = mysql.createPool({ ...config.db, connectionLimit: 2 });
  return pool;
}

export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await obtenerPool().query(sql, params);
  return rows as T[];
}
export async function q1<T = any>(sql: string, params: any[] = []): Promise<T> {
  return (await q<T>(sql, params))[0];
}
/** INSERT directo (datos de prueba que la API no crea): devuelve el insertId. */
export async function insertar(sql: string, params: any[] = []): Promise<number> {
  const [r]: any = await obtenerPool().query(sql, params);
  return r.insertId;
}
export async function cerrarDb() {
  if (pool) { await pool.end(); pool = null; }
}

// --- consultas de verificación usadas por varios tests ---
export const num = (v: any) => Number(v);

export async function caja(id: number) {
  const c: any = await q1('SELECT id, inicial, ventas, entradas, salidas, finalizada FROM cajas WHERE id = ?', [id]);
  return { ...c, inicial: num(c.inicial), ventas: num(c.ventas), entradas: num(c.entradas), salidas: num(c.salidas) };
}
export async function pedido(id: number): Promise<any> {
  return q1('SELECT * FROM pedidos WHERE id = ?', [id]);
}
export async function detallesDb(idPedido: number): Promise<any[]> {
  return q('SELECT idProducto, cantidad, precio, total FROM pedidos_detalle WHERE idPedido = ? ORDER BY id', [idPedido]);
}
export async function pagos(idPedido: number): Promise<any[]> {
  return q('SELECT * FROM pedidos_pagos WHERE idPedido = ? ORDER BY id', [idPedido]);
}
export async function historial(idPedido: number): Promise<any[]> {
  return q('SELECT estadoAnterior, estadoNuevo, observacion FROM pedidos_estados_historial WHERE idPedido = ? ORDER BY id', [idPedido]);
}
export async function movimientosDePedido(idPedido: number): Promise<any[]> {
  return q(
    `SELECT cm.* FROM cajas_movimientos cm JOIN pedidos_pagos pp ON pp.id = cm.idPedidoPago
     WHERE pp.idPedido = ? ORDER BY cm.id`, [idPedido]);
}
export async function senaNeta(idPedido: number) {
  const r: any = await q1(
    `SELECT COALESCE(SUM(CASE WHEN tipo='pago' THEN monto ELSE -monto END),0) AS neta
     FROM pedidos_pagos WHERE idPedido = ? AND anulado = 0`, [idPedido]);
  return num(r.neta);
}
export async function saldoCC(idCliente: number) {
  const r: any = await q1('SELECT saldo FROM cuenta_corriente_movimientos WHERE idCliente = ? ORDER BY id DESC LIMIT 1', [idCliente]);
  return r ? num(r.saldo) : 0;
}
export async function contar(tabla: string, where = '1=1', params: any[] = []) {
  const r: any = await q1(`SELECT COUNT(*) AS n FROM \`${tabla}\` WHERE ${where}`, params);
  return num(r.n);
}
/** Crea una caja de test (abierta o cerrada) y devuelve su id. */
export async function crearCaja(finalizada = false, inicial = 0): Promise<number> {
  const [r]: any = await obtenerPool().query(
    `INSERT INTO cajas (idResponsable, fecha, hora, inicial, ventas, entradas, salidas, finalizada)
     VALUES (2, CURDATE(), '08:00', ?, 0, 0, 0, ?)`, [inicial, finalizada ? 1 : 0]);
  return r.insertId;
}
export async function cerrarCaja(id: number) {
  await q('UPDATE cajas SET finalizada = 1 WHERE id = ?', [id]);
}
