import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { professionalDisplayNameForClient } from './professionalDisplayName';

const ROOT = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** Nombre que pinta la tarjeta de búsqueda: el apellido no entra al texto. */
function searchCardNameForClient(nombre: string, apellido: string): string {
  void apellido;
  return professionalDisplayNameForClient(nombre);
}

describe('professionalDisplayNameForClient', () => {
  it('muestra solo el nombre y descarta la inicial colgada', () => {
    expect(professionalDisplayNameForClient('Horacio')).toBe('Horacio');
    expect(professionalDisplayNameForClient('Horacio T.')).toBe('Horacio');
    expect(professionalDisplayNameForClient('Horacio T')).toBe('Horacio');
    expect(professionalDisplayNameForClient('  Ana María  ')).toBe('Ana María');
    expect(professionalDisplayNameForClient('Ana María Á.')).toBe('Ana María');
    expect(professionalDisplayNameForClient('María G.')).toBe('María');
    expect(professionalDisplayNameForClient('')).toBe('Profesional');
    expect(professionalDisplayNameForClient(null)).toBe('Profesional');
    expect(professionalDisplayNameForClient('   ')).toBe('Profesional');
  });

  it('la tarjeta de búsqueda no incluye el apellido ni una inicial', () => {
    const cases = [
      { nombre: 'Horacio', apellido: 'Torres' },
      { nombre: 'Horacio T.', apellido: 'Torres' },
      { nombre: 'Horacio', apellido: 'T' },
      { nombre: 'Ana María', apellido: 'Álvarez' },
      { nombre: 'Ana María Á.', apellido: 'Álvarez' },
    ];
    for (const row of cases) {
      const shown = searchCardNameForClient(row.nombre, row.apellido);
      expect(shown).not.toContain(row.apellido);
      expect(shown).not.toMatch(/\s[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]\.$/u);
      expect(shown).not.toMatch(/\s[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]$/u);
    }
    expect(searchCardNameForClient('Horacio', 'Torres')).toBe('Horacio');
    expect(searchCardNameForClient('Horacio T.', 'T')).toBe('Horacio');
  });
});

const CLIENT_NAME_SURFACES = [
  'src/screens/search/SearchWorkerScreen.tsx',
  'src/screens/account/FavoritesScreen.tsx',
  'src/screens/home/WorkerProfileScreen.tsx',
  'src/screens/home/WorkerReviewsScreen.tsx',
  'src/screens/home/PublishPostScreen.tsx',
  'src/screens/home/HomeScreen.tsx',
  'src/screens/chat/ChatScreen.tsx',
  'src/screens/chat/ConversationsListScreen.tsx',
  'src/screens/jobs/ContractedWorkOrdersScreen.tsx',
  'src/components/search/WorkerResultCard.tsx',
  'src/components/feed/ChangaImagePost.tsx',
  'src/components/feed/ChangaPostListRow.tsx',
  'src/services/searchWorkersSupabase.ts',
  'src/services/favoritesSupabase.ts',
  'src/services/workerProfileSupabase.ts',
  'src/services/supabasePosts.ts',
  'src/services/chatSupabase.ts',
  'src/services/notificationRouting.ts',
  'src/services/messaging.ts',
  'src/navigation/openPagoCheckout.ts',
];

const MUST_CALL_HELPER = CLIENT_NAME_SURFACES.filter((rel) => rel !== 'src/screens/home/HomeScreen.tsx');

const FORBIDDEN_IN_CLIENT_VIEWS: RegExp[] = [
  /publicWorkerLabel\s*\(/,
  /lastNameInitial\s*\(/,
  /apellido\s*\[\s*0\s*\]/,
  /apellido\?\.\[0\]/,
  /apellido\??\.\s*charAt\s*\(\s*0\s*\)/,
  /\$\{[^}\n]*\bapellido\b/,
  /\$\{[^}\n]+\}\s+\$\{[^}\n]+\}\./,
];

