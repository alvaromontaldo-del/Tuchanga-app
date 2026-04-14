import type { FeedPost, WorkerPublicProfile, WorkerReview } from '../types/feed';
import { MAX_WORKER_TRADES } from '../types/feed';

function averageRating(reviews: WorkerReview[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

/** Reseñas por trabajador (mock; en producción vendría del backend) */
export const REVIEWS_BY_WORKER_ID: Record<string, WorkerReview[]> = {
  me: [],
  w1: [
    {
      id: 'r1-1',
      clientFirstName: 'Carla',
      rating: 5,
      comment: 'Muy prolija y clara con los presupuestos. El tablero quedó perfecto.',
      createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
    {
      id: 'r1-2',
      clientFirstName: 'Diego',
      rating: 5,
      comment: 'Instalación en norma, sin vueltas. Recomiendo.',
      createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
    {
      id: 'r1-3',
      clientFirstName: 'Laura',
      rating: 4,
      comment: 'Buen trabajo; solo hubo que reagendar una vez por lluvia.',
      createdAt: new Date(Date.now() - 86400000 * 35).toISOString(),
    },
    {
      id: 'r1-4',
      clientFirstName: 'Martín',
      rating: 5,
      comment: 'Puesta a tierra y mediciones explicadas paso a paso.',
      createdAt: new Date(Date.now() - 86400000 * 50).toISOString(),
    },
    {
      id: 'r1-5',
      clientFirstName: 'Sofía',
      rating: 4,
      comment: 'Rápida y responsable. Precio acorde.',
      createdAt: new Date(Date.now() - 86400000 * 60).toISOString(),
    },
    {
      id: 'r1-6',
      clientFirstName: 'Javier',
      rating: 5,
      comment: 'Tablero nuevo en un día. Muy conforme.',
      createdAt: new Date(Date.now() - 86400000 * 75).toISOString(),
    },
    {
      id: 'r1-7',
      clientFirstName: 'Paula',
      rating: 4,
      comment: 'Buena comunicación por WhatsApp durante la obra.',
      createdAt: new Date(Date.now() - 86400000 * 90).toISOString(),
    },
    {
      id: 'r1-8',
      clientFirstName: 'Nicolás',
      rating: 5,
      comment: 'Profesional total. Volvería a contratarla.',
      createdAt: new Date(Date.now() - 86400000 * 100).toISOString(),
    },
  ],
  w2: [
    {
      id: 'r2-1',
      clientFirstName: 'Romina',
      rating: 5,
      comment: 'Destapó la cocina en menos de una hora. Genio.',
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      id: 'r2-2',
      clientFirstName: 'Gustavo',
      rating: 4,
      comment: 'Arregló la pérdida del baño. Sin problemas después.',
      createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
    },
    {
      id: 'r2-3',
      clientFirstName: 'Valeria',
      rating: 5,
      comment: 'Muy educado y dejó todo limpio.',
      createdAt: new Date(Date.now() - 86400000 * 28).toISOString(),
    },
    {
      id: 'r2-4',
      clientFirstName: 'Federico',
      rating: 4,
      comment: 'Buen precio y cumplió el horario.',
      createdAt: new Date(Date.now() - 86400000 * 40).toISOString(),
    },
    {
      id: 'r2-5',
      clientFirstName: 'Micaela',
      rating: 5,
      comment: 'Instaló el termotanque sin drama. 10/10.',
      createdAt: new Date(Date.now() - 86400000 * 55).toISOString(),
    },
    {
      id: 'r2-6',
      clientFirstName: 'Andrés',
      rating: 4,
      comment: 'Correcto. Hubo que comprar una pieza extra pero avisó antes.',
      createdAt: new Date(Date.now() - 86400000 * 70).toISOString(),
    },
  ],
  w3: [
    {
      id: 'r3-1',
      clientFirstName: 'Lucía',
      rating: 5,
      comment: 'Mi perra la adora. Puntual siempre.',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: 'r3-2',
      clientFirstName: 'Tomás',
      rating: 5,
      comment: 'Paseos grupales súper bien organizados.',
      createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    },
    {
      id: 'r3-3',
      clientFirstName: 'Elena',
      rating: 5,
      comment: 'Me mandó fotos durante el paseo. Muy tranquila.',
      createdAt: new Date(Date.now() - 86400000 * 22).toISOString(),
    },
    {
      id: 'r3-4',
      clientFirstName: 'Bruno',
      rating: 5,
      comment: 'Cuidó a mi perro en domicilio un finde. Impecable.',
      createdAt: new Date(Date.now() - 86400000 * 33).toISOString(),
    },
    {
      id: 'r3-5',
      clientFirstName: 'Julieta',
      rating: 5,
      comment: 'La mejor paseadora que tuvimos.',
      createdAt: new Date(Date.now() - 86400000 * 45).toISOString(),
    },
  ],
  w4: [
    {
      id: 'r4-1',
      clientFirstName: 'Hugo',
      rating: 5,
      comment: 'Muy claro con la documentación del gas.',
      createdAt: new Date(Date.now() - 86400000 * 8).toISOString(),
    },
    {
      id: 'r4-2',
      clientFirstName: 'Nadia',
      rating: 5,
      comment: 'Puntual y seguro en cada paso.',
      createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
    {
      id: 'r4-3',
      clientFirstName: 'Leo',
      rating: 4,
      comment: 'Buen trabajo en el calefón.',
      createdAt: new Date(Date.now() - 86400000 * 40).toISOString(),
    },
  ],
  w5: [
    {
      id: 'r5-1',
      clientFirstName: 'Marta',
      rating: 5,
      comment: 'Dejó el departamento impecable.',
      createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    },
    {
      id: 'r5-2',
      clientFirstName: 'Pablo',
      rating: 4,
      comment: 'Buena relación calidad-precio.',
      createdAt: new Date(Date.now() - 86400000 * 18).toISOString(),
    },
  ],
  w6: [
    {
      id: 'r6-1',
      clientFirstName: 'Vera',
      rating: 4,
      comment: 'Tablero listo en el plazo acordado.',
      createdAt: new Date(Date.now() - 86400000 * 11).toISOString(),
    },
    {
      id: 'r6-2',
      clientFirstName: 'Cecilia',
      rating: 5,
      comment: 'Muy recomendable en la costa.',
      createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    },
  ],
};

export function getReviewsForWorker(workerId: string): WorkerReview[] {
  return REVIEWS_BY_WORKER_ID[workerId] ?? [];
}

const r1 = REVIEWS_BY_WORKER_ID.w1;
const r2 = REVIEWS_BY_WORKER_ID.w2;
const r3 = REVIEWS_BY_WORKER_ID.w3;
const r4 = REVIEWS_BY_WORKER_ID.w4;
const r5 = REVIEWS_BY_WORKER_ID.w5;
const r6 = REVIEWS_BY_WORKER_ID.w6;

/** Perfiles públicos para la pantalla de trabajador */
export const WORKERS_BY_ID: Record<string, WorkerPublicProfile> = {
  me: {
    id: 'me',
    firstName: 'Vos',
    trade: 'Profesional',
    avatarUrl: 'https://i.pravatar.cc/150?img=68',
    bio: 'Tu perfil público. Completá rubros y zona cuando conectemos el backend.',
    ratingAverage: 0,
    reviewCount: 0,
    trades: [
      {
        title: 'Profesional',
        description:
          'Servicios generales a medida del cliente. Cotización por mensaje en la app.',
        yearsExperience: 1,
      },
    ],
  },
  w1: {
    id: 'w1',
    firstName: 'María',
    trade: 'Electricista',
    avatarUrl: 'https://i.pravatar.cc/150?img=5',
    bio: 'Electricidad, albañilería ligera y paseos responsables con mascotas en CABA y GBA.',
    ratingAverage: averageRating(r1),
    reviewCount: r1.length,
    trades: [
      {
        title: 'Electricista',
        description:
          'Instalaciones nuevas, tableros, iluminación LED, puesta a tierra y urgencias eléctricas con certificación cuando aplica.',
        yearsExperience: 8,
      },
      {
        title: 'Albañil',
        description:
          'Revocos, pequeñas refacciones de mampostería, preparación de superficies y trabajos de terminación en baño y cocina.',
        yearsExperience: 4,
      },
      {
        title: 'Paseadora de perros',
        description:
          'Paseos individuales o en grupo, agua en ruta y reportes breves al dueño; refuerzo de hábitos básicos en la calle.',
        yearsExperience: 2,
      },
    ],
  },
  w2: {
    id: 'w2',
    firstName: 'Lucas',
    trade: 'Plomero',
    avatarUrl: 'https://i.pravatar.cc/150?img=12',
    bio: 'Destapaciones, pérdidas y refacciones de baño y cocina.',
    ratingAverage: averageRating(r2),
    reviewCount: r2.length,
    trades: [
      {
        title: 'Plomería general',
        description:
          'Reparación de pérdidas, cambio de cañerías y conexiones de agua fría y caliente.',
        yearsExperience: 5,
      },
      {
        title: 'Destapaciones',
        description:
          'Desagües, cloacas, piletas y bañeras con máquina o sonda según el caso.',
        yearsExperience: 5,
      },
      {
        title: 'Grifería y sanitarios',
        description:
          'Colocación de griferías, inodoros, bidets y sellado anti-humedad.',
        yearsExperience: 4,
      },
      {
        title: 'Instalación de termotanque',
        description:
          'Conexión, soporte, válvulas de alivio y revisión de presión.',
        yearsExperience: 3,
      },
    ],
  },
  w3: {
    id: 'w3',
    firstName: 'Ana',
    trade: 'Paseadora de perros',
    avatarUrl: 'https://i.pravatar.cc/150?img=9',
    bio: 'Paseos diarios, refuerzo de hábitos y cuidado responsable.',
    ratingAverage: averageRating(r3),
    reviewCount: r3.length,
    trades: [
      {
        title: 'Paseos individuales',
        description:
          'Salidas a medida según tamaño y energía del perro, con correa y agua.',
        yearsExperience: 3,
      },
      {
        title: 'Paseos grupales',
        description:
          'Socialización supervisada en parques cercanos (cupos limitados).',
        yearsExperience: 2,
      },
      {
        title: 'Cuidado en domicilio',
        description:
          'Visitas cortas para alimentación, agua y juego cuando no estés en casa.',
        yearsExperience: 2,
      },
    ],
  },
  w4: {
    id: 'w4',
    firstName: 'Roberto',
    trade: 'Gasista',
    avatarUrl: 'https://i.pravatar.cc/150?img=33',
    bio: 'Matriculado. Revisiones, instalaciones y habilitaciones de gas.',
    ratingAverage: averageRating(r4),
    reviewCount: r4.length,
    trades: [
      {
        title: 'Gasista matriculado',
        description:
          'Instalaciones domiciliares, pruebas de estanqueidad y certificaciones.',
        yearsExperience: 12,
      },
      {
        title: 'Plomería vinculada a gas',
        description:
          'Conexión de cocinas, calefones y calefactores con normativa vigente.',
        yearsExperience: 8,
      },
    ],
  },
  w5: {
    id: 'w5',
    firstName: 'Carolina',
    trade: 'Pintor',
    avatarUrl: 'https://i.pravatar.cc/150?img=47',
    bio: 'Pintura de interiores y frentes; preparación de superficies.',
    ratingAverage: averageRating(r5),
    reviewCount: r5.length,
    trades: [
      {
        title: 'Pintura interior',
        description:
          'Látex, esmalte sintético y terminaciones en departamentos y casas.',
        yearsExperience: 7,
      },
      {
        title: 'Pintura exterior',
        description:
          'Revoques al agua, frentes y protección contra humedad.',
        yearsExperience: 6,
      },
      {
        title: 'Albañilería ligera',
        description:
          'Pequeñas reparaciones de mampostería antes de pintar.',
        yearsExperience: 4,
      },
    ],
  },
  w6: {
    id: 'w6',
    firstName: 'Diego',
    trade: 'Electricista',
    avatarUrl: 'https://i.pravatar.cc/150?img=15',
    bio: 'Obras nuevas y refacciones eléctricas en zona costera.',
    ratingAverage: averageRating(r6),
    reviewCount: r6.length,
    trades: [
      {
        title: 'Electricista',
        description:
          'Tableros, iluminación y cableado en viviendas y locales.',
        yearsExperience: 9,
      },
    ],
  },
};

export function normalizeWorkerTrades(
  trades: WorkerPublicProfile['trades'],
): WorkerPublicProfile['trades'] {
  return trades.slice(0, MAX_WORKER_TRADES);
}

const img = {
  elec1: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800&q=80',
  elec2: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  elec3: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=800&q=80',
  plom1: 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=800&q=80',
  plom2: 'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=800&q=80',
  plom3: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&q=80',
  dog1: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=800&q=80',
  dog2: 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?w=800&q=80',
  dog3: 'https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?w=800&q=80',
};

/** Posts iniciales del feed */
export const INITIAL_FEED_POSTS: FeedPost[] = [
  {
    id: 'p1',
    workerId: 'w1',
    workerFirstName: 'María',
    workerAvatarUrl: 'https://i.pravatar.cc/150?img=5',
    trade: 'Electricista',
    workImageUrls: [img.elec1, img.elec2, img.elec3],
    description: 'Tablero nuevo y puesta a tierra en departamento. Todo en norma.',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    likeCount: 24,
    likedByMe: false,
  },
  {
    id: 'p2',
    workerId: 'w2',
    workerFirstName: 'Lucas',
    workerAvatarUrl: 'https://i.pravatar.cc/150?img=12',
    trade: 'Plomero',
    workImageUrls: [img.plom1, img.plom2],
    description: 'Cambio de grifería y sellado. Sin pérdidas.',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    likeCount: 18,
    likedByMe: true,
  },
  {
    id: 'p3',
    workerId: 'w3',
    workerFirstName: 'Ana',
    workerAvatarUrl: 'https://i.pravatar.cc/150?img=9',
    trade: 'Paseadora de perros',
    workImageUrls: [img.dog1, img.dog2, img.dog3],
    description: 'Paseo grupal en el parque. ¡Colitas contentas!',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    likeCount: 41,
    likedByMe: false,
  },
];

export function getWorkerById(workerId: string): WorkerPublicProfile | undefined {
  const w = WORKERS_BY_ID[workerId];
  if (!w) return undefined;
  return { ...w, trades: normalizeWorkerTrades(w.trades) };
}
