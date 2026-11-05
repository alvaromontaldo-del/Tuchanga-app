import type { SupabaseClient } from '@supabase/supabase-js';

export const MATRICULA_BUCKET = 'matriculas';
export const MATRICULA_SIGNED_URL_TTL_SEC = 600;

export type MatriculaOficioCodigo = 'gas' | 'electricidad' | 'plomeria' | 'fumigacion' | 'sin_vincular';

export type MatriculaRevisionFoto = {
  id: string;
  status: 'pendiente' | 'aprobada' | 'rechazada';
  motivo: string | null;
  storagePath: string;
  signedUrl: string | null;
};

export type MatriculaRevisionItem = {
  userId: string;
  nombre: string;
  apellido: string;
  oficioCodigo: MatriculaOficioCodigo;
  oficio: string;
  vinculo: 'oficio' | 'sin_evidencia';
  numero: string;
  entidad: string;
  status: string;
  fotos: MatriculaRevisionFoto[];
  updatedAt: string;
};

function asOficio(value: unknown): MatriculaOficioCodigo | null {
  if (
    value === 'gas' ||
    value === 'electricidad' ||
    value === 'plomeria' ||
    value === 'fumigacion' ||
    value === 'sin_vincular'
  ) {
    return value;
  }
  return null;
}

export async function listMatriculasRevision(supabase: SupabaseClient): Promise<MatriculaRevisionItem[]> {
  const { data, error } = await supabase.rpc('admin_list_matriculas_revision');
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  const items: MatriculaRevisionItem[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const oficioCodigo = asOficio(row.oficio_codigo);
    const userId = typeof row.user_id === 'string' ? row.user_id : '';
    if (!oficioCodigo || !userId) continue;
    const fotosRaw = Array.isArray(row.fotos) ? row.fotos : [];
    const fotos: MatriculaRevisionFoto[] = [];
    for (const fotoRaw of fotosRaw) {
      if (!fotoRaw || typeof fotoRaw !== 'object') continue;
      const foto = fotoRaw as Record<string, unknown>;
      const id = typeof foto.id === 'string' ? foto.id : '';
      const storagePath = typeof foto.storage_path === 'string' ? foto.storage_path : '';
      const status = foto.status;
      if (!id || !storagePath) continue;
      if (status !== 'pendiente' && status !== 'aprobada' && status !== 'rechazada') continue;
      const { data: signed } = await supabase.storage
        .from(MATRICULA_BUCKET)
        .createSignedUrl(storagePath, MATRICULA_SIGNED_URL_TTL_SEC);
      fotos.push({
        id,
        status,
        motivo: typeof foto.motivo === 'string' ? foto.motivo : null,
        storagePath,
        signedUrl: signed?.signedUrl ?? null,
      });
    }
    items.push({
      userId,
      nombre: typeof row.nombre === 'string' ? row.nombre : '',
      apellido: typeof row.apellido === 'string' ? row.apellido : '',
      oficioCodigo,
      oficio: typeof row.oficio === 'string' ? row.oficio : oficioCodigo,
      vinculo: row.vinculo === 'sin_evidencia' ? 'sin_evidencia' : 'oficio',
      numero: typeof row.numero === 'string' ? row.numero : '',
      entidad: typeof row.entidad === 'string' ? row.entidad : '',
      status: typeof row.status === 'string' ? row.status : '',
      fotos,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    });
  }
  return items;
}

export async function aprobarMatriculaFoto(supabase: SupabaseClient, fotoId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_aprobar_matricula_foto', { p_foto_id: fotoId });
  if (error) throw new Error(error.message);
}

export async function rechazarMatriculaFoto(
  supabase: SupabaseClient,
  fotoId: string,
  motivo: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_rechazar_matricula_foto', {
    p_foto_id: fotoId,
    p_motivo: motivo,
  });
  if (error) throw new Error(error.message);
}

export async function aprobarMatriculaOficio(
  supabase: SupabaseClient,
  userId: string,
  oficio: MatriculaOficioCodigo,
): Promise<void> {
  const { error } = await supabase.rpc('admin_aprobar_matricula_oficio', {
    p_user_id: userId,
    p_oficio: oficio,
  });
  if (error) throw new Error(error.message);
}

export async function rechazarMatriculaOficio(
  supabase: SupabaseClient,
  userId: string,
  oficio: MatriculaOficioCodigo,
  motivo: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_rechazar_matricula_oficio', {
    p_user_id: userId,
    p_oficio: oficio,
    p_motivo: motivo,
  });
  if (error) throw new Error(error.message);
}
