import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { AppButton } from '../../components/common/AppButton';
import { AppTextInput } from '../../components/common/AppTextInput';
import { TextLink } from '../../components/common/TextLink';
import { colors, spacing } from '../../constants/theme';
import type { AuthStackScreenProps } from '../../navigation/types';
import { requestPasswordReset } from '../../services/auth';
import { isValidEmail } from '../../utils/validation';

type Props = AuthStackScreenProps<'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 440);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  function validate(): boolean {
    setEmailError('');
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
    if (!validate()) return;
    setLoading(true);
    try {
      const result = await requestPasswordReset(email);
      if (result.ok) {
        Alert.alert('Tu Changa', result.message);
        navigation.navigate('Login');
      } else {
        Alert.alert('Error', result.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { width: contentWidth }]}>
          <Text style={styles.title}>Recuperar acceso</Text>
          <Text style={styles.description}>
            Ingresa tu correo electrónico para restablecer tu contraseña
          </Text>

          <AppTextInput
            label="Correo electrónico"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="nombre@ejemplo.com"
            error={emailError}
          />

          <AppButton
            title="Enviar instrucciones"
            onPress={handleSend}
            loading={loading}
          />

          <View style={styles.linkWrap}>
            <TextLink onPress={() => navigation.navigate('Login')}>
              Volver al login
            </TextLink>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  linkWrap: {
    marginTop: spacing.md,
    width: '100%',
    alignItems: 'center',
  },
});
