import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../constants/theme';

/** Tilde verde. No muestra el archivo ni ningún dato del certificado. */
export function AntecedentesPenalesBadge({ compact = false }: { compact?: boolean }) {
  return (
    <View
      style={[styles.badge, compact ? styles.compact : styles.regular]}
      accessibilityRole="text"
      accessibilityLabel="Antecedentes penales"
    >
      <Ionicons name="checkmark-circle" size={compact ? 14 : 16} color="#15803D" />
      <Text style={[styles.text, compact && styles.textCompact]}>Antecedentes penales</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#BBF7D0',
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
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  textCompact: {
    fontSize: 12,
  },
});
