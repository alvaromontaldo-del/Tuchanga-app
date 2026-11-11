import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import type { FeedTrustIcon } from '../../utils/feedTrust';
import { MATRICULA_OFICIO_CATALOG, type MatriculaOficioCodigo } from '../../utils/matriculaVerificada';
import { oficioMatriculaSeal } from '../../utils/oficioMatriculaSeals';

type Props = {
  code: FeedTrustIcon;
  size?: number;
};

/** Sello chico, sin texto. Misma paleta en el feed, la búsqueda y el perfil. */
export function OficioMatriculaIcon({ code, size = 18 }: Props) {
  const seal = oficioMatriculaSeal(code);
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
