/**
 * Antes de `npm run start:tunnel` / `start:tunnel:devclient`:
 * 1) Carga `.env` y exige EXPO_NGROK_AUTH_TOKEN + EXPO_NGROK_BIN (sin # al inicio de la línea en el archivo).
 * 2) En Windows intenta liberar el puerto 8081 (Metro/Expo colgado).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

require('dotenv').config({ path: envPath });

function die(msg) {
  console.error(`\n[ensure-expo-tunnel-ready] ${msg}\n`);
  process.exit(1);
}

function readEnvFileRaw() {
  if (!fs.existsSync(envPath)) {
    die(`No existe .env en ${envPath}\nCopiá .env.example como .env y completá las variables.`);
  }
  return fs.readFileSync(envPath, 'utf8');
}

function lineForKeyIsCommented(raw, key) {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    if (t.startsWith(`${key}=`)) return false;
    if (t.startsWith(`${key} =`)) return false;
  }
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(`#${key}=`) || t.startsWith(`# ${key}=`) || t.startsWith(`#${key} =`)) return true;
  }
  return null;
}

function freePort8081() {
  if (process.platform !== 'win32') {
    try {
      execSync('command -v lsof >/dev/null 2>&1 && lsof -ti:8081 | xargs kill -9 2>/dev/null', {
        stdio: 'ignore',
        shell: '/bin/bash',
      });
    } catch {
      /* ok */
    }
    return;
  }

  const psOneLine =
    'Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }';
  try {
    execSync(`powershell -NoProfile -Command '${psOneLine}'`, { stdio: 'ignore' });
  } catch {
    /* Sin listeners en 8081 o sin permiso: Expo igual puede arrancar u ofrecer otro puerto. */
  }
  console.log('[ensure-expo-tunnel-ready] Puerto 8081: se intentó liberar procesos en escucha (si había).');
}

function main() {
  const raw = readEnvFileRaw();
  const token = (process.env.EXPO_NGROK_AUTH_TOKEN ?? '').trim();
  const bin = (process.env.EXPO_NGROK_BIN ?? '').trim();

  const commentedToken = lineForKeyIsCommented(raw, 'EXPO_NGROK_AUTH_TOKEN');
  const commentedBin = lineForKeyIsCommented(raw, 'EXPO_NGROK_BIN');

  if (commentedToken === true) {
    die('En .env tenés EXPO_NGROK_AUTH_TOKEN comentado con #. Quitá el # al inicio de esa línea.');
  }
  if (commentedBin === true) {
    die('En .env tenés EXPO_NGROK_BIN comentado con #. Quitá el # al inicio de esa línea.');
  }

  if (!token) {
    die(
      'Falta EXPO_NGROK_AUTH_TOKEN en .env (valor vacío o sin definir).\n' +
        'Obtené el token en https://dashboard.ngrok.com/get-started/your-authtoken y agregá:\n' +
        'EXPO_NGROK_AUTH_TOKEN=tu_token',
    );
  }

  if (!bin) {
    die(
      'Falta EXPO_NGROK_BIN en .env.\n' +
        'Ejemplo (ajustá la ruta si ngrok está en otro lado):\n' +
        'EXPO_NGROK_BIN=C:\\\\ngrok\\\\ngrok.exe',
    );
  }

  const binNorm = path.normalize(bin);
  if (!fs.existsSync(binNorm)) {
    die(`EXPO_NGROK_BIN apunta a un archivo que no existe:\n${binNorm}`);
  }

  freePort8081();

  console.log('[ensure-expo-tunnel-ready] OK: variables ngrok y binario verificados.\n');
}

main();
