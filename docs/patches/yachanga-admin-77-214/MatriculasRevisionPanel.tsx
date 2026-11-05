import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aprobarMatriculaFoto,
  aprobarMatriculaOficio,
  listMatriculasRevision,
  rechazarMatriculaFoto,
  rechazarMatriculaOficio,
  type MatriculaRevisionItem,
} from './matriculasRevision';

type Props = {
  supabase: SupabaseClient;
};

const ink = '#1A1A1A';
const muted = '#6B6B6B';
const line = '#E7D9C6';
const paper = '#FBF7F1';

export function MatriculasRevisionPanel({ supabase }: Props) {
  const [rows, setRows] = useState<MatriculaRevisionItem[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const reload = useCallback(async () => {
    try {
      setRows(await listMatriculasRevision(supabase));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la revisión.');
    }
  }, [supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(id: string, task: () => Promise<void>) {
    setBusyId(id);
    try {
      await task();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section style={{ display: 'grid', gap: 16, color: ink }}>
      <header>
        <h1 style={{ fontSize: 22, margin: 0 }}>Aprobar matrículas</h1>
        <p style={{ color: muted, margin: '6px 0 0' }}>
          Cada tarjeta es un oficio. El legado sin vínculo no se asigna a otro.
        </p>
      </header>
      {error ? <p style={{ color: '#7A3E3E' }}>{error}</p> : null}
      {rows.length === 0 ? <p style={{ color: muted }}>No hay matrículas para revisar.</p> : null}
      {rows.map((row) => {
        const key = `${row.userId}:${row.oficioCodigo}`;
        return (
          <article
            key={key}
            style={{ background: paper, border: `1px solid ${line}`, borderRadius: 16, padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>
                  {row.nombre} {row.apellido}
                </strong>
                <div style={{ color: muted, marginTop: 4 }}>
                  {row.oficio}
                  {row.vinculo === 'sin_evidencia' ? ' · sin evidencia de oficio' : ''}
                </div>
                <div style={{ marginTop: 4 }}>
                  {row.numero} · {row.entidad}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={busyId === key}
                  onClick={() => void run(key, () => aprobarMatriculaOficio(supabase, row.userId, row.oficioCodigo))}
                >
                  Aprobar envío
                </button>
                <button
                  type="button"
                  disabled={busyId === key}
                  onClick={() => {
                    const motivo = window.prompt('Motivo del rechazo');
                    if (!motivo?.trim()) return;
                    void run(key, () => rechazarMatriculaOficio(supabase, row.userId, row.oficioCodigo, motivo.trim()));
                  }}
                >
                  Rechazar envío
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
              {row.fotos.map((foto) => (
                <figure key={foto.id} style={{ margin: 0, width: 160 }}>
                  {foto.signedUrl ? (
                    <a href={foto.signedUrl} target="_blank" rel="noreferrer">
                      <img
                        alt={`${row.oficio}, foto ${foto.status}`}
                        src={foto.signedUrl}
                        style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 12 }}
                      />
                    </a>
                  ) : (
                    <div style={{ width: 160, height: 160, borderRadius: 12, background: '#F3E6D4' }} />
                  )}
                  <figcaption style={{ fontSize: 13, marginTop: 6 }}>
                    {foto.status === 'pendiente' ? 'En revisión' : foto.status === 'aprobada' ? 'Aprobada' : 'Rechazada'}
                    {foto.motivo ? ` · ${foto.motivo}` : ''}
                  </figcaption>
                  {foto.status !== 'aprobada' ? (
                    <button
                      type="button"
                      disabled={busyId === foto.id}
                      onClick={() => void run(foto.id, () => aprobarMatriculaFoto(supabase, foto.id))}
                    >
                      Aprobar foto
                    </button>
                  ) : null}
                  {foto.status !== 'rechazada' ? (
                    <button
                      type="button"
                      disabled={busyId === foto.id}
                      onClick={() => {
                        const motivo = window.prompt('Motivo del rechazo de la foto');
                        if (!motivo?.trim()) return;
                        void run(foto.id, () => rechazarMatriculaFoto(supabase, foto.id, motivo.trim()));
                      }}
                    >
                      Rechazar foto
                    </button>
                  ) : null}
                </figure>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}
