import type { Ionicons } from '@expo/vector-icons';
import type { FeedTrustIcon } from './feedTrust';
import { MATRICULA_OFICIO_CODIGOS, type MatriculaOficioCodigo } from './matriculaVerificada';

export type OficioMatriculaSeal = {
  icon: keyof typeof Ionicons.glyphMap;
  /** Tinta del glifo y de la leyenda. */
  ink: string;
  /** Fondo del sello y de la pastilla. */
  wash: string;
  /** Filete de la pastilla en el perfil. */
  line: string;
  label: string;
};

/**
 * Paleta única de sellos. Feed, búsqueda y perfil leen estos mismos
 * ícono y colores. Antecedentes no es un oficio: tiene el suyo.
 */
export const OFICIO_MATRICULA_SEALS: Record<FeedTrustIcon, OficioMatriculaSeal> = {
  antecedentes: {
    icon: 'shield-checkmark',
    ink: '#1F6B45',
    wash: '#E7F4EC',
    line: '#B7D8C6',
    label: 'Antecedentes aprobados',
  },
  gas: {
    icon: 'flame',
    ink: '#8C6A3D',
    wash: '#F3E6D4',
    line: '#E0CDB0',
    label: 'Matrícula de gas verificada',
  },
  electricidad: {
    icon: 'flash',
    ink: '#8E0000',
    wash: '#F8E8E8',
    line: '#E4C4C4',
    label: 'Matrícula de electricidad verificada',
  },
  plomeria: {
    icon: 'water',
    ink: '#1F4E5F',
    wash: '#E7F0F3',
    line: '#C5D5DC',
    label: 'Matrícula de plomería verificada',
  },
  fumigacion: {
    icon: 'leaf',
    ink: '#3F5C45',
    wash: '#E7F0E8',
    line: '#C5D6C8',
    label: 'Matrícula de fumigación verificada',
  },
};

export function oficioMatriculaSeal(code: FeedTrustIcon): OficioMatriculaSeal {
  return OFICIO_MATRICULA_SEALS[code];
}

/** Los cuatro oficios, en el orden del catálogo, con ícono y tinta distintos. */
export function oficioSealPairs(): Array<{ code: MatriculaOficioCodigo } & OficioMatriculaSeal> {
  return MATRICULA_OFICIO_CODIGOS.map((code) => ({ code, ...OFICIO_MATRICULA_SEALS[code] }));
}
