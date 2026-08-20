import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import { useCommerceShell, type SessionRole } from '../../context/CommerceShellContext';

/**
 * Provisional: mismo email puede ser cliente/trabajador y comercio.
 * Obliga a elegir con qué rol entrar.
 */
export function SessionRolePickerModal() {
  const { needsRoleChoice, chooseSessionRole, primaryStore } = useCommerceShell();

  const pick = (role: SessionRole) => {
    void chooseSessionRole(role);
  };

  return (
    <Modal visible={needsRoleChoice} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>¿Cómo querés ingresar?</Text>
          <Text style={styles.sub}>
            Esta cuenta tiene perfil de usuario
            {primaryStore ? ` y el comercio “${primaryStore.name}”` : ' y un comercio registrado'}.
            Elegí el módulo (provisorio para testing).
          </Text>

          <Pressable
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            onPress={() => pick('client')}
            accessibilityRole="button"
            accessibilityLabel="Entrar como cliente o profesional"
          >
            <Ionicons name="people-outline" size={26} color={colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Cliente / Profesional</Text>
              <Text style={styles.optionSub}>Chat, trabajos, publicaciones</Text>
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            onPress={() => pick('commerce')}
            accessibilityRole="button"
            accessibilityLabel="Entrar como comercio"
          >
            <Ionicons name="storefront-outline" size={26} color={colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Comercio</Text>
              <Text style={styles.optionSub}>Pedidos de materiales y cotizaciones</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: '900', color: colors.text },
  sub: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  optionSub: { fontSize: 13, color: colors.textSecondary },
  pressed: { opacity: 0.9 },
});
