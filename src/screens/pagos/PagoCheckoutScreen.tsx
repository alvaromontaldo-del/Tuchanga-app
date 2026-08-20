import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import {
  MP_CHECKOUT_SUCCESS_INJECTED_JS,
  parseMpWebViewNavigation,
  shouldBlockMpExternalNavigation,
} from '../../config/mercadoPago';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { usePagoRetornoDeepLink } from '../../navigation/usePagoRetornoDeepLink';
import type { RootStackParamList, RootStackScreenProps } from '../../navigation/rootTypes';

type Route = RouteProp<RootStackParamList, 'PagoCheckout'>;

export function PagoCheckoutScreen() {
  const navigation = useNavigation<RootStackScreenProps<'PagoCheckout'>['navigation']>();
  const route = useRoute<Route>();
  const {
    contratacionId,
    materialOrderId,
    checkoutUrl,
    sandbox = false,
    conversationId,
  } = route.params;
  const isMaterialServiceFee = Boolean(materialOrderId);

  const [closing, setClosing] = useState(false);
  const [webKey, setWebKey] = useState(0);
  const handled = useRef(false);
  const mpPaymentIdRef = useRef<string | undefined>(undefined);
  const webRef = useRef<WebView>(null);

  usePagoRetornoDeepLink(contratacionId, materialOrderId);

  const finish = useCallback(
    (status: 'approved' | 'pending' | 'failure') => {
      if (handled.current) return;
      handled.current = true;
      setClosing(true);
      navigation.replace('PagoRetorno', {
        contratacionId,
        materialOrderId,
        status,
        conversationId,
        mpPaymentId: mpPaymentIdRef.current,
      });
    },
    [contratacionId, materialOrderId, conversationId, navigation],
  );

  const handleUrl = useCallback(
    (url: string) => {
      const parsed = parseMpWebViewNavigation(url);
      if (!parsed) return;
      if (parsed.paymentId) mpPaymentIdRef.current = parsed.paymentId;
      finish(parsed.status);
    },
    [finish],
  );

  const reinjectSuccessProbe = useCallback(() => {
    webRef.current?.injectJavaScript(MP_CHECKOUT_SUCCESS_INJECTED_JS);
  }, []);

  const onNavigationChange = useCallback(
    (nav: WebViewNavigation) => {
      handleUrl(nav.url ?? '');
    },
    [handleUrl],
  );

  const onShouldStartLoadWithRequest = useCallback(
    (event: { url: string }) => {
      const url = event.url;
      if (sandbox && shouldBlockMpExternalNavigation(url)) {
        return false;
      }
      const parsed = parseMpWebViewNavigation(url);
      if (parsed) {
        if (parsed.paymentId) mpPaymentIdRef.current = parsed.paymentId;
        finish(parsed.status);
        return false;
      }
      return true;
    },
    [finish, sandbox],
  );

  const onWebViewMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const payload = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          status?: string;
          paymentId?: string;
          materialOrderId?: string;
        };
        if (payload.paymentId) mpPaymentIdRef.current = payload.paymentId;
        if (payload.type === 'mp_approved' || payload.type === 'mp_retorno') {
          const st = String(payload.status ?? 'approved').toLowerCase();
          if (st === 'approved' || st === 'success' || payload.type === 'mp_approved') {
            finish('approved');
            return;
          }
          if (st === 'pending' || st === 'in_process') {
            finish('pending');
            return;
          }
        }
      } catch {
        if (event.nativeEvent.data === 'mp_approved') finish('approved');
      }
    },
    [finish],
  );

  const handleCancel = useCallback(() => {
    // Si capturamos payment_id, asumir pending y forzar sync/RPC.
    // Si solo canceló sin pagar, status failure → NO acredita por RPC.
    const status = mpPaymentIdRef.current ? 'pending' : 'failure';
    navigation.replace('PagoRetorno', {
      contratacionId,
      materialOrderId,
      status,
      conversationId,
      mpPaymentId: mpPaymentIdRef.current,
    });
  }, [contratacionId, conversationId, materialOrderId, navigation]);

  const openExternalBrowser = useCallback(() => {
    void Linking.openURL(checkoutUrl);
  }, [checkoutUrl]);

  const restartCheckout = useCallback(() => {
    handled.current = false;
    mpPaymentIdRef.current = undefined;
    setClosing(false);
    setWebKey((k) => k + 1);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={handleCancel} style={styles.backBtn}>
          <Text style={styles.backText}>Cancelar</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Mercado Pago</Text>
          <Text style={styles.headerSubtitle}>
            {isMaterialServiceFee
              ? 'Costo de servicio YaChanga · checkout seguro'
              : 'Costo de servicio YaChanga · checkout seguro'}
          </Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {sandbox ? (
        <View style={styles.sandboxBanner}>
          <Text style={styles.sandboxTitle}>Modo de prueba (sandbox)</Text>
          <Text style={styles.sandboxText}>
            La cinta &quot;Como usuario&quot; en MP es normal en sandbox (no significa que estés
            logueado).{'\n\n'}
            Opción A (recomendada): Ingresar con cuenta de prueba comprador (TESTUSER + contraseña de
            Developers).{'\n\n'}
            Opción B: Sin cuenta → Tarjeta → 4509 9535 6623 3704 · CVV 123 · titular exacto APRO · DNI
            12345678 · 1 cuota.
          </Text>
          <View style={styles.sandboxActions}>
            <Pressable style={styles.sandboxBtn} onPress={openExternalBrowser}>
              <Text style={styles.sandboxBtnText}>Abrir en navegador</Text>
            </Pressable>
            <Pressable style={styles.sandboxBtnGhost} onPress={restartCheckout}>
              <Text style={styles.sandboxBtnGhostText}>Reiniciar checkout</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {closing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <WebView
          ref={webRef}
          key={`mp-checkout-${webKey}`}
          source={{ uri: checkoutUrl }}
          onNavigationStateChange={onNavigationChange}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onMessage={onWebViewMessage}
          onLoadEnd={reinjectSuccessProbe}
          injectedJavaScript={MP_CHECKOUT_SUCCESS_INJECTED_JS}
          incognito={false}
          cacheEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
          {...(Platform.OS === 'android' ? { originWhitelist: ['https://*', 'http://*'] } : {})}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...typography.subtitle, fontWeight: '800', textAlign: 'center' },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  backBtn: { minWidth: 72 },
  backText: { color: colors.primary, fontWeight: '700' },
  sandboxBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  sandboxTitle: { fontSize: 13, fontWeight: '900', color: '#92400E', marginBottom: 4 },
  sandboxText: { fontSize: 12, fontWeight: '600', color: '#78350F', lineHeight: 17 },
  sandboxActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  sandboxBtn: {
    flex: 1,
    backgroundColor: '#D97706',
    borderRadius: radii.button,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sandboxBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  sandboxBtnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D97706',
    borderRadius: radii.button,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sandboxBtnGhostText: { color: '#92400E', fontWeight: '800', fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
