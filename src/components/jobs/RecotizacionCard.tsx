import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import { recotizacionCardModel, type RecotizacionStatus } from '../../utils/recotizarUi';

type Props = {
  role: 'cliente' | 'trabajador';
  status: RecotizacionStatus;
  precioTrabajador: number;
  precioFinal?: number | null;
  comision?: number | null;
  fundamentos: string;
  busy?: boolean;
  /** En el detalle del trabajo la tarjeta ocupa el ancho de la pantalla. */
  fill?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
};

export function RecotizacionCard({
  role,
  status,
  precioTrabajador,
  precioFinal,
  comision,
  fundamentos,
  busy = false,
  fill = false,
  onAccept,
  onReject,
}: Props) {
  const model = recotizacionCardModel({
    role,
    status,
    precioTrabajador,
    precioFinal: role === 'cliente' ? precioFinal : null,
    comision: role === 'cliente' ? comision : null,
    fundamentos,
  });

  return (
    <View style={[styles.card, fill && styles.cardFill]}>
      <View style={styles.top}>
        <Text style={styles.title}>{model.title}</Text>
        <Text style={styles.badge}>{model.badge}</Text>
      </View>
      <Text style={styles.line}>
        {model.amountLabel}: <Text style={styles.strong}>{model.amount}</Text>
      </Text>
      {model.extraLines.map((line) => (
        <Text key={line.label} style={styles.line}>
          {line.label}: <Text style={styles.strong}>{line.value}</Text>
        </Text>
      ))}
      {model.fundamentos ? (
        <Text style={styles.fundamentos}>Fundamentos: {model.fundamentos}</Text>
      ) : null}
      {model.footnote ? <Text style={styles.footnote}>{model.footnote}</Text> : null}
      {model.showActions ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.btnGhost, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={onReject}
            accessibilityRole="button"
            accessibilityLabel="Rechazar recotización"
          >
            <Text style={styles.btnGhostText}>{busy ? '…' : 'Rechazar'}</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={onAccept}
            accessibilityRole="button"
            accessibilityLabel="Aceptar recotización"
          >
            <Text style={styles.btnPrimaryText}>{busy ? '…' : 'Aceptar'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '92%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
  },
  cardFill: { width: '100%', maxWidth: '100%', alignSelf: 'stretch' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: '900', color: colors.text },
  badge: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  line: { fontSize: 14, color: colors.text, lineHeight: 20 },
  strong: { fontWeight: '900' },
  fundamentos: { fontSize: 14, color: colors.text, lineHeight: 20 },
  footnote: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  btn: {
    flex: 1,
    borderRadius: radii.button,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnDisabled: { opacity: 0.5 },
  btnGhostText: { fontWeight: '800', color: colors.text },
  btnPrimaryText: { fontWeight: '800', color: '#fff' },
});
