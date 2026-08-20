import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { colors, radii, spacing } from '../../constants/theme';
import { openAuthModal } from '../../navigation/openAuthModal';
import { accountUi } from './accountUi';

/**
 * Tab Perfil sin sesión: login / registro. El modo comercio vive en el Login.
 */
export function AccountGuestScreen() {
  return (
    <AppScreen style={accountUi.screenBg} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.pageHeader}>
        <Text style={[accountUi.pageTitle, styles.centerText]}>Perfil</Text>
        <Text style={[accountUi.pageSubtitle, styles.centerText]}>
          Iniciá sesión o creá una cuenta para usar el chat, publicar y guardar tu perfil.
        </Text>
      </View>

      <View style={[accountUi.card, styles.authCard]}>
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={() => openAuthModal('Login')}
          accessibilityRole="button"
          accessibilityLabel="Iniciar sesión"
        >
          <Ionicons name="log-in-outline" size={22} color="#fff" />
          <Text style={styles.primaryBtnText}>Iniciar sesión</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={() => openAuthModal('Register')}
          accessibilityRole="button"
          accessibilityLabel="Crear cuenta"
        >
          <Text style={styles.secondaryBtnText}>Crear cuenta</Text>
        </Pressable>
      </View>

      <View style={[accountUi.card, styles.authCard]}>
        <Text style={styles.commerceHint}>
          ¿Tenés un corralón, ferretería u otro local? En el login marcá “Soy comercio”.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.commerceBtn, pressed && styles.pressed]}
          onPress={() => openAuthModal('Login', { asCommerce: true })}
          accessibilityRole="button"
          accessibilityLabel="Ir al login como comercio"
        >
          <Ionicons name="storefront-outline" size={22} color={colors.primary} />
          <Text style={styles.commerceBtnText}>Ir al login de comercio</Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  centerText: { textAlign: 'center' },
  authCard: {
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.button,
  },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radii.button,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  secondaryBtnText: { fontSize: 16, fontWeight: '800', color: colors.primary },
  commerceHint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    textAlign: 'center',
  },
  commerceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  commerceBtnText: { fontSize: 16, fontWeight: '800', color: colors.primary },
  pressed: { opacity: 0.9 },
});
