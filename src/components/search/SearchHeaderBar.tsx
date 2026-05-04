import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogoHorizontal } from '../brand/BrandMark';
import { colors, spacing } from '../../constants/theme';

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  onPressFilters: () => void;
  filtersLabel?: string;
  autoFocus?: boolean;
  onFocusRequest?: () => void;
  onSubmit?: () => void;
  showLogo?: boolean;
  /** HOME: launcher sin teclado; SEARCH: input real */
  mode?: 'launcher' | 'input';
  selectedLabel?: string | null;
  onPressLauncher?: () => void;
  onClearSelected?: () => void;
};

export function SearchHeaderBar({
  value,
  onChangeText,
  placeholder = 'Buscar profesionales u oficios…',
  onPressFilters,
  filtersLabel = 'Filtros',
  autoFocus,
  onFocusRequest,
  onSubmit,
  showLogo = true,
  mode = 'input',
  selectedLabel,
  onPressLauncher,
  onClearSelected,
}: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 120);
    return () => clearTimeout(t);
  }, [autoFocus]);

  return (
    <View
      style={[styles.shell, { paddingTop: insets.top + spacing.sm }]}
      pointerEvents="box-none"
    >
      {showLogo ? (
        <View style={styles.logoRow}>
          <BrandLogoHorizontal variant="hero" maxWidth={200} />
        </View>
      ) : null}

      <View style={[styles.searchShell, focused && styles.searchShellFocused]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        {mode === 'input' ? (
          <TextInput
            ref={(r) => {
              inputRef.current = r;
            }}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
            returnKeyType="search"
            onFocus={() => {
              setFocused(true);
              onFocusRequest?.();
            }}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => {
              Keyboard.dismiss();
              onSubmit?.();
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : (
          <TouchableOpacity
            onPress={onPressLauncher}
            activeOpacity={0.75}
            style={styles.launcherTap}
            accessibilityRole="button"
            accessibilityLabel="Abrir búsqueda"
          >
            <Text style={styles.launcherText} numberOfLines={1}>
              {value?.trim() ? value : placeholder}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={onPressFilters}
          activeOpacity={0.7}
          style={styles.filterBtn}
          accessibilityRole="button"
          accessibilityLabel="Abrir filtros"
        >
          <Ionicons name="options-outline" size={18} color={colors.text} />
          <Text style={styles.filterText}>{filtersLabel}</Text>
        </TouchableOpacity>
      </View>

      {selectedLabel ? (
        <View style={styles.selectedWrap}>
          <Ionicons name="pricetag-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.selectedText} numberOfLines={1}>
            {selectedLabel}
          </Text>
          {onClearSelected ? (
            <TouchableOpacity
              onPress={onClearSelected}
              activeOpacity={0.7}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Quitar oficio seleccionado"
              style={styles.clearChip}
            >
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  logoRow: {
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  searchShell: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  searchShellFocused: {
    borderColor: 'rgba(239, 68, 68, 0.45)',
    shadowOpacity: 0.14,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 0,
  },
  launcherTap: { flex: 1, paddingVertical: 2 },
  launcherText: { fontSize: 16, color: '#111827', fontWeight: '600' },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(17,24,39,0.04)',
  },
  filterText: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 13,
  },
  selectedWrap: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  selectedText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13, flex: 1, minWidth: 0 },
  clearChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,24,39,0.06)',
  },
});

