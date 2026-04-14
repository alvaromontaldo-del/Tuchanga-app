import { Circle, GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { getGoogleMapsWebApiKey } from '../../config/googleMaps';
import { colors, radii, spacing } from '../../constants/theme';

export type LocationMapGeo = { lat: number; lng: number };

type Props = {
  geo: LocationMapGeo;
  coverageMeters: number;
  showCoverage: boolean;
  onPinMoved: (lat: number, lng: number) => void;
  onLocateMe?: () => void;
  locating?: boolean;
};

const mapContainerStyle: CSSProperties = {
  width: '100%',
  height: 220,
};

type InnerProps = Props & { apiKey: string };

function LocationMapGoogleInner({
  apiKey,
  geo,
  coverageMeters,
  showCoverage,
  onPinMoved,
}: InnerProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'tuchanga-google-maps',
    googleMapsApiKey: apiKey,
  });

  const center = useMemo(
    () => ({ lat: geo.lat, lng: geo.lng }),
    [geo.lat, geo.lng],
  );

  if (loadError) {
    return (
      <View style={styles.mapSlot}>
        <Text style={styles.fallbackText}>
          No se pudo cargar Google Maps. Verificá la API key, la facturación en Google Cloud y que la
          API &quot;Maps JavaScript API&quot; esté habilitada.
        </Text>
      </View>
    );
  }

  if (!isLoaded) {
    return (
      <View style={[styles.mapSlot, styles.mapSlotCenter]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={center}
      zoom={14}
      options={{
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        rotateControl: false,
        gestureHandling: 'greedy',
      }}
    >
      <Marker
        position={center}
        draggable
        onDragEnd={(e) => {
          const lat = e.latLng?.lat();
          const lng = e.latLng?.lng();
          if (lat != null && lng != null) onPinMoved(lat, lng);
        }}
      />
      {showCoverage && coverageMeters > 0 ? (
        <Circle
          center={center}
          radius={coverageMeters}
          options={{
            strokeColor: '#EF4444',
            strokeOpacity: 0.55,
            strokeWeight: 2,
            fillColor: '#EF4444',
            fillOpacity: 0.12,
          }}
        />
      ) : null}
    </GoogleMap>
  );
}

export function LocationMap({
  geo,
  coverageMeters,
  showCoverage,
  onPinMoved,
  onLocateMe,
  locating,
}: Props) {
  const apiKey = getGoogleMapsWebApiKey();
  const km = Math.round((coverageMeters / 1000) * 10) / 10;

  if (!apiKey) {
    return (
      <View style={[styles.wrap, styles.fallbackPadding]}>
        <Text style={styles.title}>Mapa</Text>
        <Text style={styles.fallbackText}>
          En web el mapa usa Google Maps. Agregá en la raíz del proyecto (archivo .env):
          {'\n\n'}
          EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=tu_clave
          {'\n\n'}
          Reiniciá el servidor de Expo tras guardar. En Google Cloud: habilitá &quot;Maps JavaScript
          API&quot; y, para desarrollo local, restringí la clave por referrer (ej.{' '}
          http://localhost:8081/*).
        </Text>
        <Text style={styles.coords}>
          Coordenadas: {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}
        </Text>
        {showCoverage && coverageMeters > 0 ? (
          <Text style={styles.coords}>Radio de cobertura: {km} km</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.mapOuter}>
        <LocationMapGoogleInner
          apiKey={apiKey}
          geo={geo}
          coverageMeters={coverageMeters}
          showCoverage={showCoverage}
          onPinMoved={onPinMoved}
        />
        <View style={styles.overlay}>
          <Pressable
            onPress={onLocateMe}
            disabled={!onLocateMe || locating}
            style={[styles.locateBtn, (!onLocateMe || locating) && styles.locateBtnDisabled]}
            hitSlop={10}
          >
            {locating ? (
              <ActivityIndicator color="#111827" />
            ) : (
              <Text style={styles.locateText}>Ubicarme</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    borderRadius: radii.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fallbackPadding: { padding: spacing.md },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
  },
  mapOuter: {
    position: 'relative',
    width: '100%',
  },
  mapSlot: {
    width: '100%',
    height: 220,
    padding: spacing.md,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  mapSlotCenter: {
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.md,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    pointerEvents: 'box-none',
  },
  locateBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  locateBtnDisabled: {
    opacity: 0.6,
  },
  locateText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111827',
  },
  fallbackText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 18,
  },
  coords: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 8,
  },
});
