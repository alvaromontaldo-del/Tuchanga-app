import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogoHorizontal } from '../brand/BrandMark';
import { colors, spacing } from '../../constants/theme';
import {
  SEARCH_PLACEHOLDER,
  SEARCH_PLACEHOLDER_MIN_FONT,
  SEARCH_PLACEHOLDER_MAX_FONT,
  searchHeaderLayout,
  searchPlaceholderFontSize,
} from '../../utils/searchPlaceholder';
import { ATIENDE_URGENCIAS_FILTER } from '../../utils/urgencias';

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
  /** Chip opcional de la búsqueda de profesionales. Home no lo usa. */
  urgenciasFilter?: { active: boolean; onToggle: () => void } | null;
};

export function SearchHeaderBar({
  value,
  onChangeText,
  placeholder = SEARCH_PLACEHOLDER,
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
  urgenciasFilter,
}: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);
  const [focused, setFocused] = useState(false);
  const [slotWidth, setSlotWidth] = useState(0);
  const hasQuery = mode === 'input' ? value.length > 0 : Boolean(value.trim());
  const placeholderFontSize = searchPlaceholderFontSize(slotWidth, placeholder);
  const placeholderScale = SEARCH_PLACEHOLDER_MIN_FONT / SEARCH_PLACEHOLDER_MAX_FONT;

  const onQuerySlotLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    setSlotWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  };

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
        <Ionicons
          name="search-outline"
          size={searchHeaderLayout.searchIcon}
          color={colors.textSecondary}
        />
        <View style={styles.querySlot} onLayout={onQuerySlotLayout}>
          {mode === 'input' ? (
            <>
              {hasQuery ? null : (
                <View pointerEvents="none" style={styles.placeholderLayer}>
                  <Text
                    accessible={false}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={placeholderScale}
                    style={[
                      styles.placeholderText,
                      { fontSize: placeholderFontSize, width: slotWidth || '100%' },
                    ]}
                  >
                    {placeholder}
                  </Text>
                </View>
              )}
              <TextInput
                ref={(r) => {
                  inputRef.current = r;
                }}
                value={value}
                onChangeText={onChangeText}
                placeholder=""
                accessibilityLabel={placeholder}
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
            </>
          ) : (
            <TouchableOpacity
              onPress={onPressLauncher}
              activeOpacity={0.75}
              style={styles.launcherTap}
              accessibilityRole="button"
              accessibilityLabel="Abrir búsqueda"
            >
              <Text
                style={[
                  styles.launcherText,
                  !hasQuery && { fontSize: placeholderFontSize, width: slotWidth || '100%' },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit={!hasQuery}
                minimumFontScale={placeholderScale}
              >
                {hasQuery ? value : placeholder}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          onPress={onPressFilters}
          activeOpacity={0.7}
          style={styles.filterBtn}
          accessibilityRole="button"
          accessibilityLabel="Abrir filtros"
        >
          <Ionicons name="options-outline" size={searchHeaderLayout.filterIcon} color={colors.text} />
          <Text style={styles.filterText}>{filtersLabel}</Text>
        </TouchableOpacity>
      </View>

      {urgenciasFilter ? (
        <TouchableOpacity
          onPress={urgenciasFilter.onToggle}
          activeOpacity={0.75}
          style={[styles.urgChip, urgenciasFilter.active && styles.urgChipOn]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: urgenciasFilter.active }}
          accessibilityLabel={ATIENDE_URGENCIAS_FILTER}
        >
          <Ionicons
            name="flash"
            size={14}
            color={urgenciasFilter.active ? '#FFFFFF' : '#E65100'}
          />
          <Text style={[styles.urgChipText, urgenciasFilter.active && styles.urgChipTextOn]}>
            {ATIENDE_URGENCIAS_FILTER}
          </Text>
        </TouchableOpacity>
      ) : null}

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
    paddingHorizontal: searchHeaderLayout.shellPaddingH,
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
    gap: searchHeaderLayout.searchGap,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: searchHeaderLayout.searchPaddingH,
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
  querySlot: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  placeholderLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
  },
  placeholderText: {
    color: colors.textSecondary,
    includeFontPadding: false,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 0,
  },
  launcherTap: { flex: 1, minWidth: 0, paddingVertical: 2, justifyContent: 'center' },
  launcherText: { fontSize: 16, color: '#111827', fontWeight: '600', includeFontPadding: false },
  filterBtn: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: searchHeaderLayout.filterGap,
    paddingVertical: 8,
    paddingHorizontal: searchHeaderLayout.filterPadH,
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
  urgChip: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E65100',
    backgroundColor: '#FFFFFF',
  },
  urgChipOn: {
    backgroundColor: '#E65100',
  },
  urgChipText: {
    color: '#E65100',
    fontWeight: '800',
    fontSize: 13,
  },
  urgChipTextOn: {
    color: '#FFFFFF',
  },
});

