import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { urgenciasBadgeView } from '../../utils/urgencias';

const BADGE = urgenciasBadgeView(true);

/** Píldora roja/naranja. El padre la monta solo si el profesional atiende urgencias. */
export function UrgenciasBadge() {
  if (!BADGE) return null;
  return (
    <View
      style={styles.pill}
      accessibilityRole="text"
      accessibilityLabel={BADGE.label}
    >
      <Ionicons name={BADGE.icon} size={12} color="#FFFFFF" />
      <Text style={styles.label}>{BADGE.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E65100',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
