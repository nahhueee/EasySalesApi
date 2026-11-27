// Envío de bytes a la cola de una impresora de Windows como datatype RAW (sin pasar por el driver).
// El .ps1 va EMBEBIDO: tsc no copia archivos que no son .ts y el ZIP de actualización solo lleva dist/src.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuid } from 'uuid';

// Ver documentos/handoff_impresion_escpos_anexos/rawprint.ps1. Sin backticks ni ${ para ir en un template literal.
const SCRIPT_RAWPRINT = String.raw`# Manda un archivo binario a una cola de impresión de Windows como datatype RAW (sin pasar por el driver).
param([Parameter(Mandatory=$true)][string]$Impresora, [Parameter(Mandatory=$true)][string]$Archivo)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class RawPrn {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
}
"@
$bytes = [System.IO.File]::ReadAllBytes($Archivo)
$h = [IntPtr]::Zero
if (-not [RawPrn]::OpenPrinter($Impresora, [ref]$h, [IntPtr]::Zero)) { throw "OpenPrinter fallo ($([Runtime.InteropServices.Marshal]::GetLastWin32Error())): revisar el nombre exacto de la impresora" }
try {
  $di = New-Object RawPrn+DOCINFO; $di.pDocName = "EasySales RAW"; $di.pDataType = "RAW"
  if (-not [RawPrn]::StartDocPrinter($h, 1, $di)) { throw "StartDocPrinter fallo ($([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
  [void][RawPrn]::StartPagePrinter($h)
  $off = 0
  while ($off -lt $bytes.Length) {
    $n = [Math]::Min(16384, $bytes.Length - $off)
    $chunk = New-Object byte[] $n; [Array]::Copy($bytes, $off, $chunk, 0, $n)
    $w = 0
    if (-not [RawPrn]::WritePrinter($h, $chunk, $n, [ref]$w)) { throw "WritePrinter fallo ($([Runtime.InteropServices.Marshal]::GetLastWin32Error())) en offset $off" }
    $off += $n
  }
  [void][RawPrn]::EndPagePrinter($h); [void][RawPrn]::EndDocPrinter($h)
  Write-Output "OK: $($bytes.Length) bytes enviados RAW a '$Impresora'"
} finally { [void][RawPrn]::ClosePrinter($h) }
`;

const TIMEOUT_MS = 30_000;

/** Escribe el script embebido en un temporal único y reutilizable (solo se reescribe si cambió). */
function asegurarScript(): string {
  const ruta = path.join(os.tmpdir(), 'easysales_rawprint.ps1');
  let actual: string | null = null;
  try { actual = fs.readFileSync(ruta, 'utf8'); } catch { /* no existe todavía */ }
  if (actual !== SCRIPT_RAWPRINT) fs.writeFileSync(ruta, SCRIPT_RAWPRINT, 'utf8');
  return ruta;
}

export async function enviarRaw(bytes: Buffer, impresora: string): Promise<void> {
  const rutaBin = path.join(os.tmpdir(), `easysales_escpos_${uuid()}.bin`);
  try {
    fs.writeFileSync(rutaBin, bytes);
    const ps1 = asegurarScript();
    // Se accede a execFile en el momento de la llamada (no destructurado al cargar) para poder espiarlo en Jest.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const childProcess = require('child_process');
    await new Promise<void>((resolve, reject) => {
      childProcess.execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Impresora', impresora, '-Archivo', rutaBin],
        { timeout: TIMEOUT_MS, windowsHide: true },
        (error: Error | null, _stdout: string, stderr: string) => {
          if (error) reject(new Error(`${error.message}${stderr ? ` | ${String(stderr).trim()}` : ''}`));
          else resolve();
        },
      );
    });
  } finally {
    try { fs.unlinkSync(rutaBin); } catch { /* ya no está: nada que borrar */ }
  }
}
