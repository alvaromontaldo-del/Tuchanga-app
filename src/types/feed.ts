/** ID del trabajador “vos” en publicaciones creadas desde la app (mock). */
export const CURRENT_USER_WORKER_ID = 'me';

/** Publicación del feed de trabajos realizados */
export type FeedPost = {
  id: string;
  workerId: string;
  /** Solo nombre (sin apellido), para mostrar en la tarjeta */
  workerFirstName: string;
  workerAvatarUrl: string;
  trade: string;
  /** Promedio de reseñas (1–5); si no hay dato, no se muestra en la tarjeta */
  workerRatingAverage?: number;
  /** Cantidad de reseñas del profesional (opcional; útil para UI consistente) */
  workerReviewCount?: number;
  /** Trabajos finalizados (`profiles.total_jobs_done`). Ausente = dato legacy. */
  workerTotalJobsDone?: number;
  /** Hasta 3 fotos por publicación */
  workImageUrls: string[];
  description: string;
  /** ISO 8601; se formatea en la UI */
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
};

export const MAX_POST_IMAGES = 3;

export function normalizePostImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_POST_IMAGES);
}

/** Reseña de un cliente (solo nombre, sin apellido) */
export type WorkerReview = {
  id: string;
  clientFirstName: string;
  /** Puntuación entera 1–5 */
  rating: number;
  comment: string;
  createdAt: string;
};

/** Un oficio del trabajador con descripción y años de experiencia en ese rubro (máx. 5 por perfil) */
export type WorkerTradeEntry = {
  title: string;
  description: string;
  yearsExperience: number;
  /** Hasta 5 fotos del oficio (bucket job-photos). */
  photoUrls?: string[];
};

export type WorkerPublicProfile = {
  id: string;
  firstName: string;
  /** Rubro principal (resumen / feed) */
  trade: string;
  avatarUrl: string;
  /** Descripción profesional (profiles.professional_description). */
  professionalDescription: string;
  /** YYYY-MM-DD (opcional) */
  birthDate?: string;
  /** Promedio de calificación entre 1 y 5 */
  ratingAverage: number;
  /** Cantidad de reseñas que promedian la calificación */
  reviewCount: number;
  /** Trabajos finalizados. Con menos de 2 la UI muestra «Nuevo» en lugar de estrellas. */
  totalJobsDone: number;
  /** Oficios ofrecidos (máximo 5) */
  trades: WorkerTradeEntry[];
  /** URL pública del video de presentación. Ausente = no tiene o la columna no está. */
  introVideoUrl?: string | null;
  /** El profesional marcó que atiende urgencias. Ausente o false = sin badge. */
  atiendeUrgencias?: boolean;
};

export const MAX_WORKER_TRADES = 5;
