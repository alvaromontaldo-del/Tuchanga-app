import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  title: string;
  options: readonly string[];
  /** Valores seleccionados al abrir; al aplicar se confirman */
  initialSelected: string[];
  onClose: () => void;
  onApply: (selected: string[]) => void;
};

/**
 * Lista desplegable (modal) con selección múltiple y acciones Listo / Limpiar.
 */
export function MultiSelectFilterModal({
  visible,
  title,
  options,
  initialSelected,
  onClose,
  onApply,
}: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<string[]>(initialSelected);

  useEffect(() => {
    if (visible) {
      setDraft([...initialSelected]);
    }
  }, [visible, initialSelected]);

  function toggle(value: string) {
    setDraft((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function clearAll() {
    setDraft([]);
  }

  function apply() {
    onApply(draft);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={clearAll} hitSlop={12}>
            <Text style={styles.clearText}>Limpiar</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {options.map((opt) => {
            const on = draft.includes(opt);
            return (
              <Pressable
                key={opt}
                onPress={() => toggle(opt)}
                style={({ pressed }) => [
                  styles.optionRow,
                  pressed && styles.optionPressed,
                ]}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={on ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.optionLabel} numberOfLines={2}>
                  {opt}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable style={styles.applyBtn} onPress={apply}>
            <Text style={styles.applyBtnText}>Listo</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  cancelText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  clearText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  optionPressed: {
    backgroundColor: colors.background,
  },
  optionLabel: {
    fontSize: 17,
    color: colors.text,
    flex: 1,
    marginLeft: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
