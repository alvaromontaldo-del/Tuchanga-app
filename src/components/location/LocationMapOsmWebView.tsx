import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { osmTileUrlTemplate } from '../../config/nominatim';
import { colors, radii, spacing } from '../../constants/theme';
import type { LocationMapProps } from './locationMapTypes';

function buildMapHtml(
  lat: number,
  lng: number,
  coverageMeters: number,
  showCoverage: boolean,
  tileUrl: string,
) {
  const radius = showCoverage && coverageMeters > 0 ? coverageMeters : 0;
  const safeTileUrl = tileUrl.replace(/'/g, "\\'");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <style>
    html, body, #map { margin: 0; height: 100%; width: 100%; }
    .leaflet-control-attribution { font-size: 9px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function() {
      var map = L.map('map', { zoomControl: true }).setView([${lat}, ${lng}], 14);
      L.tileLayer('${safeTileUrl}', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
      var marker = L.marker([${lat}, ${lng}], { draggable: true }).addTo(map);
      var circle = ${radius > 0 ? `L.circle([${lat}, ${lng}], { radius: ${radius}, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.12, weight: 2 }).addTo(map);` : 'null'};
      marker.on('dragend', function(e) {
        var p = e.target.getLatLng();
        if (circle) circle.setLatLng(p);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'move', lat: p.lat, lng: p.lng }));
        }
      });
      window.setMapCenter = function(lat, lng, radiusM) {
        var ll = [lat, lng];
        marker.setLatLng(ll);
        map.setView(ll, map.getZoom() < 10 ? 14 : map.getZoom());
        if (circle) {
          if (radiusM > 0) {
            circle.setLatLng(ll);
            circle.setRadius(radiusM);
          } else {
            map.removeLayer(circle);
            circle = null;
          }
        } else if (radiusM > 0) {
          circle = L.circle(ll, { radius: radiusM, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.12, weight: 2 }).addTo(map);
        }
      };
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    })();
  </script>
</body>
</html>`;
}

/**
 * Mapa interactivo con OpenStreetMap (Leaflet en WebView).
 * Gratuito: sin Google Maps SDK ni facturación por map loads en Android.
 * Requiere `react-native-webview` en el dev build (EAS).
 */
export function LocationMapOsmWebView({
  geo,
  coverageMeters,
  showCoverage,
  onPinMoved,
  onLocateMe,
  locating,
}: LocationMapProps) {
  const webRef = useRef<WebView>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const tileUrl = osmTileUrlTemplate();

  const html = useMemo(
    () => buildMapHtml(geo.lat, geo.lng, coverageMeters, showCoverage, tileUrl),
    [geo.lat, geo.lng, coverageMeters, showCoverage, tileUrl],
  );

  const radius = showCoverage && coverageMeters > 0 ? coverageMeters : 0;

  const syncCenter = useCallback(() => {
    if (!mapReady) return;
    webRef.current?.injectJavaScript(
      `window.setMapCenter(${geo.lat}, ${geo.lng}, ${radius}); true;`,
    );
  }, [geo.lat, geo.lng, mapReady, radius]);

  useEffect(() => {
    syncCenter();
  }, [syncCenter]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(e.nativeEvent.data) as {
          type?: string;
          lat?: number;
          lng?: number;
        };
        if (data.type === 'ready') {
          setMapReady(true);
          setLoadError(false);
          return;
        }
        if (data.type === 'move' && typeof data.lat === 'number' && typeof data.lng === 'number') {
          onPinMoved(data.lat, data.lng);
        }
      } catch {
        /* */
      }
    },
    [onPinMoved],
  );

  if (loadError) {
    return (
      <View style={[styles.wrap, styles.fallback]}>
        <Text style={styles.fallbackTitle}>No se pudo cargar el mapa</Text>
        <Text style={styles.fallbackBody}>
          Verificá conexión a internet (OpenStreetMap) y volvé a abrir la pantalla.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost' }}
        onMessage={onMessage}
        onLoadEnd={() => {
          setMapReady(true);
          syncCenter();
        }}
        onError={() => setLoadError(true)}
        onHttpError={() => setLoadError(true)}
        style={styles.map}
        scrollEnabled={false}
        nestedScrollEnabled
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        androidLayerType="hardware"
      />
      {!mapReady ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}
      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable
          onPress={onLocateMe}
          disabled={!onLocateMe || locating}
          style={[styles.locateBtn, (!onLocateMe || locating) && styles.locateBtnDisabled]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Ubicarme"
        >
          {locating ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <Text style={styles.locateText}>Ubicarme</Text>
          )}
        </Pressable>
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
  map: {
    width: '100%',
    height: 220,
    backgroundColor: '#e5e7eb',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.md,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
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
  locateBtnDisabled: { opacity: 0.6 },
  locateText: { fontSize: 13, fontWeight: '900', color: '#111827' },
  fallback: {
    minHeight: 220,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  fallbackTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  fallbackBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
});
