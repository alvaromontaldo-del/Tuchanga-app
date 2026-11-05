import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import type { FeedTrustIcon } from '../../utils/feedTrust';
import { MATRICULA_OFICIO_CATALOG, type MatriculaOficioCodigo } from '../../utils/matriculaVerificada';

const SEALS: Record<
  FeedTrustIcon,
  { icon: keyof typeof Ionicons.glyphMap; ink: string; wash: string; label: string }
> = {
  antecedentes: {
    icon: 'shield-checkmark',
    ink: '#1F6B45',
    wash: '#E7F4EC',
    label: 'Antecedentes aprobados',
  },
  gas: {
    icon: 'flame',
    ink: '#8C6A3D',
    wash: '#F3E6D4',
    label: 'Matrícula de gas verificada',
  },
  electricidad: {
    icon: 'flash',
    ink: '#8E0000',
    wash: '#F8E8E8',
    label: 'Matrícula de electricidad verificada',
  },
  plomeria: {
    icon: 'water',
    ink: '#1F4E5F',
    wash: '#E7F0F3',
    label: 'Matrícula de plomería verificada',
  },
  fumigacion: {
    icon: 'leaf',
    ink: '#3F5C45',
    wash: '#E7F0E8',
    label: 'Matrícula de fumigación verificada',
  },
};

type Props = {
  code: FeedTrustIcon;
  size?: number;
};

/** Sello chico, sin texto. Mismo lenguaje para el feed y los módulos de matrícula. */
export function OficioMatriculaIcon({ code, size = 18 }: Props) {
  const seal = SEALS[code];
  const iconSize = Math.max(10, Math.round(size * 0.62));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={seal.label}
      style={[
        styles.seal,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: seal.wash,
        },
      ]}
    >
      <Ionicons name={seal.icon} size={iconSize} color={seal.ink} />
    </View>
  );
}

export function oficioMatriculaLabel(code: MatriculaOficioCodigo): string {
  return MATRICULA_OFICIO_CATALOG[code].titulo;
}

const styles = StyleSheet.create({
  seal: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
