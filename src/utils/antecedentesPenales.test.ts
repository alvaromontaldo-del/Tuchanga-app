import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANTECEDENTES_GOB_URL,
  ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX,
  ANTECEDENTES_IMAGE_MAX_EDGE_PX,
  ANTECEDENTES_JPEG_QUALITIES,
  ANTECEDENTES_PDF_MAX_BYTES,
  antecedentesImageResize,
  antecedentesObjectName,
  antecedentesPdfRejected,
  antecedentesUploadErrorMessage,
  approvedAntecedentesIds,
  parseMyAntecedentes,
} from './antecedentesPenales';

const ROOT = resolve(__dirname, '../..');

describe('antecedentes penales', () => {
  it('rechaza un PDF vacío o mayor a 2 MB', () => {
    expect(antecedentesPdfRejected(0)).toMatch(/vacío/);
    expect(antecedentesPdfRejected(ANTECEDENTES_PDF_MAX_BYTES + 1)).toMatch(/2 MB/);
    expect(antecedentesPdfRejected(ANTECEDENTES_PDF_MAX_BYTES)).toBeNull();
    expect(antecedentesPdfRejected(1200)).toBeNull();
  });

  it('achica solo el lado largo y no estira una foto chica', () => {
    expect(antecedentesImageResize(4000, 3000)).toEqual({
      width: ANTECEDENTES_IMAGE_MAX_EDGE_PX,
    });
    expect(antecedentesImageResize(1200, 4000)).toEqual({
      height: ANTECEDENTES_IMAGE_MAX_EDGE_PX,
    });
    expect(antecedentesImageResize(800, 600)).toBeNull();
    expect(antecedentesImageResize(0, 400)).toBeNull();
    expect(antecedentesImageResize(4000, 3000, ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX)).toEqual({
      width: ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX,
    });
  });

  it('el piso de calidad deja el texto legible', () => {
    expect(ANTECEDENTES_JPEG_QUALITIES[ANTECEDENTES_JPEG_QUALITIES.length - 1]).toBeGreaterThanOrEqual(
      0.34,
    );
    expect(ANTECEDENTES_JPEG_QUALITIES[0]).toBeGreaterThan(ANTECEDENTES_JPEG_QUALITIES[1]);
  });

  it('el nombre del archivo solo puede ser jpg o pdf', () => {
    const name = antecedentesObjectName('jpg', 1730000000000);
    expect(name).toMatch(/^1730000000000-[a-z0-9]{8}\.jpg$/);
    expect(antecedentesObjectName('pdf', 1730000000000)).toMatch(/\.pdf$/);
  });

  it('lee el estado propio y no inventa un aprobado', () => {
    expect(parseMyAntecedentes(null)).toBeNull();
    expect(parseMyAntecedentes({ status: 'otro' })).toBeNull();
    expect(
      parseMyAntecedentes({
        status: 'rechazado',
        asunto: '  La foto está cortada  ',
        mime_type: 'image/jpeg',
        updated_at: '2026-10-09T12:00:00Z',
      }),
    ).toEqual({
      status: 'rechazado',
      asunto: 'La foto está cortada',
      mimeType: 'image/jpeg',
      updatedAt: '2026-10-09T12:00:00Z',
    });
  });

  it('traduce la falta del módulo nativo de PDF y un RPC todavía no aplicado', () => {
    expect(antecedentesUploadErrorMessage(new Error('Cannot find native module ExponentDocumentPicker'))).toMatch(
      /foto/,
    );
    expect(antecedentesUploadErrorMessage(new Error('Could not find the function public.submit_my_antecedentes_penales'))).toMatch(
      /no está habilitada/,
    );
  });

  it('el tilde de búsqueda solo usa ids, nada del archivo', () => {
    expect(approvedAntecedentesIds(['abc', '', null, 12])).toEqual(new Set(['abc', '12']));
    expect(approvedAntecedentesIds({ path: 'secreto.pdf' }).size).toBe(0);
  });

  it('el SQL deja el certificado privado y el perfil público solo con el tilde', () => {
    const sql = readFileSync(resolve(ROOT, 'supabase/20261009_card_110_antecedentes_penales.sql'), 'utf8');
    expect(sql).toContain("'antecedentes-penales'");
    expect(sql).toMatch(/public\s*=\s*false/i);
    expect(sql).toContain('2097152');
    expect(sql).toContain('public.is_admin()');
    expect(sql).toContain('public._admin_require()');
    expect(sql).toContain('edge_function_secret');
    expect(sql).toContain('push_on_antecedentes');
    expect(sql).toContain("'pendiente', 'aprobado', 'rechazado'");
    expect(sql).toContain("'antecedentes_penales', EXISTS");
    const publicFn = sql.slice(
      sql.indexOf('FUNCTION public.get_public_worker_profile'),
      sql.indexOf('COMMENT ON FUNCTION public.get_public_worker_profile'),
    );
    expect(publicFn).toContain('split_part');
    expect(publicFn).not.toMatch(/apellido/);
    expect(sql).toContain('p.apellido');
    expect(sql).toContain('REVOKE ALL ON TABLE public.antecedentes_penales FROM PUBLIC, anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_list_antecedentes_pendientes() FROM PUBLIC, anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.submit_my_antecedentes_penales(text, text) FROM PUBLIC, anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.list_public_antecedentes_aprobados(uuid[]) TO anon');
    expect(sql).toContain("UNION ALL\n    SELECT 'antecedentes-penales'");
    expect(sql).not.toMatch(/getPublicUrl/);

    const card = readFileSync(
      resolve(ROOT, 'src/components/profile/AntecedentesPenalesCard.tsx'),
      'utf8',
    );
    expect(ANTECEDENTES_GOB_URL).toBe(
      'https://www.argentina.gob.ar/justicia/reincidencia/antecedentespenales',
    );
    expect(card).toContain('{ANTECEDENTES_GOB_URL}');
    expect(card).toContain('más trabajos');
    expect(card).toContain('Antecedentes penales');

    const profile = readFileSync(resolve(ROOT, 'src/screens/home/WorkerProfileScreen.tsx'), 'utf8');
    expect(profile).toContain('AntecedentesPenalesBadge');
    expect(profile).not.toMatch(/apellido/);

    const search = readFileSync(resolve(ROOT, 'src/services/searchWorkersSupabase.ts'), 'utf8');
    expect(search).toContain('list_public_antecedentes_aprobados');
    expect(search).not.toMatch(/apellido/);
  });
});
