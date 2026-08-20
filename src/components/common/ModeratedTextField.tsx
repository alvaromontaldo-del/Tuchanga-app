import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../constants/theme';
import { validateContactInfo } from '../../utils/contactModeration';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (text: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  /** Texto bajo el input cuando hay bloqueo (por defecto el mensaje de política). */
  policyMessage?: string;
  showIcon?: boolean;
  /**
   * `boxed`: borde propio (chat/publicaciones).
   * `plain`: solo el TextInput con tus estilos (perfil/registro).
   */
  variant?: 'boxed' | 'plain';
};

/**
 * Input de texto con validación anti-contacto en tiempo real.
 * Deshabilitá el botón de acción con `validateContactInfo(value).blocked`.
 */
export function ModeratedTextField({
  value,
  onChangeText,
  containerStyle,
  inputStyle,
  style,
  policyMessage,
  showIcon = true,
  variant = 'boxed',
  ...textInputProps
}: Props) {
  const moderation = useMemo(() => validateContactInfo(value), [value]);
  const warning = policyMessage ?? moderation.message ?? null;
  const inputStyles = [
    variant === 'boxed' ? styles.fieldInput : null,
    inputStyle,
    style,
    moderation.blocked ? styles.inputBlocked : null,
  ];

  return (
    <View style={containerStyle}>
      {variant === 'boxed' ? (
        <View style={[styles.fieldBox, moderation.blocked && styles.fieldBoxBlocked]}>
          <TextInput
            {...textInputProps}
            value={value}
            onChangeText={onChangeText}
            style={inputStyles}
          />
        </View>
      ) : (
        <TextInput
          {...textInputProps}
          value={value}
          onChangeText={onChangeText}
          style={inputStyles}
        />
      )}
      {moderation.blocked && warning ? (
        <View style={styles.warningRow} accessibilityLiveRegion="polite">
          {showIcon ? (
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.error} />
          ) : null}
          <Text style={styles.warningText}>{warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function useContactInfoValidation(value: string) {
  return useMemo(() => validateContactInfo(value), [value]);
}

const styles = StyleSheet.create({
  fieldBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    overflow: 'hidden',
  },
  fieldBoxBlocked: {
    borderColor: colors.error,
    borderWidth: 2,
  },
  inputBlocked: {
    borderColor: colors.error,
    borderWidth: 2,
  },
  fieldInput: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: 'transparent',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.error,
    fontWeight: '600',
  },
});
