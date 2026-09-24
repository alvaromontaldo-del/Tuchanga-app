import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Captura errores de render para que un null inesperado no cierre la app.
 * No cubre errores nativos ni promesas: esas se atienden con try/catch.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[YaChanga] error de render', error?.message, info?.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <RenderErrorFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function RenderErrorFallback({ onRetry }: { onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.safe,
        { paddingTop: Math.max(insets.top, spacing.lg), paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Algo salió mal</Text>
        <Text style={styles.body}>
          Esta pantalla tuvo un problema. Podés reintentar sin cerrar YaChanga.
        </Text>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
        >
          <Text style={styles.btnText}>Reintentar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  pressed: { opacity: 0.88 },
});
