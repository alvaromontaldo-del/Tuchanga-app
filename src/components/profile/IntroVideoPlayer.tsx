import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import { isLocalVideoUri } from '../../utils/introVideo';
import { canPlayIntroVideo } from '../../utils/introVideoNative';

type WebViewComponent = typeof import('react-native-webview').WebView;

type Props = {
  uri: string;
  /** Alto fijo del reproductor. */
  height?: number;
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function videoHtml(uri: string): string {
  const src = escapeAttr(uri);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>
  html, body { margin: 0; height: 100%; background: #111; }
  video { width: 100%; height: 100%; object-fit: contain; background: #111; }
</style>
</head>
<body>
<video src="${src}" controls playsinline webkit-playsinline autoplay></video>
</body>
</html>`;
}

function directoryOf(uri: string): string {
  const clean = uri.split('?')[0] ?? uri;
  const slash = clean.lastIndexOf('/');
  return slash >= 0 ? clean.slice(0, slash + 1) : clean;
}

function originOf(uri: string): string | undefined {
  const match = uri.match(/^(https?:\/\/[^/]+)/i);
  return match?.[1];
}

function loadWebView(): WebViewComponent | null {
  try {
    return require('react-native-webview').WebView as WebViewComponent;
  } catch {
    return null;
  }
}

/**
 * Reproduce con el WebView que ya está en el binario (no hay expo-av ni expo-video).
 * Si el módulo nativo no está, no renderiza nada.
 */
export function IntroVideoPlayer({ uri, height = 220 }: Props) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = uri.trim();
  const local = isLocalVideoUri(source);
  const html = useMemo(() => (source ? videoHtml(source) : ''), [source]);
  const baseUrl = local ? directoryOf(source) : originOf(source);
  const WebView = useMemo(() => (canPlayIntroVideo() ? loadWebView() : null), []);

  if (!source || !WebView) return null;

  return (
    <View style={[styles.frame, { height }]}>
      {playing && !failed ? (
        <WebView
          source={{ html, baseUrl }}
          style={styles.web}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          allowFileAccess
          allowingReadAccessToURL={baseUrl}
          originWhitelist={['*']}
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          onError={() => setFailed(true)}
          onHttpError={() => setFailed(true)}
          renderError={() => (
            <View style={styles.fallback}>
              <Text style={styles.fallbackText}>No se pudo reproducir el video.</Text>
            </View>
          )}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.fallback}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        />
      ) : (
        <Pressable
          style={styles.poster}
          onPress={() => {
            if (failed) return;
            setPlaying(true);
          }}
          disabled={failed}
          accessibilityRole="button"
          accessibilityLabel="Reproducir video de presentación"
        >
          <View style={styles.playCircle}>
            <Ionicons name="play" size={28} color="#fff" style={styles.playIcon} />
          </View>
          <Text style={styles.posterText}>
            {failed ? 'No se pudo reproducir el video' : 'Video de presentación'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: spacing.md,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  web: { flex: 1, backgroundColor: '#111' },
  poster: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { marginLeft: 3 },
  posterText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    padding: spacing.md,
  },
  fallbackText: { color: '#fff', textAlign: 'center' },
});
