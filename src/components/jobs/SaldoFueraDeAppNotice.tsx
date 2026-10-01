import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SALDO_ACEPTACION, SALDO_FUERA_DE_APP } from '../../constants/serviceCostCopy';
import { colors, spacing } from '../../constants/theme';

type Props = {
  /** Si está definido, el cliente tiene que marcarlo antes de pagar el costo. */
  accepted?: boolean;
  onToggle?: () => void;
};

export function SaldoFueraDeAppNotice({ accepted, onToggle }: Props) {
  const interactive = typeof onToggle === 'function';

  if (!interactive) {
    return <Text style={styles.note}>{SALDO_FUERA_DE_APP}</Text>;
  }

  return (
    <Pressable
      style={styles.row}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: Boolean(accepted) }}
      accessibilityLabel={SALDO_ACEPTACION}
    >
      <Ionicons
        name={accepted ? 'checkbox' : 'square-outline'}
        size={22}
        color={accepted ? colors.primary : colors.textSecondary}
      />
      <View style={styles.copy}>
        <Text style={styles.note}>{SALDO_FUERA_DE_APP}</Text>
        <Text style={styles.accept}>{SALDO_ACEPTACION}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  copy: { flex: 1, gap: 4 },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  accept: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.text,
  },
});
