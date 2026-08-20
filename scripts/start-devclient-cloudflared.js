/**
 * Metro en localhost:8081 + túnel público con **Cloudflare Quick Tunnel** (cloudflared).
 * Suele funcionar mejor que localtunnel en Android: no hay la pantalla de “ingresá la IP”
 * que en Chrome guarda cookie que **la app nativa no envía** al pedir el bundle → "Unable to load script".
 *
 * Expo arma el `bundleUrl` del manifiesto con el puerto de Metro (8081) salvo que exista
 * `EXPO_PACKAGER_PROXY_URL` apuntando al origen HTTPS del túnel; sin eso el cliente pide
 * `https://*.trycloudflare.com:8081/...` (no existe en el edge) → java.lang.RuntimeException:
 * Unable to load script. Por eso, tras conocer la URL del túnel, **reiniciamos Metro** con
 * esa variable ya definida.
 *
 * Requisito: tener `cloudflared` instalado y en PATH, o definir CLOUDFLARED_BIN en .env
 * (ej. CLOUDFLARED_BIN=C:\\Program Files (x86)\\cloudflared\\cloudflared.exe).
 *
 * Uso: npm run start:devclient:cloudflared
 */
const http = require('http');
const https = require('https');
const path = require('path');
const { execSync, spawn } = require('child_process');

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

function findCloudflaredBin() {
  require('dotenv').config({ path: path.join(root, '.env') });
  const fromEnv = (process.env.CLOUDFLARED_BIN ?? '').trim().replace(/^["']|["']$/g, '');
  if (fromEnv) return fromEnv;
  return 'cloudflared';
}

/** Subdominios que cloudflared menciona en logs pero no son túneles Quick Tunnel. */
const IGNORE_TRYCF_HOSTS = new Set(['api', 'www', 'developers']);

function tryParseTryCloudflareUrl(line) {
  const m = String(line).match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com\/?/i);
  if (!m) return null;
  if (IGNORE_TRYCF_HOSTS.has(m[1].toLowerCase())) return null;
  return m[0].replace(/\/$/, '');
}

async function waitForTunnelUrl(cfProc, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      if (timer) clearInterval(timer);
      cfProc.stdout.removeAllListeners('data');
      cfProc.stderr.removeAllListeners('data');
      cfProc.removeListener('exit', onExit);
    };
    const finish = (err, url) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(url);
    };
    const tryBuf = (buf) => {
      const u = tryParseTryCloudflareUrl(buf.toString());
      if (u) finish(null, u);
    };
    const onExit = (code) => {
      if (!settled) finish(new Error(`cloudflared salió con código ${code} antes de mostrar la URL`));
    };
    cfProc.stdout.on('data', tryBuf);
    cfProc.stderr.on('data', tryBuf);
    cfProc.once('exit', onExit);
    const start = Date.now();
    timer = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        finish(new Error('No apareció URL *.trycloudflare.com en 90s (¿cloudflared instalado / bloqueado?).'));
      }
    }, 400);
  });
}

function spawnExpo(extraEnv) {
  const expoCli = path.join(root, 'node_modules', 'expo', 'bin', 'cli');
  return spawn(
    process.execPath,
    ['-r', 'dotenv/config', expoCli, 'start', '--dev-client', '--localhost', '--port', '8081'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    },
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Libera 8081 en Windows si quedó una sesión vieja de Expo/Metro. */
function freeLocalPort(port) {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', windowsHide: true });
        console.log(`[start-devclient-cloudflared] Liberado puerto ${port} (PID ${pid}).`);
      } catch {
        /* */
      }
    }
  } catch {
    /* puerto libre */
  }
}

async function waitForProcessExit(proc, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* */
      }
      const t2 = setTimeout(() => reject(new Error(`${label} no terminó en ${timeoutMs}ms (probá cerrar la ventana de Expo a mano).`)), 12_000);
      proc.once('exit', () => {
        clearTimeout(t2);
        resolve();
      });
    }, timeoutMs);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Comprueba por HTTPS (como el celular) que el manifiesto no incluya :8081 en el host del túnel. */
