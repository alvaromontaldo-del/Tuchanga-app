import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../constants/theme';

type Props = TextInputProps & {
  label: string;
  error?: string;
  /** Muestra ícono de ojo para alternar visibilidad (para campos de contraseña). */
  passwordToggle?: boolean;
};

/**
 * Campo de texto con label y mensaje de error; bordes redondeados.
 */
export function AppTextInput({
  label,
  error,
  style,
  passwordToggle,
  secureTextEntry,
  ...rest
}: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const effectiveSecure =
    passwordToggle ? !showPassword : Boolean(secureTextEntry);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, error ? styles.inputRowError : null]}>
        <TextInput
          placeholderTextColor={colors.textSecondary}
          {...rest}
          style={[styles.inputFlex, style]}
          // Debe ir después de {...rest}: si no, `secureTextEntry` del padre pisa el toggle del ojo.
          secureTextEntry={effectiveSecure}
        />
        {passwordToggle ? (
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            style={styles.eyeBtn}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            hitSlop={10}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={24}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
    marginLeft: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    minHeight: 52,
  },
  inputRowError: {
    borderColor: colors.error,
  },
  inputFlex: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    minHeight: 52,
  },
  eyeBtn: {
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 52,
    zIndex: 2,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
    marginLeft: 4,
  },
});
