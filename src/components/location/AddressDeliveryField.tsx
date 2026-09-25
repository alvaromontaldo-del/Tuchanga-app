import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchNominatimSuggestions, reverseNominatimStreet } from '../../config/nominatim';
import {
  activeStreetQuery,
  isIgnorableAddressEcho,
  visibleSuggestionAddress,
} from '../../utils/streetAddressQuery';
import { colors, radii, spacing } from '../../constants/theme';
import { getHighAccuracyPosition } from '../../utils/deviceGeolocation';

export type DeliveryGeoPoint = {
  address: string;
  lat: number;
  lng: number;
  /** Calle OSM sin altura inyectada. No se persiste: solo rotula el listado. */
  plainAddress?: string;
};

type Props = {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  geo: DeliveryGeoPoint | null;
  onGeoChange: (geo: DeliveryGeoPoint | null) => void;
  placeholder?: string;
  near?: { lat: number; lng: number } | null;
};

/**
 * Autocomplete + GPS de dirección.
 * La búsqueda es la misma que en registro (`RegisterScreen`), modificación de datos
 * (`EditRegistrationScreen`) y el origen del radio (`SearchAreaOriginModal`).
 * El ABM profesional no geocodifica: usa el domicilio guardado en el perfil.
 */
export function AddressDeliveryField({
  label = 'Dirección de entrega',
  value,
  onChangeText,
  geo,
  onGeoChange,
  placeholder = 'Calle, altura, localidad',
  near,
}: Props) {
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [results, setResults] = useState<DeliveryGeoPoint[]>([]);
  const [devicePos, setDevicePos] = useState<{ lat: number; lng: number } | null>(near ?? null);
  const requestIdRef = useRef(0);
  const skipGeocodeRef = useRef<string | null>(null);
  const typedQueryRef = useRef<string | null>(null);
  const programmaticQueryRef = useRef<string | null>(null);
  const echoUntilRef = useRef(0);

  const commitText = useCallback((next: string) => {
    programmaticQueryRef.current = next.trim();
    echoUntilRef.current = Date.now() + 500;
    skipGeocodeRef.current = next.trim();
    onChangeText(next);
  }, [onChangeText]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getHighAccuracyPosition();
      if (!cancelled && res.ok) setDevicePos(res.position);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runGeocode = useCallback(
    async (qRaw: string) => {
      const q = qRaw.trim();
      if (q.length < 4) {
        setResults([]);
        return;
      }
      const reqId = ++requestIdRef.current;
      setSearching(true);
      try {
        const suggestions = await fetchNominatimSuggestions(q, {
          countryCode: 'ar',
          near: near ?? devicePos ?? undefined,
        });
        if (reqId !== requestIdRef.current) return;
        setResults(
          suggestions.map((s) => ({
            address: s.address,
            plainAddress: s.plainAddress,
            lat: s.lat,
            lng: s.lng,
          })),
        );
      } catch {
        if (reqId === requestIdRef.current) setResults([]);
      } finally {
        if (reqId === requestIdRef.current) setSearching(false);
      }
    },
    [devicePos, near],
  );

  useEffect(() => {
    const q = value.trim();
    if (skipGeocodeRef.current === q) {
      skipGeocodeRef.current = null;
      return;
    }
    const t = setTimeout(() => void runGeocode(q), 450);
    return () => clearTimeout(t);
  }, [value, runGeocode]);

  const locateMe = useCallback(async () => {
    setLocating(true);
    try {
      const result = await getHighAccuracyPosition();
      if (!result.ok) return;
      const { lat, lng } = result.position;
      setDevicePos({ lat, lng });
      typedQueryRef.current = null;
      let address = value.trim();
      try {
        const rev = await reverseNominatimStreet(lat, lng);
        if (rev) {
          address = rev;
          commitText(rev);
        }
      } catch {
        /* keep text */
      }
      onGeoChange({ address: address || 'Ubicación actual', lat, lng });
      setResults([]);
    } finally {
      setLocating(false);
    }
  }, [commitText, onGeoChange, value]);

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <TextInput
            style={styles.searchInput}
            value={value}
            onChangeText={(t) => {
              if (
                isIgnorableAddressEcho(
                  t,
                  programmaticQueryRef.current,
                  typedQueryRef.current,
                  Date.now(),
                  echoUntilRef.current,
                )
              ) {
                return;
              }
              typedQueryRef.current = t;
              programmaticQueryRef.current = null;
              onChangeText(t);
              onGeoChange(null);
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="sentences"
            maxLength={240}
          />
        </View>
        <Pressable
          style={styles.searchBtn}
          onPress={() => void runGeocode(value)}
          accessibilityRole="button"
          accessibilityLabel="Buscar dirección"
        >
          {searching ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons name="search" size={18} color={colors.text} />
          )}
        </Pressable>
      </View>

      <Pressable
        onPress={() => void locateMe()}
        disabled={locating}
        style={({ pressed }) => [styles.gpsLink, pressed && styles.pressed]}
      >
        <Ionicons name="locate-outline" size={16} color={colors.primary} />
        <Text style={styles.gpsLinkText}>
          {locating ? 'Obteniendo GPS…' : 'Usar ubicación actual'}
        </Text>
      </Pressable>

      {results.length > 0 ? (
        <View style={styles.results}>
          {results.map((r) => {
            const label = visibleSuggestionAddress(value, typedQueryRef.current, r);
            return (
            <Pressable
              key={`${r.lat}-${r.lng}-${r.plainAddress ?? r.address}`}
              style={styles.resultRow}
              onPress={() => {
                const typed = activeStreetQuery(value, typedQueryRef.current);
                typedQueryRef.current = typed;
                commitText(label);
                onGeoChange({ address: label, lat: r.lat, lng: r.lng });
                setResults([]);
              }}
            >
              <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
              <View style={styles.resultText}>
                <Text style={styles.resultTitle} numberOfLines={2}>
                  {label}
                </Text>
                <Text style={styles.resultHint}>
                  {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                </Text>
              </View>
            </Pressable>
            );
          })}
        </View>
      ) : null}

      {geo ? (
        <View style={styles.geoPill}>
          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
          <Text style={styles.geoText} numberOfLines={2}>
            {geo.address} · {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, gap: 8 },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  searchInput: {
    fontSize: 15,
    color: colors.text,
    paddingVertical: 10,
  },
  searchBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  gpsLinkText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultText: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  resultHint: { marginTop: 2, fontSize: 11, color: colors.textSecondary },
  geoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: '#E8F5E9',
  },
  geoText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#1B5E20' },
  pressed: { opacity: 0.75 },
});