async function warnIfManifestUsesTunnelPort8081(publicOrigin) {
  let u;
  try {
    u = new URL(publicOrigin);
  } catch {
    return;
  }

  async function fetchManifestOnce() {
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: u.hostname,
          port: 443,
          path: '/',
          method: 'GET',
          headers: {
            'expo-platform': 'android',
            accept: 'application/json, multipart/mixed, */*',
          },
          servername: u.hostname,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        },
      );
      req.on('error', (e) => resolve({ error: e.message }));
      req.setTimeout(18_000, () => {
        req.destroy();
        resolve({ error: 'timeout' });
      });
      req.end();
    });
  }

  let body = '';
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const result = await fetchManifestOnce();
    if (typeof result === 'string' && result) {
      body = result;
      break;
    }
    const errMsg = typeof result === 'object' && result?.error ? result.error : 'sin respuesta';
    if (attempt < 6) {
      console.log(
        `[start-devclient-cloudflared] Túnel aún no responde (${errMsg}); reintento ${attempt}/6 en 3s…`,
      );
      await sleep(3000);
    } else {
      console.warn(
        `[start-devclient-cloudflared] No se pudo leer el manifiesto vía túnel: ${errMsg}. ` +
          'Si La Lonja falla al conectar, esperá 10s y volvé a ejecutar el script.',
      );
    }
  }

  if (!body) return;
  if (body.includes('trycloudflare.com:8081') || body.includes('trycloudflare.com%3A8081')) {
    console.error(
      '\n[start-devclient-cloudflared] PROBLEMA: el manifiesto aún referencia trycloudflare.com:8081. ' +
        'Metro no está usando EXPO_PACKAGER_PROXY_URL. Guardá este script, Ctrl+C y volvé a ejecutar npm run start:devclient:cloudflared.\n',
    );
  } else {
    console.log(
      '[start-devclient-cloudflared] Verificación HTTPS: no aparece trycloudflare.com:8081 en el manifiesto (correcto).',
    );
  }
}

async function main() {
  require('dotenv').config({ path: path.join(root, '.env') });

  freeLocalPort(8081);
  await sleep(400);

  const cfBin = findCloudflaredBin();

  let child = spawnExpo({});

  child.on('error', (err) => {
    console.error('[start-devclient-cloudflared] Expo:', err.message);
    process.exit(1);
  });

  try {
    await waitForMetro(8081, 90_000);
  } catch (e) {
    console.error(`[start-devclient-cloudflared] ${e.message}`);
    child.kill('SIGTERM');
    process.exit(1);
  }

  const cf = spawn(cfBin, ['tunnel', '--url', 'http://127.0.0.1:8081'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  cf.on('error', (err) => {
    console.error(
      '[start-devclient-cloudflared] No se pudo ejecutar cloudflared:',
      err.message,
      '\nInstalalo desde https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
        'o definí CLOUDFLARED_BIN en .env con la ruta al .exe',
    );
    child.kill('SIGTERM');
    process.exit(1);
  });

  let packagerUrl;
  try {
    packagerUrl = await waitForTunnelUrl(cf, 90_000);
  } catch (e) {
    console.error('[start-devclient-cloudflared]', e.message);
    try {
      cf.kill('SIGTERM');
    } catch {
      /* */
    }
    child.kill('SIGTERM');
    process.exit(1);
  }

  const proxyOrigin = packagerUrl.replace(/\/$/, '');
  console.log(
    `\n[start-devclient-cloudflared] Reiniciando Metro con EXPO_PACKAGER_PROXY_URL=${proxyOrigin}\n` +
      '(sin esto el manifiesto suele usar :8081 en el dominio del túnel y Android muestra "Unable to load script".)\n',
  );
  console.log(
    '\x1b[33m[start-devclient-cloudflared]\x1b[0m Cerrando la primera corrida de Expo / Metro…\n',
  );

  try {
    child.kill('SIGTERM');
    await waitForProcessExit(child, 'Expo', 25_000);
  } catch (e) {
    console.error('[start-devclient-cloudflared]', e.message);
    try {
      cf.kill('SIGTERM');
    } catch {
      /* */
    }
    process.exit(1);
  }

  await sleep(900);

  child = spawnExpo({ EXPO_PACKAGER_PROXY_URL: proxyOrigin });

  child.on('error', (err) => {
    console.error('[start-devclient-cloudflared] Expo (2ª corrida):', err.message);
    try {
      cf.kill('SIGTERM');
    } catch {
      /* */
    }
    process.exit(1);
  });

  try {
    await waitForMetro(8081, 90_000);
  } catch (e) {
    console.error(`[start-devclient-cloudflared] Tras reinicio: ${e.message}`);
    try {
      cf.kill('SIGTERM');
    } catch {
      /* */
    }
    child.kill('SIGTERM');
    process.exit(1);
  }

  await warnIfManifestUsesTunnelPort8081(proxyOrigin);

  const devUrl = `${scheme}://expo-development-client/?url=${encodeURIComponent(packagerUrl)}`;
  const line = '─'.repeat(72);
  console.log(`\n\x1b[32m${line}\x1b[0m`);
  console.log('\x1b[32m  Tu Changa — Cloudflare Quick Tunnel (copiá mientras esta ventana siga abierta)\x1b[0m');
  console.log(`\x1b[32m${line}\x1b[0m\n`);
  console.log('\x1b[36mApp → Enter URL manually → Connect\x1b[0m\n');
  console.log(`   ${devUrl}\n`);
  console.log('\x1b[90mCtrl+C cierra Expo y cloudflared.\x1b[0m\n');

  const shutdown = () => {
    try {
      cf.kill('SIGTERM');
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
      cf.kill('SIGTERM');
    } catch {
      /* */
    }
    process.exit(code ?? 0);
  });

  cf.on('exit', () => {
    console.log('\n[start-devclient-cloudflared] cloudflared terminó.');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
