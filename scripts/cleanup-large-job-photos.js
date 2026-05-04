/* eslint-disable no-console */
// Script de una sola corrida para limpiar imágenes pesadas del bucket `job-photos`
// y remover referencias en DB (posts.image_urls y jobs.photo_urls).
//
// Uso:
//   node scripts/cleanup-large-job-photos.js            # dry-run (no borra)
//   node scripts/cleanup-large-job-photos.js --apply    # borra y limpia DB
//
// Requiere variables de entorno:
//   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=xxxx
//
// Nota: NO uses ANON_KEY para esto (no tiene permisos).

const { createClient } = require('@supabase/supabase-js');
const dns = require('dns');
const net = require('net');
const { Agent, fetch: undiciFetch, buildConnector } = require('undici');
const { URL } = require('url');

const BUCKET = 'job-photos';
const MAX_BYTES = 500 * 1024;
const APPLY = process.argv.includes('--apply');

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Falta variable de entorno ${name}`);
  return String(v).trim();
}

function optionalEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  const kb = x / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function matchesStoragePath(url, path) {
  if (!url || !path) return false;
  const u = String(url);
  const p = String(path);
  // getPublicUrl: .../storage/v1/object/public/job-photos/<path>
  return u.includes(`/storage/v1/object/public/${BUCKET}/${p}`) || u.endsWith(`/${p}`);
}

async function listAllRecursively(storage, prefix = '') {
  const results = [];
  let offset = 0;
  // Varios despliegues de Storage rechazan limit > 100 con 400.
  const limit = 100;

  while (true) {
    const { data, error } = await storage.from(BUCKET).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const items = Array.isArray(data) ? data : [];
    if (!items.length) break;

    for (const item of items) {
      const name = item?.name;
      if (!name) continue;
      const path = prefix ? `${prefix}/${name}` : name;

      // En Supabase Storage, los "folders" suelen venir sin metadata/id.
      const isFolder = !item?.id && !item?.metadata;
      if (isFolder) {
        const nested = await listAllRecursively(storage, path);
        results.push(...nested);
        continue;
      }

      const size = Number(item?.metadata?.size) || 0;
      results.push({ path, size });
    }

    if (items.length < limit) break;
    offset += items.length;
  }

  return results;
}

async function cleanArrayColumn(sb, table, idCol, id, colName, nextArray) {
  const patch = {};
  patch[colName] = nextArray;
  const { error } = await sb.from(table).update(patch).eq(idCol, id);
  if (error) throw error;
}

async function main() {
  const url = mustEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const serviceRole = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
  const hostIpOverride = optionalEnv('SUPABASE_HOST_IP');
  const supabaseHost = new URL(url).host;

  // Windows: a veces el resolver del sistema falla; resolvemos vía Cloudflare DNS (IPv4).
  // IMPORTANTE: no pasar `lookup` dentro del objeto que undici fusiona con `buildConnector`:
  // termina en opciones de `tls.connect` y puede romper el handshake (respuestas 400 del borde).
  const resolver = new dns.promises.Resolver();
  resolver.setServers(['1.1.1.1', '1.0.0.1']);

  const tlsConnector = buildConnector({
    rejectUnauthorized: true,
    timeout: 30e3,
  });

  async function resolveToIPv4(hostname) {
    if (net.isIP(hostname)) return hostname;
    if (hostIpOverride && hostname === supabaseHost) return hostIpOverride;
    const addrs = await resolver.resolve4(hostname);
    if (!addrs?.length) throw new Error(`dns_no_a_record:${hostname}`);
    return addrs[0];
  }

  const agent = new Agent({
    connect(opts, callback) {
      if (opts.protocol !== 'https:') {
        tlsConnector(opts, callback);
        return;
      }
      const sni =
        opts.servername && String(opts.servername).trim().length > 0
          ? opts.servername
          : opts.hostname;
      resolveToIPv4(opts.hostname)
        .then((ip) => {
          tlsConnector({ ...opts, hostname: ip, servername: sni }, callback);
        })
        .catch(callback);
    },
  });
  const fetchWithCustomDns = (input, init = {}) =>
    undiciFetch(input, { ...init, dispatcher: agent });

  const sb = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'cleanup-large-job-photos' }, fetch: fetchWithCustomDns },
  });

  console.log(`Bucket: ${BUCKET}`);
  console.log(`Threshold: > ${formatBytes(MAX_BYTES)} (${MAX_BYTES} bytes)`);
  console.log(`Modo: ${APPLY ? 'APPLY (borra)' : 'DRY-RUN (solo informe)'}`);
  console.log('');

  console.log('Listando objetos del bucket (puede tardar)…');
  let all;
  try {
    all = await listAllRecursively(sb.storage, '');
  } catch (e) {
    console.error('ERROR: list falló.');
    console.error('Detalle:', e);
    if (e?.cause) console.error('Cause:', e.cause);
    console.error('');
    console.error(
      `Tip: si tu PC no resuelve ${supabaseHost}, probá setear SUPABASE_HOST_IP con una IP de nslookup.`,
    );
    console.error(
      `Ejemplo: $env:SUPABASE_HOST_IP="104.18.38.10" (solo para ejecutar este script).`,
    );
    throw e;
  }
  const heavy = all.filter((x) => x.size > MAX_BYTES);
  const totalBytes = heavy.reduce((acc, x) => acc + (Number(x.size) || 0), 0);

  console.log(`Encontrados: ${heavy.length} archivos > 500KB`);
  console.log(`Espacio a liberar: ${formatBytes(totalBytes)} (${totalBytes} bytes)`);
  if (heavy.length) {
    console.log('Ejemplos (hasta 10):');
    for (const x of heavy.slice(0, 10)) console.log(`- ${x.path} (${formatBytes(x.size)})`);
  }
  console.log('');

  if (!APPLY) {
    console.log('DRY-RUN: no se borró nada. Ejecutá con --apply para aplicar cambios.');
    return;
  }

  // 1) Borrar en Storage
  console.log('Borrando archivos en Storage…');
  const paths = heavy.map((x) => x.path);
  let deletedOk = 0;
  let deletedErr = 0;
  for (const batch of chunk(paths, 100)) {
    const { error } = await sb.storage.from(BUCKET).remove(batch);
    if (error) {
      deletedErr += batch.length;
      console.warn(`WARN: error al borrar batch (${batch.length}): ${error.message}`);
      continue;
    }
    deletedOk += batch.length;
  }
  console.log(`Storage: borrados OK=${deletedOk}, con error=${deletedErr}`);
  console.log('');

  // 2) Limpiar referencias en DB
  console.log('Limpiando referencias en DB…');

  const removedPaths = new Set(paths);
  const shouldRemoveUrl = (u) => {
    if (!u) return false;
    for (const p of removedPaths) {
      if (matchesStoragePath(u, p)) return true;
    }
    return false;
  };

  async function cleanTableArray(table, idCol, colName) {
    let updated = 0;
    let scanned = 0;
    let page = 0;
    const pageSize = 500;
    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await sb
        .from(table)
        .select(`${idCol},${colName}`)
        .range(from, to);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) break;
      scanned += rows.length;

      for (const r of rows) {
        const id = r[idCol];
        const arr = Array.isArray(r[colName]) ? r[colName] : [];
        if (!arr.length) continue;
        const next = arr.filter((u) => !shouldRemoveUrl(u));
        if (next.length === arr.length) continue;
        try {
          await cleanArrayColumn(sb, table, idCol, id, colName, next);
          updated += 1;
        } catch (e) {
          console.warn(`WARN: no pude actualizar ${table}.${colName} id=${id}: ${e?.message ?? e}`);
        }
      }

      if (rows.length < pageSize) break;
      page += 1;
    }
    console.log(`${table}: filas escaneadas=${scanned}, filas actualizadas=${updated}`);
  }

  await cleanTableArray('posts', 'id', 'image_urls');
  await cleanTableArray('jobs', 'id', 'photo_urls');

  console.log('');
  console.log('Listo.');
}

main().catch((e) => {
  console.error('ERROR:', e?.message ?? e);
  process.exitCode = 1;
});

