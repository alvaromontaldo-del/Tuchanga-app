import { StyleSheet, Text, View } from 'react-native';
import { COSTO_SERVICIO_LABEL } from '../../constants/serviceCostCopy';
import { colors, radii, spacing } from '../../constants/theme';

type Props =
  | {
      variant: 'client';
      finalAmount: string;
      serviceFee: string;
      balance: string;
    }
  | {
      variant: 'worker';
      amount: string;
    };

/**
 * Montos del presupuesto: el precio que importa va grande y el resto en dos
 * columnas. El profesional solo ve lo que cobra.
 */
export function QuoteMoneySummary(props: Props) {
  if (props.variant === 'worker') {
    return (
      <View style={styles.panel} accessibilityRole="summary">
        <Text style={styles.primaryLabel}>Monto a cobrar</Text>
        <Text style={styles.primaryAmount}>{props.amount}</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.panel}
      accessibilityRole="summary"
      accessibilityLabel={`Precio final ${props.finalAmount}. ${COSTO_SERVICIO_LABEL} ${props.serviceFee}. Saldo pendiente ${props.balance}.`}
    >
      <Text style={styles.primaryLabel}>Precio final</Text>
      <Text style={styles.primaryAmount}>{props.finalAmount}</Text>
      <View style={styles.split}>
        <View style={styles.cell}>
          <Text style={styles.secondaryLabel}>{COSTO_SERVICIO_LABEL}</Text>
          <Text style={styles.secondaryAmount}>{props.serviceFee}</Text>
        </View>
        <View style={styles.rule} />
        <View style={styles.cell}>
          <Text style={styles.secondaryLabel}>Saldo pendiente</Text>
          <Text style={styles.secondaryAmount}>{props.balance}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.input,
    backgroundColor: colors.background,
  },
  primaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  primaryAmount: {
    marginTop: 2,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: colors.text,
  },
  split: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cell: { flex: 1, paddingRight: spacing.sm },
  rule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginRight: spacing.sm,
  },
  secondaryLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  secondaryAmount: {
    marginTop: 2,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: colors.text,
  },
});
