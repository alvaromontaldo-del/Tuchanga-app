import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useContratacionPagoRealtime } from '../../hooks/useContratacionPagoRealtime';
import {
  openChatFromContratacion,
  openMaterialOrderDetail,
} from '../../navigation/openPagoCheckout';
import { fetchMaterialOrderReveal } from '../../services/clientQuotesSupabase';
import {
  confirmarSeñaMaterialesMercadoPago,
  confirmarSeñaMercadoPago,
} from '../../services/pagosMercadoPago';
import { beginPaymentSessionGuard, endPaymentSessionGuard } from '../../services/paymentSessionGuard';
import type { RootStackParamList, RootStackScreenProps } from '../../navigation/rootTypes';

type Route = RouteProp<RootStackParamList, 'PagoRetorno'>;

function isMaterialFeePaid(status: string, depositStatus: string, contactRevealed: boolean) {
  return (
    contactRevealed ||
    depositStatus === 'paid' ||
    depositStatus === 'waived' ||
    status === 'deposit_paid' ||
    status === 'completed'
  );
}

export function PagoRetornoScreen() {
  const navigation = useNavigation<RootStackScreenProps<'PagoRetorno'>['navigation']>();
  const route = useRoute<Route>();
  const contratacionId = route.params?.contratacionId;
  const materialOrderId = route.params?.materialOrderId;
  const initialStatus = route.params?.status;
  const mpPaymentId = route.params?.mpPaymentId;
  const conversationId = route.params?.conversationId;

  const [syncError, setSyncError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [materialConfirmed, setMaterialConfirmed] = useState(false);
  const redirectedRef = useRef(false);

  useEffect(() => {
    beginPaymentSessionGuard();
    return () => {
      endPaymentSessionGuard();
    };
  }, []);

  const isMaterial = Boolean(materialOrderId);

  const goNext = useCallback(() => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    if (materialOrderId) {
      openMaterialOrderDetail(materialOrderId);
      return;
    }
    if (contratacionId) {
      void openChatFromContratacion(contratacionId, conversationId);
    }
  }, [contratacionId, conversationId, materialOrderId]);

  const onConfirmed = useCallback(() => {
    setSyncError(null);
    goNext();
  }, [goNext]);

  const { waiting, confirmed, timedOut } = useContratacionPagoRealtime(contratacionId ?? '', {
    enabled: Boolean(contratacionId) && !isMaterial,
    mpPaymentId,
    onConfirmed,
  });

  const runSync = useCallback(async () => {
    setRetrying(true);
    setSyncError(null);
    try {
      if (materialOrderId) {
        const result = await confirmarSeñaMaterialesMercadoPago(materialOrderId, mpPaymentId);
        if (result.ok || result.already_paid) {
          setMaterialConfirmed(true);
          return;
        }

        try {
          const reveal = await fetchMaterialOrderReveal(materialOrderId);
          if (isMaterialFeePaid(reveal.status, reveal.depositStatus, reveal.contactRevealed)) {
            setMaterialConfirmed(true);
            return;
          }
        } catch {
          /* ignore */
        }

        setSyncError(result.message ?? 'Mercado Pago aún no confirmó el pago.');
        return;
      }
      if (!contratacionId) return;
      const result = await confirmarSeñaMercadoPago(contratacionId, mpPaymentId);
      if (!result.ok && !result.already_paid) {
        setSyncError(result.message ?? 'Mercado Pago aún no confirmó el pago.');
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'No se pudo sincronizar el pago.');
    } finally {
      setRetrying(false);
    }
  }, [contratacionId, materialOrderId, mpPaymentId]);

  useEffect(() => {
    if (!contratacionId && !materialOrderId) return;
    void runSync();
  }, [contratacionId, materialOrderId, mpPaymentId, runSync]);

  useEffect(() => {
    if (confirmed || materialConfirmed) goNext();
  }, [confirmed, materialConfirmed, goNext]);

  const done = confirmed || materialConfirmed;

  if (!contratacionId && !materialOrderId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.card}>
          <Text style={styles.title}>No encontramos el pago</Text>
          <Text style={styles.subtitle}>Volvé al chat o a la orden e intentá de nuevo.</Text>
          <Pressable onPress={() => navigation.goBack()} style={styles.btn}>
            <Text style={styles.btnText}>Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
  const showFailureHint = initialStatus === 'failure' && !done && !waiting && !retrying;

  const title = done
    ? 'Costo de servicio acreditado'
    : showFailureHint
      ? 'Pago no completado'
      : waiting || retrying
        ? 'Confirmando pago…'
        : timedOut
          ? 'Pago en proceso'
          : 'Esperando confirmación';

  const subtitle = done
    ? isMaterial
      ? 'Volviendo a la orden con el código y el PIN…'
      : 'Volviendo al chat con tu PIN y los avisos de seguridad…'
    : syncError
      ? syncError
        : showFailureHint
        ? 'El pago no se acreditó en Mercado Pago. Volvé a intentar el checkout.'
        : waiting || retrying
          ? 'Estamos verificando tu pago con Mercado Pago…'
          : timedOut
            ? 'Puede tardar unos minutos. Tocá Sincronizar.'
            : 'Volvé en unos segundos.';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.card}>
        {waiting || done || retrying ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {!done ? (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnSecondary,
                (retrying || waiting) && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              disabled={retrying || waiting}
              onPress={() => void runSync()}
            >
              <Text style={styles.btnSecondaryText}>
                {retrying ? 'Sincronizando…' : 'Sincronizar pago'}
              </Text>
            </Pressable>
          </>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          onPress={goNext}
        >
          <Text style={styles.btnText}>{isMaterial ? 'Ver orden' : 'Ir al chat'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.btnGhost, pressed && styles.pressed]}
          onPress={() => navigation.navigate('Main')}
        >
          <Text style={styles.btnGhostText}>Volver al inicio</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
  },
  loader: { marginBottom: spacing.md },
  title: { ...typography.title, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  btn: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  btnSecondaryText: { color: colors.primary, fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '800' },
  btnGhost: { paddingVertical: 12 },
  btnGhostText: { color: colors.primary, fontWeight: '700' },
  pressed: { opacity: 0.9 },
});
