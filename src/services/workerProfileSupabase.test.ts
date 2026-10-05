import { beforeEach, describe, expect, it, vi } from 'vitest';

const side = vi.hoisted(() => ({
  intro: vi.fn(async (_profileId: string): Promise<string | null> => null),
  urgencias: vi.fn(async (_workerUserId: string): Promise<boolean> => false),
  priv: vi.fn(async (): Promise<{ birth_date: string | null } | null> => null),
  rpc: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: { id: 'client-1' } } })),
  from: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    rpc: side.rpc,
    from: side.from,
    auth: { getUser: side.getUser },
  }),
}));

vi.mock('./introVideoSupabase', () => ({
  fetchIntroVideoPath: (profileId: string) => side.intro(profileId),
  playbackUrlForPath: (path: string | null | undefined) =>
    path ? `https://cdn.example/${path}` : null,
}));

vi.mock('./urgenciasSupabase', () => ({
  fetchWorkerAtiendeUrgencias: (workerUserId: string) => side.urgencias(workerUserId),
}));

vi.mock('./supabaseUser', () => ({
  fetchMyProfilePrivate: () => side.priv(),
}));

import {
  fetchWorkerPublicProfileFromSupabase,
  mapPublicWorkerRpcPayload,
} from './workerProfileSupabase';

const WORKER_ID = '570cf8cb-8f21-4229-8397-551e85374106';

function rpcPayload(overrides?: {
  nombre?: string;
  apellido?: string;
  descripcion?: string;
  habilidades?: unknown;
}) {
  return {
    profile: {
      id: WORKER_ID,
      nombre: overrides?.nombre ?? 'Alvaro',
      apellido: overrides?.apellido ?? 'NoDebeVerse',
      oficio: 'Aire acondicionado y climatización',
      rating: 4.5,
      resenas_count: 4,
      total_jobs_done: 4,
      avatar: 'https://cdn.example/alvaro.jpg',
      zona: 'Parque Sarmiento',
      descripcion: overrides?.descripcion ?? 'Hola soy un profesional de oficios multiples',
    },
    habilidades:
      overrides && 'habilidades' in overrides
        ? overrides.habilidades
        : [
            {
              nombre: 'Aire acondicionado y climatización',
              descripcion: 'Instalación y service',
              anos_experiencia: 1,
              es_principal: true,
            },
            {
              nombre: 'Limpieza posobra',
              descripcion: 'Limpieza fina',
              anos_experiencia: 10,
              es_principal: false,
            },
          ],
    resenas: [],
  };
}

describe('mapPublicWorkerRpcPayload', () => {
  it('arma el perfil con nombre de pila y oficios, sin el apellido', () => {
    const profile = mapPublicWorkerRpcPayload(rpcPayload());
    expect(profile).toMatchObject({
      id: WORKER_ID,
      firstName: 'Alvaro',
      trade: 'Aire acondicionado y climatización',
      ratingAverage: 4.5,
      reviewCount: 4,
      totalJobsDone: 4,
      professionalDescription: 'Hola soy un profesional de oficios multiples',
      avatarUrl: 'https://cdn.example/alvaro.jpg',
    });
    expect(profile?.trades.map((t) => t.title)).toEqual([
      'Aire acondicionado y climatización',
      'Limpieza posobra',
    ]);
    expect(profile?.trades[1]?.yearsExperience).toBe(10);
    expect(JSON.stringify(profile)).not.toContain('NoDebeVerse');
    expect(JSON.stringify(profile)).not.toContain('apellido');
  });

  it('acepta el JSON en string y descarta una inicial de apellido colgada', () => {
    const profile = mapPublicWorkerRpcPayload(
      JSON.stringify(rpcPayload({ nombre: 'Horacio T.' })),
    );
    expect(profile?.firstName).toBe('Horacio');
  });

  it('sin oficios no hay perfil público', () => {
    expect(mapPublicWorkerRpcPayload(rpcPayload({ habilidades: [] }))).toBeNull();
    expect(mapPublicWorkerRpcPayload(null)).toBeNull();
    expect(mapPublicWorkerRpcPayload({ profile: { id: WORKER_ID, nombre: 'Alvaro' } })).toBeNull();
  });
});

