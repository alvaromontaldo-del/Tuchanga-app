import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

export const PENDING_COMMERCE_NOTICE_TITLE = 'Comercio en validación';

export const PENDING_COMMERCE_NOTICE_MESSAGE =
  'Su comercio está siendo validado por un administrador. Aguarde entre 24 y 48 hs para poder ingresar.';

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
    Alert.alert(PENDING_COMMERCE_NOTICE_TITLE, PENDING_COMMERCE_NOTICE_MESSAGE);
  })();
}
