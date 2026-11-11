import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../constants/theme';
import type { MatriculaOficioCodigo } from '../../utils/matriculaVerificada';
import { oficioMatriculaSeal } from '../../utils/oficioMatriculaSeals';
import { OficioMatriculaIcon } from './OficioMatriculaIcon';

/** Insignia pública. No muestra el número, la entidad ni las fotos. */
export function MatriculaVerificadaBadge({
  compact = false,
  label = 'Matrícula verificada',
  code = null,
}: {
  compact?: boolean;
  /** En el perfil público es «Matrícula de [oficio] verificada». */
  label?: string;
  /** Oficio del sello. Sin oficio queda el tilde genérico. */
  code?: MatriculaOficioCodigo | null;
}) {
  const seal = code ? oficioMatriculaSeal(code) : null;
  return (
    <View
      style={[
        styles.badge,
        compact ? styles.compact : styles.regular,
        seal
          ? { backgroundColor: seal.wash, borderColor: seal.line }
          : null,
      ]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {seal && code ? (
        <OficioMatriculaIcon code={code} size={compact ? 16 : 18} />
      ) : (
        <Ionicons name="ribbon" size={compact ? 13 : 15} color="#8C6A3D" />
      )}
      <Text style={[styles.text, compact && styles.textCompact, seal ? { color: seal.ink } : null]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#FBF7F1',
    borderWidth: 1,
    borderColor: '#E4D3B8',
  },
  regular: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  compact: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  text: {
    color: '#6B4E2E',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  textCompact: {
    fontSize: 12,
  },
});