function walkTs(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = resolve(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkTs(abs, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(abs);
  }
}

describe('vistas de cliente sin apellido ni inicial', () => {
  it('las pantallas que muestran al profesional pasan por el helper', () => {
    for (const rel of MUST_CALL_HELPER) {
      expect(read(rel), rel).toContain('professionalDisplayNameForClient');
    }
  });

  it('un cambio futuro no puede volver a armar «Nombre I.» en las pantallas del cliente', () => {
    const skip = new Set([
      // El profesional sigue armando el nombre del cliente con apellido y se queda con el primer token.
      resolve(ROOT, 'src/services/chatSupabase.ts'),
      resolve(ROOT, 'src/services/notificationRouting.ts'),
      resolve(ROOT, 'src/navigation/openPagoCheckout.ts'),
    ]);
    const files = CLIENT_NAME_SURFACES.map((rel) => resolve(ROOT, rel)).filter((abs) => !skip.has(abs));
    for (const dir of [
      'src/screens/search',
      'src/screens/home',
      'src/screens/chat',
      'src/screens/jobs',
      'src/screens/client',
      'src/screens/pagos',
      'src/screens/materials',
      'src/screens/servicios',
      'src/components/search',
      'src/components/feed',
      'src/components/chat',
    ]) {
      walkTs(resolve(ROOT, dir), files);
    }
    const unique = Array.from(new Set(files));
    const hits: string[] = [];
    for (const abs of unique) {
      const src = readFileSync(abs, 'utf8');
      for (const re of FORBIDDEN_IN_CLIENT_VIEWS) {
        if (re.test(src)) hits.push(`${abs.replace(`${ROOT}/`, '')} :: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('el cliente no selecciona el apellido del profesional', () => {
    const search = read('src/services/searchWorkersSupabase.ts');
    expect(search).not.toMatch(/apellido/);
    expect(search).not.toMatch(/lastInitial/);

    const favorites = read('src/services/favoritesSupabase.ts');
    expect(favorites).not.toMatch(/apellido/);

    const profile = read('src/services/workerProfileSupabase.ts');
    expect(profile).not.toMatch(/select\(\s*'[^']*apellido/);
    expect(profile).toContain(
      "'id,nombre,avatar_url,professional_description,rating_average,review_count,total_jobs_done'",
    );

    const posts = read('src/services/supabasePosts.ts');
    expect(posts).not.toMatch(/profiles\([^)]*apellido/);

    // #120: ya nadie lee profiles.apellido directo. El profesional recibe el apellido
    // de su cliente por get_peer_display_name; el cliente solo pide el nombre.
    const chat = read('src/services/chatSupabase.ts');
    expect(chat).toContain(".select('nombre,avatar_url')");
    expect(chat).toContain(".select('nombre')");
    expect(chat).not.toMatch(/select\([^)]*apellido/);

    const pushRoute = read('src/services/notificationRouting.ts');
    expect(pushRoute).toContain(".select('nombre')");
    expect(pushRoute).not.toMatch(/select\([^)]*apellido/);
    expect(pushRoute).toContain("myRole === 'cliente' ? null : await fetchPeerFullName(otherId)");

    const pago = read('src/navigation/openPagoCheckout.ts');
    expect(pago).toContain(".select('nombre')");
    expect(pago).not.toMatch(/select\([^)]*apellido/);
    expect(pago).toContain("myRole === 'cliente' ? null : await fetchPeerFullName(otherId)");

    const pushFn = read('supabase/functions/push_on_message/index.ts');
    expect(pushFn).toContain('notifyingClient ? "nombre" : "nombre,apellido"');
    expect(pushFn).toContain('givenNameForClient');
    const given = pushFn.slice(
      pushFn.indexOf('function givenNameForClient'),
      pushFn.indexOf('function json'),
    );
    expect(given).not.toMatch(/apellido/);
  });

  it('el SQL devuelve apellido NULL y no busca por apellido', () => {
    const sql = read('supabase/20261002_card_117_hide_worker_surname.sql');
    expect(sql.match(/NULL::text AS apellido/g)).toHaveLength(2);
    expect(sql).not.toMatch(/apellido_full\s+ILIKE/i);
    expect(sql).not.toMatch(/b\.apellido\b/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/STABLE SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.search_workers_for_client');
    // list_favorites sale del cuerpo de producción (con calificación) y no toca grants.
    expect(sql).toContain('rating_average numeric, review_count integer, total_jobs_done integer');
    expect(sql).not.toMatch(/^\s*(grant|revoke)\b[^;]*list_favorites/im);
  });
});
