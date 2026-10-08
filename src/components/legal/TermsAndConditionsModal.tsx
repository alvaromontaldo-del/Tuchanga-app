import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildTermsDocument } from '../../constants/termsDocument';
import { TERMS_VERSION } from '../../constants/terms';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  /** `read`: consulta desde Cuenta o el registro. `accept`: hay que tocar Acepto para seguir. */
  mode?: 'read' | 'accept';
  onClose?: () => void;
  onAccept?: () => void;
  accepting?: boolean;
  acceptError?: string | null;
};

export function TermsAndConditionsModal({
  visible,
  mode = 'read',
  onClose,
  onAccept,
  accepting = false,
  acceptError = null,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  // Altura fija: con solo maxHeight el ScrollView crece con el texto y el modal lo recorta.
  const sheetHeight = Math.round(windowHeight * 0.92);
  const readOnly = mode !== 'accept';
  const document = useMemo(() => buildTermsDocument(), []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (readOnly) onClose?.();
      }}
    >
      <View style={styles.backdrop}>
        <SafeAreaView
          style={[styles.sheetSafe, { height: sheetHeight }]}
          edges={['bottom', 'left', 'right']}
        >
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>{document.title}</Text>
                <Text style={styles.subtitle}>{document.updatedLabel}</Text>
              </View>
              {readOnly ? (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar términos y condiciones"
                  hitSlop={10}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                >
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.p}>{document.intro}</Text>
              {document.sections.map((section) => (
                <View key={section.title}>
                  <Text style={styles.h}>{section.title}</Text>
                  <Text style={styles.p}>{section.body}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.footer}>
              {readOnly ? (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar"
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
                >
                  <Text style={styles.secondaryBtnText}>Cerrar</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    disabled={accepting}
                    onPress={onAccept}
                    accessibilityRole="button"
                    accessibilityLabel="Acepto los términos y condiciones"
                    accessibilityState={{ disabled: accepting }}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      accepting && styles.primaryBtnDisabled,
                      pressed && !accepting && styles.btnPressed,
                    ]}
                  >
                    {accepting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Acepto</Text>
                    )}
                  </Pressable>
                  {acceptError ? <Text style={styles.error}>{acceptError}</Text> : null}
                  <Text style={styles.disclaimer}>
                    Tenés que aceptar para seguir usando YaChanga. Al tocar Acepto confirmás esta
                    versión ({TERMS_VERSION}).
                  </Text>
                </>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetSafe: { width: '100%' },
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  headerLeft: { flex: 1 },
  title: { fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: -0.2 },
  subtitle: { marginTop: 4, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { opacity: 0.8 },
  body: { flex: 1, minHeight: 0, paddingHorizontal: spacing.lg },
  bodyContent: { paddingBottom: spacing.md },
  h: { marginTop: spacing.md, fontSize: 13, fontWeight: '900', color: colors.text, lineHeight: 18 },
  p: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: Platform.OS === 'ios' ? '600' : '500',
    color: colors.textSecondary,
    lineHeight: 19,
  },
  footer: {
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  secondaryBtn: {
    height: 48,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '900', color: colors.text },
  primaryBtn: {
    height: 48,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
  btnPressed: { opacity: 0.9 },
  error: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
    lineHeight: 16,
  },
  disclaimer: {
    marginTop: spacing.md,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
