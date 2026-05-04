import { useMemo, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, type KeyboardAvoidingViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  style?: KeyboardAvoidingViewProps['style'];
  /**
   * Override opcional del behavior (solo iOS).
   * En Android se ignora porque ahí controlamos con `androidBehavior` + `enabled`.
   */
  behavior?: KeyboardAvoidingViewProps['behavior'];
  /**
   * Offset extra además de safe area top.
   * Útil si hay header fijo por arriba.
   */
  extraOffset?: number;
  /**
   * En pantallas con header custom que ya maneja el offset.
   */
  keyboardVerticalOffset?: number;
  /**
   * Por defecto Android usa `height`, pero algunas pantallas (chat) necesitan `padding`
   * para que el footer quede siempre arriba del teclado (edge-to-edge + resize).
   */
  androidBehavior?: KeyboardAvoidingViewProps['behavior'];
};

/**
 * KeyboardAvoidingView consistente cross-platform.
 * - iOS: padding (comportamiento esperado)
 * - Android: height (evita que el teclado tape inputs sin romper layouts)
 */
export function AppKeyboardAvoidingView({
  children,
  style,
  behavior,
  extraOffset = 0,
  keyboardVerticalOffset,
  androidBehavior = 'height',
}: Props) {
  const insets = useSafeAreaInsets();

  const offset = useMemo(() => {
    if (typeof keyboardVerticalOffset === 'number') return keyboardVerticalOffset;
    return Math.max(0, insets.top) + extraOffset;
  }, [extraOffset, insets.top, keyboardVerticalOffset]);

  return (
    <KeyboardAvoidingView
      style={style}
      enabled={Platform.OS === 'ios'}
      behavior={Platform.OS === 'ios' ? (behavior ?? 'padding') : androidBehavior}
      keyboardVerticalOffset={offset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

