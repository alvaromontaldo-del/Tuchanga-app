import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppButton } from '../../components/common/AppButton';
import { useAppToast } from '../../components/toast/toast';
import { isMercadoPagoEnabled } from '../../config/mercadoPago';
import { colors, radii, spacing } from '../../constants/theme';
import { openPagoCheckout } from '../../navigation/openPagoCheckout';
import {
  createMaterialCheckout,
  formatMoneyAr,
  type MaterialCheckoutSelection,
} from '../../services/clientQuotesSupabase';
import {
  confirmarCostoServicioMaterialesMp,
  crearPreferenciaCostoServicioMateriales,
} from '../../services/pagosMercadoPago';
import { describePaymentStartFailure } from '../../utils/paymentStartError';
import { calculateServiceFee } from '../../utils/yachangaServiceFee';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MaterialOrderSummarySelection = {
  quoteId: string;
  storeLabel: string;
  itemIds: string[];
  quoteItemIds?: string[];
  items: { id: string; quoteItemId?: string; description: string; lineTotal: number }[];
  includeFreight: boolean;
  freightCost: number;
  materialsSubtotal: number;
};

type ParamList = {
  MaterialOrderSummary: {
    requestId: string;
    selections: MaterialOrderSummarySelection[];
  };
  MaterialOrderDetail: { orderId: string };
};

type Props = NativeStackScreenProps<ParamList, 'MaterialOrderSummary'>;

/**
 * Resumen multi-comercio: desglose + un solo "Pagar costo de servicio".
 */
export function MaterialOrderSummaryScreen({ navigation, route }: Props) {
  const { selections } = route.params;
  const toast = useAppToast();
  const [paying, setPaying] = useState(false);

  const stores = useMemo(() => {
    return selections.map((s) => {
      const freight = s.includeFreight ? s.freightCost : 0;
      const subtotal = s.materialsSubtotal + freight;
      return { ...s, freightApplied: freight, storeTotal: subtotal };
    });
  }, [selections]);

  const materialsTotal = useMemo(
    () => stores.reduce((acc, s) => acc + s.storeTotal, 0),
    [stores],
  );

  const serviceFee = useMemo(
    () => calculateServiceFee(materialsTotal).serviceFee,
    [materialsTotal],
  );

  const onPay = useCallback(async () => {
    if (paying) return;
    setPaying(true);
    try {
      const payload: MaterialCheckoutSelection[] = selections.map((s) => ({
        quoteId: s.quoteId,
        itemIds: s.itemIds,
        quoteItemIds:
          s.quoteItemIds ??
          s.items.map((it) => it.quoteItemId).filter((id): id is string => Boolean(id)),
        includeFreight: s.includeFreight,
      }));
      const checkout = await createMaterialCheckout(payload);
      const orderId = checkout.primaryOrderId;
      const fee = checkout.serviceFee || serviceFee;

      if (isMercadoPagoEnabled()) {
        const synced = await confirmarCostoServicioMaterialesMp(orderId);
        if (synced.ok || synced.already_paid) {
          toast.success('Costo de servicio acreditado.', 'Pago');
          navigation.replace('MaterialOrderDetail', { orderId });
          return;
        }
        const result = await crearPreferenciaCostoServicioMateriales(orderId);
        if (!result.ok) {
          throw new Error(
            result.code === 'mp_not_configured'
              ? 'Mercado Pago no está configurado. No se puede acreditar sin pago.'
              : result.message,
          );
        }
        openPagoCheckout({
          materialOrderId: orderId,
          checkoutUrl: result.data.checkout_url,
          sandbox: Boolean(result.data.sandbox),
        });
        toast.success(`Costo de servicio: ${formatMoneyAr(fee)}`, 'Ir a pagar');
        return;
      }

      toast.error('Mercado Pago no está habilitado. No se puede acreditar sin pago.', 'Pago');
    } catch (e) {
      const failure = describePaymentStartFailure(e);
      console.error('[MaterialOrderSummary] iniciar pago', failure.cause, e);
      toast.error(failure.userMessage, 'Error');
    } finally {
      setPaying(false);
    }
  }, [navigation, paying, selections, serviceFee, toast]);

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Resumen de Pedido</Text>
        <Text style={styles.lead}>
          Revisá el desglose por comercio. El costo de servicio YaChanga se calcula una sola vez
          sobre el total seleccionado.
        </Text>

        {stores.map((s) => (
          <View key={s.quoteId} style={styles.card}>
            <Text style={styles.storeName}>{s.storeLabel}</Text>
            {s.items.map((it) => (
              <View key={it.id} style={styles.row}>
                <Text style={styles.itemDesc} numberOfLines={2}>
                  {it.description}
                </Text>
                <Text style={styles.itemPrice}>{formatMoneyAr(it.lineTotal)}</Text>
              </View>
            ))}
            {s.freightCost > 0 ? (
              <View style={styles.row}>
                <Text style={styles.itemDesc}>
                  {s.includeFreight ? 'Flete' : 'Flete (retiro en local — no incluido)'}
                </Text>
                <Text style={styles.itemPrice}>
                  {s.includeFreight ? formatMoneyAr(s.freightCost) : formatMoneyAr(0)}
                </Text>
              </View>
            ) : null}
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.subLabel}>Subtotal comercio</Text>
              <Text style={styles.subValue}>{formatMoneyAr(s.storeTotal)}</Text>
            </View>
          </View>
        ))}

        <View style={styles.totalCard}>
          <View style={styles.row}>
            <Text style={styles.subLabel}>Total materiales (+ fletes)</Text>
            <Text style={styles.subValue}>{formatMoneyAr(materialsTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.feeLabel}>Costo de servicio YaChanga</Text>
            <Text style={styles.feeValue}>{formatMoneyAr(serviceFee)}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <AppButton title="Volver" onPress={() => navigation.goBack()} variant="secondary" />
        <AppButton
          title={`Pagar costo de servicio ${formatMoneyAr(serviceFee)}`}
          onPress={() => void onPay()}
          loading={paying}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl * 2, gap: spacing.md },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  lead: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 8,
  },
  storeName: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  itemDesc: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  itemPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  subLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  subValue: { fontSize: 14, fontWeight: '800', color: colors.text },
  totalCard: {
    backgroundColor: '#FFF8F8',
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: spacing.md,
    gap: 10,
  },
  feeLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  feeValue: { fontSize: 18, fontWeight: '900', color: colors.primary },
  footer: {
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
