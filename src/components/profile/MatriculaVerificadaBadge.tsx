import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../constants/theme';

/** Insignia pública. No muestra el número, la entidad ni las fotos. */
export function MatriculaVerificadaBadge({ compact = false }: { compact?: boolean }) {
  return (
    <View
      style={[styles.badge, compact ? styles.compact : styles.regular]}
      accessibilityRole="text"
      accessibilityLabel="Matrícula verificada"
    >
      <Ionicons name="ribbon" size={compact ? 13 : 15} color="#8C6A3D" />
      <Text style={[styles.text, compact && styles.textCompact]}>Matrícula verificada</Text>
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
