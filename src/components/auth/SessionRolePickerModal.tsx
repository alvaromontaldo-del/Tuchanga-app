import { Modal, StyleSheet, Text, View } from 'react-native';
import { RoleChoiceList } from './RoleChoiceList';
import { sessionRoleForSignup, type SignupRoleId } from '../../constants/sessionRoles';
import { colors, radii, spacing } from '../../constants/theme';
import { useCommerceShell } from '../../context/CommerceShellContext';
import { useUserMode } from '../../context/UserModeContext';
import { navigationRef } from '../../navigation/navigationRef';

/**
 * Cuenta con comercio habilitado: elige Cliente, Profesional o Comercio.
 * Cada opción entra a su módulo (y, si falta el alta profesional, al formulario).
 */
export function SessionRolePickerModal() {
  const { needsRoleChoice, chooseSessionRole } = useCommerceShell();
  const { isWorker } = useUserMode();

  const pick = (role: SignupRoleId) => {
    const sessionRole = sessionRoleForSignup(role);
    void chooseSessionRole(sessionRole).then(() => {
      if (role !== 'professional' || isWorker) return;
      setTimeout(() => {
        if (!navigationRef.isReady()) return;
        navigationRef.navigate('Main', {
          screen: 'Perfil',
          params: { screen: 'WorkerABM' },
        });
      }, 50);
    });
  };

  return (
    <Modal visible={needsRoleChoice} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>¿Cómo querés ingresar?</Text>
          <Text style={styles.sub}>Elegí el rol con el que vas a usar YaChanga.</Text>
          <RoleChoiceList onPick={pick} />
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
});
