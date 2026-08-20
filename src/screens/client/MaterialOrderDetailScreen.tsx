import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  fetchMaterialGroupReveals,
  formatMoneyAr,
  type MaterialOrderReveal,
} from '../../services/clientQuotesSupabase';
import {
  confirmarCostoServicioMaterialesMp,
  crearPreferenciaCostoServicioMateriales,
} from '../../services/pagosMercadoPago';
import { normalizeDisplayAddress } from '../../utils/formatAddress';
import { formatOrderCodeDisplay } from '../../utils/orderCode';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type ParamList = {
  MaterialOrderDetail: { orderId: string };
};

type Props = NativeStackScreenProps<ParamList, 'MaterialOrderDetail'>;

/**
 * Pagar Costo de Servicio YaChanga (MP) → revelar comercios + código + PIN.
 * El fee es tarifa de plataforma; el cliente sigue debiendo el total a cada comercio.
 */
export function MaterialOrderDetailScreen({ navigation, route }: Props) {
  const { orderId } = route.params;
  const toast = useAppToast();
  const [reveals, setReveals] = useState<MaterialOrderReveal[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isMercadoPagoEnabled()) {
        await confirmarCostoServicioMaterialesMp(orderId).catch(() => null);
      }
      const data = await fetchMaterialGroupReveals(orderId);
      setReveals(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No se pudo cargar la orden.';
      setError(message.includes('not_order_client') ? 'No tenés permiso para ver esta orden.' : message);
      setReveals([]);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onPayServiceFee = useCallback(async () => {
    setPaying(true);
    try {
      if (isMercadoPagoEnabled()) {
        const synced = await confirmarCostoServicioMaterialesMp(orderId);
        if (synced.ok || synced.already_paid) {
          await refresh();
          toast.success('Costo de servicio acreditado.', 'Pago');
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
        return;
      }

      toast.error('Mercado Pago no está habilitado. No se puede acreditar sin pago.', 'Pago');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo confirmar el costo de servicio.',
        'Error',
      );
    } finally {
      setPaying(false);
    }
  }, [orderId, refresh, toast]);

  const primary = reveals[0] ?? null;
  const paid = useMemo(() => {
    if (!primary) return false;
    return (
      primary.contactRevealed ||
      primary.depositStatus === 'paid' ||
      primary.status === 'deposit_paid' ||
      primary.status === 'completed'
    );
  }, [primary]);

  const totalDue = useMemo(
    () => reveals.reduce((acc, r) => acc + (r.acceptedTotal ?? 0), 0),
    [reveals],
  );
  const serviceFee = primary?.serviceFee ?? primary?.depositAmount ?? 0;

  if (loading && reveals.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !primary) {
    return (
      <View style={styles.centered}>
        <Text style={styles.warn}>{error ?? 'Orden no disponible.'}</Text>
        <AppButton title="Reintentar" onPress={() => void refresh()} variant="secondary" />
        <AppButton title="Volver" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.title}>Orden de materiales</Text>
        <Text style={styles.line}>
          A abonar a {reveals.length === 1 ? 'comercio' : 'comercios'}:{' '}
          <Text style={styles.strong}>{formatMoneyAr(totalDue)}</Text>
        </Text>
        {reveals.length > 1
          ? reveals.map((r, i) => (
              <Text key={r.orderId} style={styles.meta}>
                ·{' '}
                {paid && !r.storeName.includes('oculto')
                  ? r.storeName
                  : `Comercio ${i + 1}`}
                : {formatMoneyAr(r.acceptedTotal ?? 0)}
              </Text>
            ))
          : null}
      </View>

      {!paid ? (
        <View style={styles.card}>
          <Text style={styles.lead}>
            Pagá el costo de servicio YaChanga con Mercado Pago para revelar los comercios, los
            códigos de orden y los PIN de cierre. El total de cada presupuesto lo abonás al
            comercio al retirar.
          </Text>
          <AppButton
            title={`Pagar costo de servicio ${formatMoneyAr(serviceFee)}`}
            onPress={() => void onPayServiceFee()}
            loading={paying}
          />
        </View>
      ) : (
        reveals.map((r) => (
          <View key={r.orderId} style={styles.card}>
            <Text style={styles.revealedTitle}>
              {reveals.length > 1 ? 'Comercio' : 'Comercio revelado'}
            </Text>
            <Text style={styles.storeName}>
              {r.storeName.includes('oculto') ? 'Comercio' : r.storeName}
            </Text>
            <Text style={styles.line}>
              Dir:{' '}
              {r.storeAddress?.trim()
                ? normalizeDisplayAddress(r.storeAddress.trim())
                : 'No informada — contactá al comercio'}
            </Text>
            <Text style={styles.line}>
              A abonar: <Text style={styles.strong}>{formatMoneyAr(r.acceptedTotal ?? 0)}</Text>
            </Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Código de orden</Text>
              <Text style={styles.codeValue}>{formatOrderCodeDisplay(r.orderCode)}</Text>
            </View>
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>PIN (dáselo al comercio)</Text>
              <Text style={styles.codeValue}>
                {r.verificationPin ? r.verificationPin.padStart(4, '0') : '—'}
              </Text>
            </View>
          </View>
        ))
      )}

      <Pressable onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>Volver</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  warn: { textAlign: 'center', color: colors.textSecondary, fontSize: 15 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  lead: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  line: { fontSize: 15, color: colors.text },
  strong: { fontWeight: '800' },
  meta: { fontSize: 13, color: colors.textSecondary },
  revealedTitle: { fontSize: 14, fontWeight: '700', color: colors.primary },
  storeName: { fontSize: 18, fontWeight: '800', color: colors.text },
  codeBox: {
    marginTop: 8,
    padding: spacing.md,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  codeValue: {
    marginTop: 4,
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 1,
  },
  back: { alignItems: 'center', padding: spacing.md },
  backText: { fontSize: 15, fontWeight: '700', color: colors.primary },
});
