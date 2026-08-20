import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { BrandLogoHorizontal } from '../../components/brand/BrandMark';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { TextLink } from '../../components/common/TextLink';
import { colors, spacing } from '../../constants/theme';
import { useCommerceShell } from '../../context/CommerceShellContext';
import type { AuthStackScreenProps } from '../../navigation/types';

type Props = AuthStackScreenProps<'RegisterCommerce'>;

/**
 * Entrada al registro de comercio (no el ABM de cliente/trabajador).
 * - Si ya tiene cuenta: ir a Login en modo comercio.
 * - Si es nuevo: usa el registro de usuario y luego el alta del local.
 */
export function RegisterCommerceScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 440);
  const { enterCommerceIntent } = useCommerceShell();
  const [busy, setBusy] = useState(false);

  const goLoginCommerce = async () => {
    setBusy(true);
    try {
      await enterCommerceIntent();
      navigation.navigate('Login', { asCommerce: true });
    } finally {
      setBusy(false);
    }
  };

  const goCreateAccount = async () => {
    setBusy(true);
    try {
      await enterCommerceIntent();
      navigation.navigate('Register', { asCommerce: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen style={styles.flex} edges={['top', 'left', 'right', 'bottom']}>
      <AppKeyboardAvoidingView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { width: contentWidth }]}>
            <View style={styles.brandWrap}>
              <BrandLogoHorizontal variant="hero" maxWidth={contentWidth} style={styles.brandLogo} />
            </View>
            <Text style={styles.title}>Registro de comercio</Text>
            <Text style={styles.subtitle}>
              Los comercios crean una cuenta YaChanga y cargan los datos del local en el mismo
              formulario (nombre, rubros, dirección con GPS y teléfono).
            </Text>

            <AppButton
              title="Ya tengo cuenta — Ingresar"
              onPress={() => void goLoginCommerce()}
              loading={busy}
            />
            <AppButton
              title="Soy nuevo — Crear cuenta de comercio"
              onPress={() => void goCreateAccount()}
              loading={busy}
              variant="secondary"
              style={styles.secondBtn}
            />

            <View style={styles.footerRow}>
              <Text style={styles.muted}>¿Buscás trabajo o contratar? </Text>
              <TextLink
                inline
                onPress={() => navigation.navigate('Login', { asCommerce: false })}
              >
                Ir al login normal
              </TextLink>
            </View>
          </View>
        </ScrollView>
      </AppKeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  card: { alignSelf: 'center' },
  brandWrap: { alignItems: 'center', marginBottom: spacing.md },
  brandLogo: { alignSelf: 'center' },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  secondBtn: { marginTop: spacing.sm },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  muted: { color: colors.textSecondary, fontSize: 15 },
});
