import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { BrandLogoHorizontal } from '../../components/brand/BrandMark';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { TextLink } from '../../components/common/TextLink';
import { useAppToast } from '../../components/toast/toast';
import { colors, spacing } from '../../constants/theme';
import {
  defaultSessionRoleAfterLogin,
  isWorkerAuthUser,
  loginAuthDismiss,
} from '../../constants/defaultLoginRole';
import { AccountDeactivationModal } from '../../components/auth/AccountDeactivationModal';
import { useAuth } from '../../context/AuthContext';
import { useCommerceShell, COMMERCE_SHELL_STATUSES } from '../../context/CommerceShellContext';
import { showPendingCommerceNoticeOnce } from '../../context/pendingCommerceNotice';
import {
  closeAuthModal,
  closeAuthModalAndGoToInicio,
  closeAuthModalAndRedirect,
} from '../../navigation/openAuthModal';
import type { AuthStackScreenProps } from '../../navigation/types';
import { signIn, type AuthUser } from '../../services/auth';
import { shouldDropRememberedBiometricLogin } from '../../services/biometricLogin';
import {
  forgetBiometricLogin,
  loadBiometricLoginOffer,
  rememberBiometricLogin,
  unlockBiometricCredentials,
} from '../../services/biometricLoginDevice';
import { isValidEmail } from '../../utils/validation';

type Props = AuthStackScreenProps<'Login'>;

export function LoginScreen({ navigation, route }: Props) {
  const {
    signIn: setSession,
    flashMessage,
    setFlashMessage,
    deactivationMessage,
    clearDeactivationMessage,
  } = useAuth();
  const { chooseSessionRole, refresh: refreshCommerce } = useCommerceShell();
  const toast = useAppToast();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 440);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [deactivationNotice, setDeactivationNotice] = useState<string | null>(null);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!flashMessage) return;
    toast.info(flashMessage, 'YaChanga');
    setFlashMessage(null);
  }, [flashMessage, setFlashMessage, toast]);

  useEffect(() => {
    if (!deactivationMessage) return;
    setDeactivationNotice(deactivationMessage);
    setSubmitError(deactivationMessage);
    clearDeactivationMessage();
  }, [deactivationMessage, clearDeactivationMessage]);

  useEffect(() => {
    let cancelled = false;
    void loadBiometricLoginOffer().then((label) => {
      if (!cancelled) setBiometricLabel(label);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function enterAfterSignIn(user: AuthUser) {
    await setSession(user, true);
    const stores = await refreshCommerce();
    const hasStore = stores.some((s) => COMMERCE_SHELL_STATUSES.has(s.status));
    const hasPendingOnly =
      !hasStore && stores.some((s) => s.status === 'pending_approval');
    // Comercio habilitado gana sobre profesional y cliente.
    const role = defaultSessionRoleAfterLogin({
      hasEnabledCommerce: hasStore,
      isWorker: isWorkerAuthUser(user),
    });

    if (hasPendingOnly) showPendingCommerceNoticeOnce(user.id);
    await chooseSessionRole(role);

    const redirectTo = route.params?.redirectTo;
    const dismiss = loginAuthDismiss({ role, redirectTo });
    // Comercio: closeAuthModal() y el shell abre la ruta raíz `Commerce`.
    if (dismiss === 'close') closeAuthModal();
    else if (dismiss === 'redirect') closeAuthModalAndRedirect(redirectTo);
    else closeAuthModalAndGoToInicio();
  }

  async function handleSubmit() {
    if (loading || biometricLoading) return;
    if (!validate()) return;
    setSubmitError('');
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (!result.ok) {
        if (result.reason === 'account_deactivated') {
          await forgetBiometricLogin();
          setBiometricLabel(null);
          setDeactivationNotice(result.message);
        }
        setSubmitError(result.message);
        return;
      }

      await rememberBiometricLogin(email, password);
      await enterAfterSignIn(result.user);
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'No se pudo completar el inicio de sesión.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleBiometric() {
    if (loading || biometricLoading) return;
    setSubmitError('');
    setBiometricLoading(true);
    try {
      const unlocked = await unlockBiometricCredentials();
      if (!unlocked.ok) {
        if (unlocked.message) setSubmitError(unlocked.message);
        return;
      }

      const result = await signIn(unlocked.email, unlocked.password);
      if (!result.ok) {
        if (shouldDropRememberedBiometricLogin(result)) {
          await forgetBiometricLogin();
          setBiometricLabel(null);
        }
        setSubmitError(result.message);
        if (result.reason === 'account_deactivated') {
          setDeactivationNotice(result.message);
        }
        return;
      }

      await enterAfterSignIn(result.user);
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'No se pudo completar el inicio de sesión.',
      );
    } finally {
      setBiometricLoading(false);
    }
  }

  return (
    <AppScreen style={styles.flex} edges={['top', 'left', 'right', 'bottom']}>
      <AccountDeactivationModal
        visible={Boolean(deactivationNotice)}
        message={deactivationNotice ?? ''}
        onClose={() => setDeactivationNotice(null)}
      />
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
            <Text style={styles.subtitle}>Ingresá a tu cuenta</Text>

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

            <AppButton
              title="Ingresar"
              onPress={() => void handleSubmit()}
              loading={loading}
              disabled={biometricLoading}
            />

            {biometricLabel ? (
              <AppButton
                title={biometricLabel}
                variant="secondary"
                onPress={() => void handleBiometric()}
                loading={biometricLoading}
                disabled={loading}
                style={styles.biometricButton}
              />
            ) : null}

            {submitError ? (
              <Text style={styles.submitError} accessibilityLiveRegion="polite">
                {submitError}
              </Text>
            ) : null}

            <View style={styles.footer}>
              <Text style={styles.footerLine}>
                ¿No tenés cuenta? Elegí cómo{' '}
                <Text
                  style={styles.registerLink}
                  onPress={() =>
                    navigation.navigate(
                      'SignupRole',
                      route.params?.redirectTo ? { redirectTo: route.params.redirectTo } : undefined,
                    )
                  }
                  accessibilityRole="link"
                  accessibilityLabel="Elegí cómo registrarte"
                >
                  registrarte
                </Text>
              </Text>
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
  biometricButton: {
    marginTop: spacing.sm,
  },
  footer: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  footerLine: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  registerLink: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  submitError: {
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
    lineHeight: 20,
  },
});
