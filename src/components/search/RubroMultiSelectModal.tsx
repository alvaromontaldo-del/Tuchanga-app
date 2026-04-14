import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';
import {
  getCategoriasSortedByPopularidad,
  type RubroServicio,
} from '../../data/rubrosCatalog';
import { filterCategoriasForQuery } from '../../utils/rubroSearch';

type Props = {
  visible: boolean;
  title: string;
  initialSelected: string[];
  onClose: () => void;
  onApply: (selected: string[]) => void;
};

export function RubroMultiSelectModal({
  visible,
  title,
  initialSelected,
  onClose,
  onApply,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setDraft([...initialSelected]);
    }
  }, [visible, initialSelected]);

  const sections = useMemo(() => {
    const cats = getCategoriasSortedByPopularidad();
    return filterCategoriasForQuery(cats, query);
  }, [query]);

  function toggle(nombre: string) {
    setDraft((prev) =>
      prev.includes(nombre) ? prev.filter((x) => x !== nombre) : [...prev, nombre],
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

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar oficio o palabra clave…"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item: RubroServicio) => item.slug}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const on = draft.includes(item.nombre);
            return (
              <Pressable
                onPress={() => toggle(item.nombre)}
                style={({ pressed }) => [styles.optionRow, pressed && styles.optionPressed]}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={on ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.optionLabel} numberOfLines={2}>
                  {item.nombre}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No hay rubros que coincidan.</Text>
            </View>
          }
        />

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
  sheet: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  cancelText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
  clearText: { fontSize: 16, color: colors.primary, fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  list: { flex: 1, marginTop: spacing.sm },
  listContent: { paddingTop: spacing.xs },
  sectionHeader: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  optionPressed: { backgroundColor: colors.background },
  optionLabel: { fontSize: 17, color: colors.text, flex: 1, marginLeft: spacing.md },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
