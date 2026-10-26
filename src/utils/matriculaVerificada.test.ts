import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionRoleForSignup } from '../constants/sessionRoles';
import {
  ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX,
  ANTECEDENTES_IMAGE_MAX_EDGE_PX,
  ANTECEDENTES_IMAGE_TARGET_BYTES,
  ANTECEDENTES_JPEG_QUALITIES,
} from './antecedentesPenales';
import {
  MATRICULA_IMAGE_FALLBACK_EDGE_PX,
  MATRICULA_IMAGE_MAX_EDGE_PX,
  MATRICULA_IMAGE_TARGET_BYTES,
  MATRICULA_JPEG_QUALITIES,
  MATRICULA_MAX_PHOTOS,
  matriculaDraftProblem,
  matriculaImageResize,
  matriculaObjectName,
  matriculaUploadErrorMessage,
  parseMyMatricula,
  previousMatriculaPaths,
  MATRICULA_SAVE_FIRST,
  matriculaCardMode,
  profileOffersMatricula,
  tradeRequiresMatricula,
} from './matriculaVerificada';

const ROOT = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

describe('matrícula verificada', () => {
  it('solo aparece en gasista, electricista, plomería y fumigación', () => {
    expect(tradeRequiresMatricula({ rubroSlug: 'gasista', name: 'Gas' })).toBe(true);
    expect(tradeRequiresMatricula({ name: 'Gasista' })).toBe(true);
    expect(tradeRequiresMatricula({ rubroSlug: 'electricidad', name: 'Electricidad' })).toBe(true);
    expect(tradeRequiresMatricula({ name: 'Electricista' })).toBe(true);
    expect(tradeRequiresMatricula({ name: 'Plomería' })).toBe(true);
    expect(tradeRequiresMatricula({ rubroSlug: 'plomeria' })).toBe(true);
    expect(tradeRequiresMatricula({ name: 'Control de plagas y fumigación' })).toBe(true);
    expect(tradeRequiresMatricula({ name: 'Fumigación' })).toBe(true);
    expect(tradeRequiresMatricula({ rubroSlug: 'control-plagas-fumigacion' })).toBe(true);
    expect(tradeRequiresMatricula({ name: 'Aire acondicionado y climatización' })).toBe(false);
    expect(tradeRequiresMatricula({ name: 'Albañilería', rubroSlug: 'albanileria' })).toBe(false);
    expect(tradeRequiresMatricula({ name: 'Domótica y hogar inteligente' })).toBe(false);
    expect(tradeRequiresMatricula({ name: 'Mantenimiento de electrodomésticos' })).toBe(false);
    expect(
      profileOffersMatricula([
        { name: 'Pintura (obras)', rubroSlug: 'pintura-obras' },
        { name: 'Gas', rubroSlug: 'gasista' },
      ]),
    ).toBe(true);
    expect(profileOffersMatricula([{ name: 'Carpintería', rubroSlug: 'carpinteria' }])).toBe(false);
  });

  it('la tarjeta sigue a los oficios guardados, no al formulario sin guardar', () => {
    expect(
      matriculaCardMode(
        [{ name: 'Gas', rubroSlug: 'gasista' }],
        [{ name: 'Gas', rubroSlug: 'gasista' }],
      ),
    ).toBe('ready');
    expect(
      matriculaCardMode(
        [{ name: 'Electricidad', rubroSlug: 'electricidad' }],
        [{ name: 'Carpintería', rubroSlug: 'carpinteria' }],
      ),
    ).toBe('ready');
    expect(
      matriculaCardMode([{ name: 'Control de plagas y fumigación', rubroSlug: 'control-plagas-fumigacion' }], []),
    ).toBe('ready');
    expect(
      matriculaCardMode(
        [{ name: 'Carpintería', rubroSlug: 'carpinteria' }],
        [{ name: 'Gas', rubroSlug: 'gasista' }],
      ),
    ).toBe('save-first');
    expect(
      matriculaCardMode([], [{ name: 'Fumigación', rubroSlug: 'control-plagas-fumigacion' }]),
    ).toBe('save-first');
    expect(
      matriculaCardMode(
        [{ name: 'Albañilería', rubroSlug: 'albanileria' }],
        [{ name: 'Pintura (obras)', rubroSlug: 'pintura-obras' }],
      ),
    ).toBe('hidden');
    expect(MATRICULA_SAVE_FIRST).toBe('Guardá tus datos profesionales para cargar la matrícula');
  });

  it('pide número, entidad y entre 1 y 3 fotos', () => {
    expect(matriculaDraftProblem({ numero: '  ', entidad: 'ENARGAS', photos: 1 })).toMatch(/número/);
    expect(matriculaDraftProblem({ numero: '12345', entidad: 'E', photos: 1 })).toMatch(/entidad/);
    expect(matriculaDraftProblem({ numero: '12345', entidad: 'ENARGAS', photos: 0 })).toMatch(/foto/);
    expect(matriculaDraftProblem({ numero: '12345', entidad: 'ENARGAS', photos: 4 })).toMatch(/3/);
    expect(matriculaDraftProblem({ numero: 'MG-1234', entidad: 'Gobierno de la Ciudad', photos: 3 })).toBeNull();
    expect(MATRICULA_MAX_PHOTOS).toBe(3);
  });

  it('comprime como el resto: lado largo 1600 y JPEG cerca de 350 KB', () => {
    expect(MATRICULA_IMAGE_MAX_EDGE_PX).toBe(1600);
    expect(MATRICULA_IMAGE_MAX_EDGE_PX).toBe(ANTECEDENTES_IMAGE_MAX_EDGE_PX);
    expect(MATRICULA_IMAGE_FALLBACK_EDGE_PX).toBe(ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX);
    expect(MATRICULA_IMAGE_TARGET_BYTES).toBe(350 * 1024);
    expect(MATRICULA_IMAGE_TARGET_BYTES).toBe(ANTECEDENTES_IMAGE_TARGET_BYTES);
    expect(MATRICULA_JPEG_QUALITIES).toEqual(ANTECEDENTES_JPEG_QUALITIES);
    expect(MATRICULA_JPEG_QUALITIES[MATRICULA_JPEG_QUALITIES.length - 1]).toBeGreaterThanOrEqual(0.34);
    expect(matriculaImageResize(4000, 3000)).toEqual({ width: MATRICULA_IMAGE_MAX_EDGE_PX });
    expect(matriculaImageResize(900, 1600)).toBeNull();
    expect(matriculaImageResize(4000, 2000, MATRICULA_IMAGE_FALLBACK_EDGE_PX)).toEqual({
      width: MATRICULA_IMAGE_FALLBACK_EDGE_PX,
    });
  });

  it('el archivo solo puede ser jpg dentro de la carpeta del profesional', () => {
    expect(matriculaObjectName(1730000000000)).toMatch(/^1730000000000-[a-z0-9]{8}\.jpg$/);
  });

  it('lee el estado propio y no inventa una aprobada', () => {
    expect(parseMyMatricula(null)).toBeNull();
    expect(parseMyMatricula({ status: 'aprobado' })).toBeNull();
    expect(
      parseMyMatricula({
        status: 'rechazada',
        numero: ' 12345 ',
        entidad: ' ENARGAS ',
        motivo: '  La foto está cortada  ',
        fotos: 2,
        updated_at: '2026-10-15T12:00:00Z',
        storage_paths: ['secreto/foto.jpg'],
      }),
    ).toEqual({
      status: 'rechazada',
      numero: '12345',
      entidad: 'ENARGAS',
      motivo: 'La foto está cortada',
      fotos: 2,
      updatedAt: '2026-10-15T12:00:00Z',
    });
    expect(previousMatriculaPaths({ previous_paths: ['a.jpg', '', 'a.jpg', 'b.jpg'] })).toEqual([
      'a.jpg',
      'b.jpg',
    ]);
  });

  it('avisa si la RPC todavía no está aplicada', () => {
    expect(matriculaUploadErrorMessage(new Error('Could not find the function public.submit_my_matricula'))).toMatch(
      /no está habilitada/,
    );
    expect(
      matriculaUploadErrorMessage(
        new Error('La matrícula es para gasista, electricista, plomería o fumigación.'),
      ),
    ).toBe('La matrícula es para gasista, electricista, plomería o fumigación.');
  });

  it('el SQL deja las fotos privadas y el perfil público solo con la insignia', () => {
    const sql = read('supabase/20261015_card_77_matricula.sql');
    expect(sql).toContain("'matriculas'");
    expect(sql).toMatch(/public\s*=\s*false/i);
    expect(sql).toContain('2097152');
    expect(sql).toContain('public.is_admin()');
    expect(sql).toContain('public._admin_require()');
    expect(sql).toContain('edge_function_secret');
    expect(sql).toContain('push_on_matricula');
    expect(sql).toContain('invoke_vault_edge_webhook');
    expect(sql).toContain("'pendiente', 'aprobada', 'rechazada'");
    expect(sql).toContain("'matricula_verificada', EXISTS");
    expect(sql).toContain('84471d7792642ded9e45e7cca0f85a47');
    expect(sql).toContain('ad0c067dc0deb73ccd0c6c98b74fa7d5');
    expect(sql).toContain('admin_list_matriculas_pendientes');
    expect(sql).toContain('admin_aprobar_matricula');
    expect(sql).toContain('admin_rechazar_matricula');
    expect(sql).toContain('NULL::text AS apellido');
    expect(sql).toContain('previous_paths');
    expect(sql).not.toMatch(/DELETE FROM storage\.objects/);
    expect(sql).not.toMatch(/getPublicUrl/);
    expect(sql).not.toMatch(/eyJ/);
    expect(sql).not.toMatch(/CREATE EXTENSION/i);

    const publicFn = sql.slice(
      sql.indexOf('FUNCTION public.get_public_worker_profile'),
      sql.indexOf('COMMENT ON FUNCTION public.get_public_worker_profile'),
    );
    expect(publicFn).toContain('split_part');
    expect(publicFn).not.toMatch(/apellido/);
    expect(publicFn).not.toMatch(/storage_paths/);
    expect(publicFn).not.toMatch(/\bnumero\b/);

    const searchFn = sql.slice(
      sql.indexOf('FUNCTION public.search_workers_for_client'),
      sql.indexOf('COMMENT ON FUNCTION public.search_workers_for_client'),
    );
    expect(searchFn).toContain('matricula_verificada boolean');
    expect(searchFn).toContain('NULL::text AS apellido');
    expect(searchFn).not.toMatch(/apellido_full\s+ILIKE/i);
    expect(searchFn).not.toMatch(/storage_paths/);

    expect(sql).toContain('REVOKE ALL ON TABLE public.matriculas FROM PUBLIC, anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_list_matriculas_pendientes() FROM PUBLIC, anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_aprobar_matricula(uuid) FROM PUBLIC, anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_rechazar_matricula(uuid, text) FROM PUBLIC, anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.submit_my_matricula(text, text, text[]) FROM PUBLIC, anon');
    expect(sql).not.toMatch(/admin_list_matriculas_pendientes\(\) TO anon/);
    expect(sql).not.toMatch(/admin_aprobar_matricula\(uuid\) TO anon/);
    expect(sql).not.toMatch(/admin_rechazar_matricula\(uuid, text\) TO anon/);
    expect(sql).toContain("UNION ALL\n    SELECT 'matriculas'");

    const upload = read('src/services/matriculaVerificadaSupabase.ts');
    expect(upload).toContain('.remove(names)');
    expect(upload).toContain('no se pudo borrar la foto anterior');

    const card = read('src/components/profile/MatriculaCard.tsx');
    expect(card).toContain('Matrícula verificada');
    expect(card).toContain('Opcional');
    expect(card).toContain('Enviar a revisión');

    const badge = read('src/components/profile/MatriculaVerificadaBadge.tsx');
    expect(badge).toContain('Matrícula verificada');

    const profile = read('src/screens/home/WorkerProfileScreen.tsx');
    expect(profile).toContain('MatriculaVerificadaBadge');
    expect(profile).not.toMatch(/apellido/);

    const search = read('src/services/searchWorkersSupabase.ts');
    expect(search).toContain('matricula_verificada');
    expect(search).toContain('professionalDisplayNameForClient');
    expect(search).not.toMatch(/apellido/);

    const abm = read('src/screens/account/WorkerABMScreen.tsx');
    expect(abm).toContain('matriculaCardMode');
    expect(abm).toContain('MATRICULA_SAVE_FIRST');
    expect(abm).toContain('<MatriculaCard />');
    expect(abm).toContain('<AntecedentesPenalesCard />');
  });

  it('smoke: login, roles, búsqueda, perfil, chat, cotizar, materiales y antecedentes', () => {
    expect(sessionRoleForSignup('client')).toBe('client');
    expect(sessionRoleForSignup('professional')).toBe('professional');
    expect(sessionRoleForSignup('commerce')).toBe('commerce');

    const login = read('src/screens/auth/LoginScreen.tsx');
    expect(login).toContain('export function LoginScreen');
    expect(login).toContain('signIn');

    const roles = read('src/constants/sessionRoles.ts');
    expect(roles).toContain("id: 'client'");
    expect(roles).toContain("id: 'professional'");
    expect(roles).toContain("id: 'commerce'");

    const search = read('src/services/searchWorkersSupabase.ts');
    expect(search).toContain("rpc('search_workers_for_client'");
    expect(search).toContain('professionalDisplayNameForClient');
    expect(search).not.toMatch(/apellido/);

    const openProfile = read('src/screens/search/SearchWorkerScreen.tsx');
    expect(openProfile).toContain("navigation.navigate('WorkerProfile'");
    expect(openProfile).toContain('professionalDisplayNameForClient');
    expect(openProfile).toContain('matriculaVerificada');

    const profile = read('src/screens/home/WorkerProfileScreen.tsx');
    expect(profile).toContain('fetchWorkerPublicProfileFromSupabase');
    expect(profile).toContain('openOrCreateChat');
    expect(profile).toContain('professionalDisplayNameForClient');
    expect(profile).not.toMatch(/apellido/);

    const chat = read('src/services/chatSupabase.ts');
    expect(chat).toContain('export async function sendMessageSupabase');
    expect(chat).not.toMatch(/select\([^)]*apellido/);

    const quote = read('src/services/quotesSupabase.ts');
    expect(quote).toContain('export async function createQuote');

    const materials = read('src/services/materialRequestsSupabase.ts');
    expect(materials).toContain('export async function createMaterialRequestWithTargets');

    const antecedentes = read('src/components/profile/AntecedentesPenalesCard.tsx');
    expect(antecedentes).toContain('Antecedentes penales');
    expect(antecedentes).toContain('uploadMyAntecedentesPenales');

    const push = read('src/services/notificationRouting.ts');
    expect(push).toContain("data.type === 'antecedentes_penales'");
    expect(push).toContain("data.type === 'matricula_verificada'");
    expect(push).not.toMatch(/select\([^)]*apellido/);

    const edge = read('supabase/functions/push_on_matricula/index.ts');
    expect(edge).toContain('requireFunctionSecret');
    expect(edge).toContain('matricula_verificada');
    expect(edge).toContain('.select("expo_push_token")');
    expect(edge).not.toMatch(/select\([^)]*apellido/);
  });
});
