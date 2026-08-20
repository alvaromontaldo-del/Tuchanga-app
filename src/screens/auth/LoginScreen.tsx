import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppScreen } from '../../components/layout/AppScreen';
import { BrandLogoHorizontal } from '../../components/brand/BrandMark';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { TextLink } from '../../components/common/TextLink';
import { useAppToast } from '../../components/toast/toast';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCommerceShell, COMMERCE_SHELL_STATUSES } from '../../context/CommerceShellContext';
import { closeAuthModalAndGoToInicio, closeAuthModalAndRedirect } from '../../navigation/openAuthModal';
import type { AuthStackScreenProps } from '../../navigation/types';
import { signIn } from '../../services/auth';
import { isValidEmail } from '../../utils/validation';

type Props = AuthStackScreenProps<'Login'>;

export function LoginScreen({ navigation, route }: Props) {
  const { signIn: setSession, flashMessage, setFlashMessage } = useAuth();
  const {
    enterCommerceIntent,
    clearCommerceIntent,
    chooseSessionRole,
    clearSessionRole,
    refresh: refreshCommerce,
  } = useCommerceShell();
  const toast = useAppToast();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 440);

  const [asCommerce, setAsCommerce] = useState(Boolean(route.params?.asCommerce));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (route.params?.asCommerce) setAsCommerce(true);
  }, [route.params?.asCommerce]);

  useEffect(() => {
    if (!flashMessage) return;
    toast.info(flashMessage, 'YaChanga');
    setFlashMessage(null);
  }, [flashMessage, setFlashMessage, toast]);

  function validate(): boolean {
    let ok = true;
    setEmailError('');
    setPasswordError('');

    if (!email.trim()) {
      setEmailError('El email es obligatorio.');
      ok = false;
    } else if (!isValidEmail(email)) {
      setEmailError('Ingresá un email válido.');
      ok = false;
    }

    if (!password) {
      setPasswordError('La contraseña es obligatoria.');
      ok = false;
    }

    return ok;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitError('');
    setLoading(true);
    try {
      if (asCommerce) await enterCommerceIntent();
      else await clearCommerceIntent();

      const result = await signIn(email, password);
      if (!result.ok) {
        setSubmitError(result.message);
        return;
      }

      await setSession(result.user, true);
      const stores = await refreshCommerce();
      const hasStore = stores.some((s) => COMMERCE_SHELL_STATUSES.has(s.status));

      if (hasStore) {
        // Provisional: mismo email con comercio → elegir rol (o ir directo si marcó Soy comercio).
        if (asCommerce) await chooseSessionRole('commerce');
        else await clearSessionRole();
      } else if (asCommerce) {
        await chooseSessionRole('commerce');
      } else {
        await chooseSessionRole('client');
      }

      const redirectTo = route.params?.redirectTo;
      if (redirectTo && !asCommerce && !hasStore) closeAuthModalAndRedirect(redirectTo);
      else closeAuthModalAndGoToInicio();
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'No se pudo completar el inicio de sesión.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppScreen style={styles.flex} edges={['top', 'left', 'right', 'bottom']}>
      <AppKeyboardAvoidingView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { width: contentWidth }]}>
            <View style={styles.brandWrap}>
              <BrandLogoHorizontal variant="hero" maxWidth={contentWidth} style={styles.brandLogo} />
            </View>
            <Text style={styles.subtitle}>
              {asCommerce ? 'Ingresá como comercio' : 'Ingresá a tu cuenta'}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.commerceToggle,
                asCommerce && styles.commerceToggleOn,
                pressed && styles.pressed,
              ]}
              onPress={() => setAsCommerce((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: asCommerce }}
              accessibilityLabel="Soy comercio"
            >
              <Ionicons
                name="storefront-outline"
                size={22}
                color={asCommerce ? colors.primary : colors.textSecondary}
              />
              <View style={styles.commerceToggleText}>
                <Text style={[styles.commerceToggleTitle, asCommerce && styles.commerceToggleTitleOn]}>
                  Soy comercio
                </Text>
                <Text style={styles.commerceToggleSub}>
                  Pedidos de materiales y cotizaciones
                </Text>
              </View>
              <Ionicons
                name={asCommerce ? 'checkbox' : 'square-outline'}
                size={24}
                color={asCommerce ? colors.primary : colors.textSecondary}
              />
            </Pressable>

            <AppTextInput
              label="Email"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setSubmitError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="nombre@ejemplo.com"
              error={emailError}
            />

            <AppTextInput
              label="Contraseña"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setSubmitError('');
              }}
              passwordToggle
              placeholder="••••••••"
              error={passwordError}
            />

            <TextLink
              align="left"
              onPress={() => navigation.navigate('ForgotPasswordRequest')}
            >
              ¿Olvidaste tu contraseña?
            </TextLink>

            <AppButton title="Ingresar" onPress={() => void handleSubmit()} loading={loading} />

            {submitError ? (
              <Text style={styles.submitError} accessibilityLiveRegion="polite">
                {submitError}
              </Text>
            ) : null}

            <View style={styles.footerRow}>
              <Text style={styles.muted}>¿No tenés cuenta? </Text>
              <TextLink
                inline
                onPress={() =>
                  asCommerce
                    ? navigation.navigate('RegisterCommerce')
                    : navigation.navigate('Register', { asCommerce: false })
                }
              >
                Registrate
              </TextLink>
            </View>
          </View>
        </ScrollView>
      </AppKeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  card: {
    alignSelf: 'center',
  },
  brandWrap: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  brandLogo: { alignSelf: 'center' },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  commerceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  commerceToggleOn: {
    borderColor: colors.primary,
    backgroundColor: '#FDECEA',
  },
  commerceToggleText: { flex: 1, gap: 2 },
  commerceToggleTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  commerceToggleTitleOn: { color: colors.primary },
  commerceToggleSub: { fontSize: 12, color: colors.textSecondary },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  muted: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  submitError: {
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
    lineHeight: 20,
  },
  pressed: { opacity: 0.9 },
});
