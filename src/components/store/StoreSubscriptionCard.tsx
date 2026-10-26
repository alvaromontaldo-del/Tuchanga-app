import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../common/AppButton';
import { useAppToast } from '../toast/toast';
import { colors, radii, spacing } from '../../constants/theme';
import { openPagoCheckout } from '../../navigation/openPagoCheckout';
import { navigationRef } from '../../navigation/navigationRef';
import {
  fetchMyStoreSubscription,
  startStoreSubscriptionCheckout,
} from '../../services/storeSubscriptionSupabase';
import {
  canConfigureDebit,
  categoryFeeLabel,
  debitButtonLabel,
  DEFAULT_TRIAL_DAYS,
  subscriptionDetail,
  subscriptionHeadline,
  subscriptionPhase,
  trialNotice,
  type StoreSubscriptionSnapshot,
} from '../../utils/storeSubscription';

type Props = {
  storeId: string;
  fallbackStatus?: string | null;
};

function viewFrom(snapshot: StoreSubscriptionSnapshot | null, fallbackStatus: string | null) {
  const status = snapshot?.status ?? fallbackStatus;
  const daysRemaining = snapshot?.daysRemaining ?? null;
  const phase = subscriptionPhase({
    status,
    daysRemaining,
    currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
  });
  return { snapshot, phase, daysRemaining };
}

export function StoreSubscriptionCard({ storeId, fallbackStatus = null }: Props) {
  const toast = useAppToast();
  const [snapshot, setSnapshot] = useState<StoreSubscriptionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void fetchMyStoreSubscription().then((next) => {
        if (!alive) return;
        setSnapshot(next);
        setLoading(false);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const { phase, daysRemaining } = viewFrom(snapshot, fallbackStatus);
  const trialDays = snapshot?.trialDays ?? DEFAULT_TRIAL_DAYS;
  const debitLinked = snapshot?.debitLinked === true;
  const notice = phase === 'trial' ? trialNotice(daysRemaining, debitLinked) : null;
  const showDays = phase === 'trial' && daysRemaining != null && daysRemaining > 0;
  const missingPrice = !snapshot?.category || snapshot.monthlyFee == null;
  const showButton = canConfigureDebit(phase);

  const onConfigure = async () => {
    if (missingPrice) {
      toast.warning(
        snapshot?.category
          ? 'Todavía no hay un precio cargado para tu categoría.'
          : 'Todavía no tenés una categoría asignada.',
        'Débito automático',
      );
      return;
    }
    setOpening(true);
    try {
      const checkoutUrl = await startStoreSubscriptionCheckout(storeId);
      if (!navigationRef.isReady()) {
        throw new Error('No se pudo abrir Mercado Pago.');
      }
      openPagoCheckout({
        checkoutUrl,
        sandbox: true,
        checkoutKind: 'subscription',
        subscriptionStoreId: storeId,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo abrir el débito automático.',
        'Mercado Pago',
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Suscripción</Text>
      {loading && !snapshot ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <>
          <Text style={styles.headline}>{subscriptionHeadline(phase, daysRemaining)}</Text>
          {showDays ? (
            <Text style={styles.days}>
              {daysRemaining}
              <Text style={styles.daysUnit}> {daysRemaining === 1 ? 'día' : 'días'}</Text>
            </Text>
          ) : null}
          <Text style={styles.detail}>
            {subscriptionDetail({
              phase,
              trialDays,
              debitLinked,
              currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
            })}
          </Text>
          {phase !== 'review' && phase !== 'rejected' ? (
            <Text style={styles.fee}>
              {categoryFeeLabel(snapshot?.category ?? null, snapshot?.monthlyFee ?? null)}
            </Text>
          ) : null}
          {notice ? (
            <View style={[styles.notice, notice.level === '10' ? styles.noticeUrgent : styles.noticeSoft]}>
              <Text style={styles.noticeText}>{notice.text}</Text>
            </View>
          ) : null}
          {showButton ? (
            <>
              <AppButton
                title={debitButtonLabel(phase, debitLinked)}
                onPress={() => void onConfigure()}
                loading={opening}
              />
              <Text style={styles.sandbox}>Mercado Pago en modo prueba. No es un cobro real.</Text>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  loader: { alignSelf: 'flex-start', marginVertical: spacing.sm },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  days: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1,
  },
  daysUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0,
  },
  detail: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  fee: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  notice: {
    borderRadius: radii.card,
    padding: spacing.md,
    borderWidth: 1,
  },
  noticeSoft: {
    backgroundColor: '#F4F1EE',
    borderColor: '#E4DDD6',
  },
  noticeUrgent: {
    backgroundColor: '#F8EEEE',
    borderColor: '#E7C9C9',
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text,
  },
  sandbox: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
