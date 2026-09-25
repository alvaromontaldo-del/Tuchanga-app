import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (text: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  /**
   * `boxed`: borde propio (publicaciones).
   * `plain`: solo el TextInput con tus estilos (perfil/registro).
   */
  variant?: 'boxed' | 'plain';
};

/**
 * Input de texto libre.
 * La validación anti-contacto se desactivó a propósito (rediseño pendiente):
 * no muestra aviso ni rechaza teléfonos, mails o direcciones.
 */
export function ModeratedTextField({
  value,
  onChangeText,
  containerStyle,
  inputStyle,
  style,
  variant = 'boxed',
  ...textInputProps
}: Props) {
  const inputStyles = [variant === 'boxed' ? styles.fieldInput : null, inputStyle, style];

  return (
    <View style={containerStyle}>
      {variant === 'boxed' ? (
        <View style={styles.fieldBox}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  fieldBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    overflow: 'hidden',
  },
  fieldInput: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: 'transparent',
  },
});
