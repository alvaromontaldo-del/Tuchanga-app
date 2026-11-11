import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../constants/theme';
import type { MatriculaOficioCodigo } from '../../utils/matriculaVerificada';
import { oficioMatriculaSeal } from '../../utils/oficioMatriculaSeals';
import { OficioMatriculaIcon } from './OficioMatriculaIcon';

/** Leyenda del perfil: ícono y color del oficio. Sin el tilde genérico. */
export function OficioMatriculaBadge({
  code,
  compact = false,
}: {
  code: MatriculaOficioCodigo;
  compact?: boolean;
}) {
  const seal = oficioMatriculaSeal(code);
  return (
    <View
      style={[
        styles.badge,
        compact ? styles.compact : styles.regular,
        { backgroundColor: seal.wash, borderColor: seal.line },
      ]}
      accessibilityRole="text"
      accessibilityLabel={seal.label}
    >
      <OficioMatriculaIcon code={code} size={compact ? 16 : 18} />
      <Text style={[styles.text, compact && styles.textCompact, { color: seal.ink }]}>
        {seal.label}
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
    borderWidth: 1,
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
    fontSize: 13,
    fontWeight: '700',
  },
  textCompact: {
    fontSize: 12,
  },
});
