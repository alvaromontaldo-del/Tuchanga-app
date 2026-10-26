import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { fetchStoreTrialDays } from '../services/storeSubscriptionSupabase';
import { pendingCommerceReviewMessage } from '../utils/storeSubscription';

export const PENDING_COMMERCE_NOTICE_TITLE = 'Comercio en validación';

async function reviewMessage(): Promise<string> {
  const days = await fetchStoreTrialDays();
  return pendingCommerceReviewMessage(days);
}

const NOTICE_KEY = '@yachanga/pending_commerce_notice_v1';

const shownUserIds = new Set<string>();

function storageKey(userId: string): string {
  return `${NOTICE_KEY}:${userId}`;
}

/**
 * Aviso de alta pendiente, una sola vez por usuario (también entre reinicios).
 * Llamadas repetidas en el mismo arranque no apilan el Alert.
 */
export function showPendingCommerceNoticeOnce(userId: string | null | undefined): void {
  const id = userId?.trim();
  if (!id || shownUserIds.has(id)) return;
  shownUserIds.add(id);

  void (async () => {
    const key = storageKey(id);
    try {
      const seen = await AsyncStorage.getItem(key);
      if (seen === '1') return;
      await AsyncStorage.setItem(key, '1');
    } catch {
      /* si falla el storage igual mostramos esta vez; el set evita repetir en la sesión */
    }
    Alert.alert(PENDING_COMMERCE_NOTICE_TITLE, await reviewMessage());
  })();
}

/** Aviso al tocar el módulo cuando el comercio sigue en revisión. Lee N del servidor. */
export function presentPendingCommerceNotice(): void {
  void (async () => {
    Alert.alert(PENDING_COMMERCE_NOTICE_TITLE, await reviewMessage());
  })();
}
