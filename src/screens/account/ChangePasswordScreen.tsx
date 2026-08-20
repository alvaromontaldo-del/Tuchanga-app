import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { useAppToast } from '../../components/toast/toast';
import { colors, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import { changePasswordWithReauth } from '../../services/passwordAuth';
import {
  getPasswordRegistrationError,
  passwordsMatch,
} from '../../utils/validation';

type Props = AccountStackScreenProps<'ChangePassword'>;

/**
 * Cambio de contraseña con sesión activa: re-auth (signInWithPassword) + updateUser.
 */
export function ChangePasswordScreen({ navigation }: Props) {
  const { user } = useAuth();
  const toast = useAppToast();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 440);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [currentError, setCurrentError] = useState('');
  const [newError, setNewError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [submitError, setSubmitError] = useState('');

  function validate(): boolean {
    let ok = true;
    setCurrentError('');
    setNewError('');
    setConfirmError('');
    setSubmitError('');

    if (!currentPassword) {
      setCurrentError('La contraseña anterior es obligatoria.');
      ok = false;
    }
    const pwdErr = getPasswordRegistrationError(newPassword);
    if (pwdErr) {
      setNewError(pwdErr);
      ok = false;
    }
    if (!confirmPassword) {
      setConfirmError('Confirmá la nueva contraseña.');
      ok = false;
    } else if (!passwordsMatch(newPassword, confirmPassword)) {
      setConfirmError('Las contraseñas no coinciden.');
      ok = false;
    }
    if (currentPassword && newPassword && currentPassword === newPassword) {
      setNewError('La nueva contraseña debe ser distinta a la anterior.');
      ok = false;
    }

    return ok;
  }

  async function handleSubmit() {
    if (!validate()) return;

    const email = user?.email?.trim();
    if (!email) {
      setSubmitError('No encontramos tu correo en la sesión. Volvé a iniciar sesión.');
      return;
    }

    setLoading(true);
    try {
      const result = await changePasswordWithReauth({
        email,
        currentPassword,
        newPassword,
      });
      if (result.ok) {
        toast.success(result.message, 'YaChanga');
        navigation.goBack();
      } else {
        setSubmitError(result.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppKeyboardAvoidingView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { width: contentWidth }]}>
          <Text style={styles.description}>
            Por seguridad, confirmá tu contraseña actual antes de elegir una nueva.
          </Text>

          <AppTextInput
            label="Contraseña anterior"
            value={currentPassword}
            onChangeText={(t) => {
              setCurrentPassword(t);
              setSubmitError('');
            }}
            passwordToggle
            placeholder="••••••••"
            error={currentError}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <AppTextInput
            label="Nueva contraseña"
            value={newPassword}
            onChangeText={(t) => {
              setNewPassword(t);
              setSubmitError('');
            }}
            passwordToggle
            placeholder="Mín. 8 caracteres, letra y número"
            error={newError}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <AppTextInput
            label="Confirmar nueva contraseña"
            value={confirmPassword}
            onChangeText={(t) => {
              setConfirmPassword(t);
              setSubmitError('');
            }}
            passwordToggle
            placeholder="Repetí la nueva contraseña"
            error={confirmError}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}

          <AppButton title="Guardar contraseña" onPress={handleSubmit} loading={loading} />
        </View>
      </ScrollView>
    </AppKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'center',
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  submitError: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: colors.error,
    fontWeight: '600',
  },
});
