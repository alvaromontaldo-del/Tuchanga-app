import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { TermsAndConditionsModal } from '../../components/legal/TermsAndConditionsModal';
import { colors, radii, spacing } from '../../constants/theme';
import { TERMS_VERSION } from '../../constants/terms';
import { RoleChoiceList } from '../../components/auth/RoleChoiceList';
import { openAuthModal } from '../../navigation/openAuthModal';
import { registerAuthTarget } from '../../navigation/registerEntry';
import { accountUi } from './accountUi';

/**
 * Tab Perfil sin sesión: login o alta de Cliente, Profesional o Comercio.
 */
export function AccountGuestScreen() {
  const [termsOpen, setTermsOpen] = useState(false);
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

      </View>

      <View style={[accountUi.card, styles.authCard]}>
        <Text style={styles.commerceHint}>Creá tu cuenta. Cada rol entra a su formulario.</Text>
        <RoleChoiceList
          onPick={(role) => {
            const target = registerAuthTarget(role);
            openAuthModal(target.screen, target.params);
          }}
        />
      </View>

      <Pressable
        style={({ pressed }) => [styles.termsBtn, pressed && styles.pressed]}
        onPress={() => setTermsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Términos y condiciones"
      >
        <Ionicons name="document-text-outline" size={22} color={colors.text} />
        <View style={styles.termsText}>
          <Text style={styles.termsTitle}>Términos y condiciones</Text>
          <Text style={styles.termsSub}>Versión {TERMS_VERSION}</Text>
        </View>
      </Pressable>

      <TermsAndConditionsModal
        visible={termsOpen}
        mode="read"
        onClose={() => setTermsOpen(false)}
      />
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
  termsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  termsText: { flex: 1, gap: 2 },
  termsTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  termsSub: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
});