describe('fetchWorkerPublicProfileFromSupabase', () => {
  beforeEach(() => {
    side.intro.mockReset();
    side.urgencias.mockReset();
    side.priv.mockReset();
    side.rpc.mockReset();
    side.from.mockReset();
    side.getUser.mockReset();
    side.intro.mockResolvedValue('videos/intro.mp4');
    side.urgencias.mockResolvedValue(true);
    side.priv.mockResolvedValue({ birth_date: '1990-01-02' });
    side.getUser.mockResolvedValue({ data: { user: { id: 'client-1' } } });
    side.from.mockImplementation(() => {
      throw new Error('no se debe leer profiles directo');
    });
  });

  it('usa get_public_worker_profile y no consulta profiles directo', async () => {
    side.rpc.mockImplementation(async (name: string) => {
      if (name === 'get_public_worker_profile') {
        return { data: rpcPayload(), error: null };
      }
      if (name === 'fetch_worker_trades') {
        return {
          data: [
            {
              nombre_oficio: 'Limpieza posobra',
              foto_url: 'https://cdn.example/foto.jpg',
              photo_urls: ['https://cdn.example/foto.jpg', 'https://cdn.example/foto-2.jpg'],
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: 'rpc desconocido' } };
    });

    const profile = await fetchWorkerPublicProfileFromSupabase(WORKER_ID);
    expect(side.rpc).toHaveBeenCalledWith('get_public_worker_profile', {
      p_worker_id: WORKER_ID,
    });
    expect(side.from).not.toHaveBeenCalled();
    expect(profile?.firstName).toBe('Alvaro');
    expect(profile?.introVideoUrl).toBe('https://cdn.example/videos/intro.mp4');
    expect(profile?.atiendeUrgencias).toBe(true);
    expect(profile?.trades.find((t) => t.title === 'Limpieza posobra')?.photoUrls).toEqual([
      'https://cdn.example/foto.jpg',
      'https://cdn.example/foto-2.jpg',
    ]);
    expect(JSON.stringify(profile)).not.toContain('NoDebeVerse');
  });

  it('si el RPC no publica el perfil, no inventa uno', async () => {
    side.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchWorkerPublicProfileFromSupabase(WORKER_ID)).resolves.toBeNull();
    expect(side.from).not.toHaveBeenCalled();
  });

  it('un fallo de video, urgencias o fotos no borra el perfil', async () => {
    side.intro.mockRejectedValue(new Error('video caído'));
    side.urgencias.mockRejectedValue(new Error('urgencias caídas'));
    side.rpc.mockImplementation(async (name: string) => {
      if (name === 'get_public_worker_profile') {
        return { data: rpcPayload({ nombre: 'Farmeador', descripcion: 'Electricista' }), error: null };
      }
      if (name === 'fetch_worker_trades') {
        throw new Error('fotos caídas');
      }
      return { data: null, error: { message: 'rpc desconocido' } };
    });

    const profile = await fetchWorkerPublicProfileFromSupabase(WORKER_ID);
    expect(profile?.firstName).toBe('Farmeador');
    expect(profile?.professionalDescription).toBe('Electricista');
    expect(profile?.trades).toHaveLength(2);
    expect(profile?.introVideoUrl).toBeNull();
    expect(profile?.atiendeUrgencias).toBe(false);
    expect(profile?.trades.every((t) => !t.photoUrls)).toBe(true);
  });

  it('la fecha propia que falla no borra el perfil', async () => {
    side.getUser.mockResolvedValue({ data: { user: { id: WORKER_ID } } });
    side.priv.mockRejectedValue(new Error('privado caído'));
    side.rpc.mockImplementation(async (name: string) => {
      if (name === 'get_public_worker_profile') return { data: rpcPayload(), error: null };
      return { data: [], error: null };
    });

    const profile = await fetchWorkerPublicProfileFromSupabase(WORKER_ID);
    expect(profile?.firstName).toBe('Alvaro');
    expect(profile?.birthDate).toBeUndefined();
  });
});
