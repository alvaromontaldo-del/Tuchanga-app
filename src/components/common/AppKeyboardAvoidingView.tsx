import { useMemo, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, type KeyboardAvoidingViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  style?: KeyboardAvoidingViewProps['style'];
  /**
   * Override opcional del behavior (solo iOS; por defecto `padding`).
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
   * Solo si `androidEnabled`: `behavior` del KAV en Android. Por defecto `undefined`
   * (preferible con `softwareKeyboardLayoutMode: resize` en app.json).
   */
  androidBehavior?: KeyboardAvoidingViewProps['behavior'];
  /**
   * Activar KAV en Android (casos raros). Con `resize` global suele duplicar offset; dejar en false.
   */
  androidEnabled?: boolean;
};

/**
 * KeyboardAvoidingView consistente cross-platform.
 * - iOS: padding (comportamiento esperado)
 * - Android: por defecto `behavior` undefined y KAV desactivado (`androidEnabled=false`).
 *   Con `android:softwareKeyboardLayoutMode: resize` el sistema ya encoge el window; sumar
 *   `padding`/`height` en KAV suele duplicar offset (hueco enorme sobre el teclado).
 */
export function AppKeyboardAvoidingView({
  children,
  style,
  behavior,
  extraOffset = 0,
  keyboardVerticalOffset,
  androidBehavior,
  androidEnabled = false,
}: Props) {
  const insets = useSafeAreaInsets();

  const offset = useMemo(() => {
    if (typeof keyboardVerticalOffset === 'number') return keyboardVerticalOffset;
    return Math.max(0, insets.top) + extraOffset;
  }, [extraOffset, insets.top, keyboardVerticalOffset]);

  const androidKavBehavior = androidEnabled ? (androidBehavior ?? undefined) : undefined;

  return (
    <KeyboardAvoidingView
      style={style}
      enabled={Platform.OS === 'ios' || androidEnabled}
      behavior={Platform.OS === 'ios' ? (behavior ?? 'padding') : androidKavBehavior}
      keyboardVerticalOffset={offset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

