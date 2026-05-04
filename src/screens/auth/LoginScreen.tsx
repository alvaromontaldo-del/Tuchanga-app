import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandLogoHorizontal } from '../../components/brand/BrandMark';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { TextLink } from '../../components/common/TextLink';
import { colors, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { closeAuthModalAndGoToInicio, closeAuthModalAndRedirect } from '../../navigation/openAuthModal';
import type { AuthStackScreenProps } from '../../navigation/types';
import { signIn } from '../../services/auth';
import { isValidEmail } from '../../utils/validation';

type Props = AuthStackScreenProps<'Login'>;

export function LoginScreen({ navigation, route }: Props) {
  const { signIn: setSession } = useAuth();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 440);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

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
      const result = await signIn(email, password);
      if (result.ok) {
        await setSession(result.user, true);
        const redirectTo = route.params?.redirectTo;
        if (redirectTo) closeAuthModalAndRedirect(redirectTo);
        else closeAuthModalAndGoToInicio();
      } else {
        setSubmitError(result.message);
      }
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'No se pudo completar el inicio de sesión.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
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
            onPress={() => navigation.navigate('ForgotPassword')}
          >
            ¿Olvidaste tu contraseña?
          </TextLink>

          <AppButton title="Ingresar" onPress={handleSubmit} loading={loading} />

          {submitError ? (
            <Text style={styles.submitError} accessibilityLiveRegion="polite">
              {submitError}
            </Text>
          ) : null}

          <View style={styles.footerRow}>
            <Text style={styles.muted}>¿No tenés cuenta? </Text>
            <TextLink inline onPress={() => navigation.navigate('Register')}>
              Registrate
            </TextLink>
          </View>
        </View>
      </ScrollView>
    </AppKeyboardAvoidingView>
    </SafeAreaView>
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
    marginBottom: spacing.lg,
  },
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
});
