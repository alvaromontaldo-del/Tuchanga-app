/**
 * Arranca Metro en localhost:8081 y expone el puerto con localtunnel (sin ngrok / sin DNS a connect.ngrok.com).
 * Útil cuando `npm run start:tunnel:devclient` falla con "ngrok tunnel took too long to connect".
 *
 * Uso: npm run start:devclient:localtunnel
 *
 * Limitación Android: la verificación en Chrome guarda cookie solo en el navegador; la app nativa
 * suele seguir recibiendo la página HTML y falla con "Unable to load script". Preferí:
 *   npm run start:devclient:cloudflared
 *
 * La Lonja: en la dev build, "Enter URL manually" y pegar la línea exp+... que imprime este script.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const appJson = require(path.join(root, 'app.json'));
const slug = appJson?.expo?.slug || 'tuchanga-app';
const scheme = `exp+${slug}`;

function waitForMetro(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
        else if (Date.now() < deadline) setTimeout(tryOnce, 400);
        else reject(new Error(`Metro /status respondió ${res.statusCode}`));
      });
      req.on('error', () => {
        if (Date.now() < deadline) setTimeout(tryOnce, 400);
        else reject(new Error('Metro no respondió en 8081 (¿arrancó Expo?).'));
      });
      req.setTimeout(2500, () => {
        req.destroy();
        if (Date.now() < deadline) setTimeout(tryOnce, 400);
        else reject(new Error('Timeout esperando Metro en 8081.'));
      });
    };
    tryOnce();
  });
}

async function main() {
  require('dotenv').config({ path: path.join(root, '.env') });

  const localtunnel = require('localtunnel');
  const expoCli = path.join(root, 'node_modules', 'expo', 'bin', 'cli');

  const child = spawn(
    process.execPath,
    ['-r', 'dotenv/config', expoCli, 'start', '--dev-client', '--localhost', '--port', '8081'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env },
      windowsHide: true,
    },
  );

  child.on('error', (err) => {
    console.error('[start-devclient-localtunnel] No se pudo iniciar Expo:', err.message);
    process.exit(1);
  });

  try {
    await waitForMetro(8081, 90_000);
  } catch (e) {
    console.error(`[start-devclient-localtunnel] ${e.message}`);
    child.kill('SIGTERM');
    process.exit(1);
  }

  let tunnel;
  try {
    tunnel = await localtunnel({ port: 8081 });
  } catch (e) {
    console.error('[start-devclient-localtunnel] localtunnel falló:', e.message || e);
    child.kill('SIGTERM');
    process.exit(1);
  }

  const packagerUrl = tunnel.url.replace(/\/$/, '');
  const devUrl = `${scheme}://expo-development-client/?url=${encodeURIComponent(packagerUrl)}`;

  tunnel.on('error', (err) => {
    console.error('[start-devclient-localtunnel] Error del túnel:', err.message || err);
  });

  tunnel.on('close', () => {
    console.log('\n[start-devclient-localtunnel] Túnel cerrado.');
  });

  const line = '─'.repeat(72);
  console.log(`\n\x1b[32m${line}\x1b[0m`);
  console.log('\x1b[32m  Tu Changa — copiá y pegá (mientras esta terminal siga abierta)\x1b[0m');
  console.log(`\x1b[32m${line}\x1b[0m\n`);

  console.log('\x1b[36m1) Chrome del celular (verificación localtunnel, si hace falta)\x1b[0m');
  console.log('   Pegá SOLO esta línea (con https:// y sin %):\n');
  console.log(`   ${packagerUrl}\n`);

  console.log('\x1b[36m2) App “Tu Changa” Development Build → Enter URL manually → Connect\x1b[0m');
  console.log('   Pegá SOLO esta línea COMPLETA (el ?url=… va con %3A y %2F, es normal):\n');
  console.log(`   ${devUrl}\n`);

  console.log(
    '\x1b[90mSi Chrome muestra 503: el túnel ya no está activo (cerraste esta ventana o se cayó Metro). Volvé a correr npm run start:devclient:localtunnel y usá los links NUEVOS.\x1b[0m\n',
  );
  console.log('Ctrl+C acá cierra Metro y el túnel.\n');

  const shutdown = () => {
    try {
      tunnel.close();
    } catch {
      /* */
    }
    try {
      child.kill('SIGTERM');
    } catch {
      /* */
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  child.on('exit', (code) => {
    try {
      tunnel.close();
    } catch {
      /* */
    }
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
