import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';

export type ToastVariant = 'success' | 'info' | 'warning' | 'error';

export type ToastInput = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  /** ms visible (sin contar animación). Default: 2600 */
  durationMs?: number;
};

type ToastInternal = Required<Pick<ToastInput, 'message'>> &
  Pick<ToastInput, 'title'> & {
    id: string;
    variant: ToastVariant;
    durationMs: number;
  };

type ToastContextValue = {
  show: (t: ToastInput) => void;
  dismiss: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function variantStyle(variant: ToastVariant) {
  switch (variant) {
    case 'success':
      return { dot: '#16A34A', border: 'rgba(22,163,74,0.22)' };
    case 'warning':
      return { dot: '#D97706', border: 'rgba(217,119,6,0.22)' };
    case 'error':
      return { dot: '#DC2626', border: 'rgba(220,38,38,0.22)' };
    case 'info':
    default:
      return { dot: colors.primary, border: 'rgba(198,40,40,0.18)' };
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastInternal | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [anim]);

  const show = useCallback(
    (t: ToastInput) => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      const next: ToastInternal = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: t.title,
        message: t.message,
        variant: t.variant ?? 'info',
        durationMs: t.durationMs ?? 2600,
      };

      setToast(next);
      anim.stopAnimation();
      anim.setValue(0);

      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();

      hideTimer.current = setTimeout(() => {
        dismiss();
      }, next.durationMs);
    },
    [anim, dismiss],
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  const y = anim.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const chromeTop = Math.max(insets.top, spacing.sm) + spacing.xs;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.host,
              { top: chromeTop, opacity, transform: [{ translateY: y }] },
            ]}
          >
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Cerrar notificación"
              style={({ pressed }) => [
                styles.toast,
                pressed && styles.toastPressed,
                { borderColor: variantStyle(toast.variant).border },
              ]}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: variantStyle(toast.variant).dot },
                ]}
              />
              <View style={styles.body}>
                {toast.title ? <Text style={styles.title}>{toast.title}</Text> : null}
                <Text style={styles.msg} numberOfLines={3}>
                  {toast.message}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  toastPressed: { opacity: 0.92 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '900', color: colors.text, marginBottom: 2 },
  msg: { fontSize: 14, color: colors.textSecondary, lineHeight: 19 },
});

