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
  findRubroByNombre,
  getCategoriasSortedByPopularidad,
  type RubroServicio,
} from '../../data/rubrosCatalog';
import { filterCategoriasForQuery } from '../../utils/rubroSearch';

/** slug presente = rubro del catálogo; sin slug = texto libre heredado. */
export type TradePickResult = {
  nombre: string;
  slug?: string;
  categoriaNombre?: string;
};

type Props = {
  visible: boolean;
  title: string;
  /** Nombre del rubro ya guardado (puede ser texto libre heredado). */
  initialNombre: string | null;
  onClose: () => void;
  onApply: (picked: TradePickResult | null) => void;
};

export function TradeSearchModal({
  visible,
  title,
  initialNombre,
  onClose,
  onApply,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<TradePickResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    const trimmed = initialNombre?.trim() ?? '';
    if (!trimmed) {
      setDraft(null);
      return;
    }
    const found = findRubroByNombre(trimmed);
    if (found) {
      setDraft({
        nombre: found.servicio.nombre,
        slug: found.servicio.slug,
        categoriaNombre: found.categoria.nombre,
      });
    } else {
      setDraft({ nombre: trimmed });
    }
  }, [visible, initialNombre]);

  const sections = useMemo(() => {
    const cats = getCategoriasSortedByPopularidad();
    return filterCategoriasForQuery(cats, query);
  }, [query]);

  function selectServicio(s: RubroServicio, categoriaNombre: string) {
    setDraft({
      nombre: s.nombre,
      slug: s.slug,
      categoriaNombre,
    });
  }

  function applyAndClose() {
    const n = draft?.nombre?.trim();
    if (!n) onApply(null);
    else if (draft?.slug)
      onApply({
        nombre: draft.nombre,
        slug: draft.slug,
        categoriaNombre: draft.categoriaNombre ?? '',
      });
    else onApply({ nombre: n });
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
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {title}
          </Text>
          <Pressable onPress={applyAndClose} hitSlop={12}>
            <Text style={styles.applyText}>Listo</Text>
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar rubro o palabra clave…"
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

        {draft?.nombre && draft.slug == null ? (
          <View style={styles.legacyBanner}>
            <Text style={styles.legacyText}>
              Rubro no catalogado: «{draft.nombre}». Elegí uno de la lista para normalizar.
            </Text>
          </View>
        ) : null}

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.slug}
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
          renderItem={({ item, section }) => {
            const on =
              draft?.slug === item.slug ||
              (draft?.slug == null && draft?.nombre === item.nombre);
            return (
              <Pressable
                onPress={() => selectServicio(item, section.title)}
                style={({ pressed }) => [styles.optionRow, pressed && styles.optionPressed]}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={on ? colors.primary : colors.textSecondary}
                />
                <View style={styles.optionBody}>
                  <Text style={styles.optionLabel} numberOfLines={2}>
                    {item.nombre}
                  </Text>
                </View>
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
          <Pressable
            style={styles.clearBtn}
            onPress={() => {
              setDraft(null);
              onApply(null);
              onClose();
            }}
          >
            <Text style={styles.clearBtnText}>Limpiar selección</Text>
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
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1, textAlign: 'center' },
  cancelText: { fontSize: 16, color: colors.textSecondary, fontWeight: '700', width: 72 },
  applyText: { fontSize: 16, color: colors.primary, fontWeight: '800', width: 72, textAlign: 'right' },
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
  legacyBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  legacyText: { fontSize: 13, fontWeight: '600', color: '#92400E', lineHeight: 18 },
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
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  optionPressed: { backgroundColor: colors.background },
  optionBody: { flex: 1 },
  optionLabel: { fontSize: 16, color: colors.text, fontWeight: '700' },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  clearBtn: {
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  clearBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '700' },
});
