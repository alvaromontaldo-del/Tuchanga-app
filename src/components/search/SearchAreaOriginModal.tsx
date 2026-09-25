import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchNominatimSuggestions, type NominatimSuggestion } from '../../config/nominatim';
import { addressFromPick } from '../../utils/streetAddressQuery';
import { colors, radii, spacing } from '../../constants/theme';
import { listKey } from '../../utils/safeAsync';

export type PickedSearchOrigin = { lat: number; lng: number; label: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Sesgo de búsqueda Nominatim (GPS o perfil). */
  near?: { lat: number; lng: number };
  onPick: (pick: PickedSearchOrigin) => void;
};

export function SearchAreaOriginModal({ visible, onClose, near, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults([]);
      return;
    }
  }, [visible]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      const reqId = ++reqIdRef.current;
      setSearching(true);
      void (async () => {
        try {
          const suggestions = await fetchNominatimSuggestions(q, {
            countryCode: 'ar',
            near,
          });
          if (reqId !== reqIdRef.current) return;
          setResults(suggestions);
        } catch {
          if (reqId === reqIdRef.current) setResults([]);
        } finally {
          if (reqId === reqIdRef.current) setSearching(false);
        }
      })();
    }, 450);
    return () => clearTimeout(t);
  }, [query, near]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Punto para medir el radio</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Cerrar">
            <Ionicons name="close" size={28} color={colors.text} />
          </Pressable>
        </View>
        <Text style={styles.sheetHint}>
          Escribí calle y ciudad. Los profesionales aparecen si su radio de cobertura alcanza este
          punto.
        </Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Ej. Av. Corrientes 1200, CABA"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="words"
          autoCorrect={false}
        />
        {searching ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item, index) => listKey(item?.id, index, 'lugar')}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={
              query.trim().length >= 4 ? (
                <Text style={styles.empty}>Sin coincidencias. Probá otra redacción.</Text>
              ) : (
                <Text style={styles.empty}>Escribí al menos 4 caracteres.</Text>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => {
                  onPick({
                    lat: item.lat,
                    lng: item.lng,
                    label: addressFromPick(query, item.address),
                  });
                  onClose();
                }}
              >
                <Ionicons name="location-outline" size={22} color={colors.primary} />
                <Text style={styles.rowText} numberOfLines={3}>
                  {addressFromPick(query, item.address)}
                </Text>
              </Pressable>
            )}
          />
        )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    maxHeight: '78%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1 },
  sheetHint: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  input: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  loader: { marginVertical: spacing.lg },
  list: { marginTop: spacing.sm, maxHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { opacity: 0.88 },
  rowText: { flex: 1, fontSize: 15, color: colors.text, lineHeight: 21 },
  empty: { paddingVertical: spacing.lg, fontSize: 14, color: colors.textSecondary },
});
