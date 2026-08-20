import { useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { AppButton } from '../../components/common/AppButton';
import { AppTextInput } from '../../components/common/AppTextInput';
import { TextLink } from '../../components/common/TextLink';
import { useAppToast } from '../../components/toast/toast';
import type { AuthStackScreenProps } from '../../navigation/types';
import { requestPasswordRecoveryOtp } from '../../services/passwordAuth';
import { isValidEmail } from '../../utils/validation';
import { AuthPasswordFormShell } from './AuthPasswordFormShell';
import { authFormStyles as styles } from './authFormStyles';

type Props = AuthStackScreenProps<'ForgotPasswordRequest'>;

/**
 * Paso 1 recuperación: valida email en BD y dispara resetPasswordForEmail (OTP).
 */
export function ForgotPasswordRequestScreen({ navigation }: Props) {
  const toast = useAppToast();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [submitError, setSubmitError] = useState('');

  function validate(): boolean {
    setEmailError('');
    setSubmitError('');
    if (!email.trim()) {
      setEmailError('El email es obligatorio.');
      return false;
    }
    if (!isValidEmail(email)) {
      setEmailError('Ingresá un email válido.');
      return false;
    }
    return true;
  }

  async function handleSend() {
    Keyboard.dismiss();
    if (!validate()) return;

    setLoading(true);
    setSubmitError('');
    try {
      const result = await requestPasswordRecoveryOtp(email);
      if (result.ok) {
        toast.success(result.message, 'YaChanga');
        navigation.navigate('ResetPassword', {
          email: email.trim().toLowerCase(),
          otpSentAt: Date.now(),
        });
      } else {
        if (result.code === 'email_not_registered') {
          setEmailError(result.message);
        } else {
          setSubmitError(result.message);
        }
        toast.error(result.message, 'Error', { durationMs: 4500 });
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'No se pudo enviar el código. Revisá tu conexión.';
      setSubmitError(message);
      toast.error(message, 'Error', { durationMs: 4500 });
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPasswordFormShell onBack={() => navigation.navigate('Login')}>
      <Text style={styles.title}>Recuperar acceso</Text>
      <Text style={styles.description}>
        Ingresá tu correo y te enviaremos un código de verificación para restablecer tu
        contraseña.
      </Text>

      <AppTextInput
        label="Correo electrónico"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          setEmailError('');
          setSubmitError('');
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="nombre@ejemplo.com"
        error={emailError}
      />

      {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}

      <AppButton title="Enviar código" onPress={() => void handleSend()} loading={loading} />

      <View style={styles.linkWrap}>
        <TextLink onPress={() => navigation.navigate('Login')}>Volver al login</TextLink>
      </View>
    </AuthPasswordFormShell>
  );
}
