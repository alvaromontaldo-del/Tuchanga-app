import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { createChatImageSignedUrl } from '../../services/chatMediaSupabase';
import {
  parseChatImageStorageRef,
  resolveChatImageUri,
  signedUrlRefreshDelayMs,
} from '../../utils/chatImageStorage';

type Props = {
  metadata?: Record<string, unknown> | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  onPress?: (uri: string) => void;
  accessibilityLabel?: string;
};

/**
 * Muestra una foto de chat. Si está en Storage, pide una URL firmada y la
 * renueva antes de que venza. Las fotos locales (envío optimista) se ven al toque.
 */
export function ChatStoredImage({
  metadata,
  style,
  resizeMode = 'cover',
  onPress,
  accessibilityLabel = 'Ver imagen ampliada',
}: Props) {
  const ref = parseChatImageStorageRef(metadata);
  const refKey = ref ? `${ref.bucket}/${ref.path}` : '';
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [signFailed, setSignFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ref) return;
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSignFailed(false);
    void (async () => {
      try {
        const signed = await createChatImageSignedUrl(ref);
        if (cancel) return;
        setSignedUrl(signed.url);
        const delay = signedUrlRefreshDelayMs(signed.expiresAtMs, Date.now());
        timer = setTimeout(() => {
          if (!cancel) setTick((n) => n + 1);
        }, delay === 0 ? 5_000 : delay);
      } catch {
        if (cancel) return;
        setSignFailed(true);
        timer = setTimeout(() => {
          if (!cancel) setTick((n) => n + 1);
        }, 15_000);
      }
    })();
    return () => {
      cancel = true;
      if (timer) clearTimeout(timer);
    };
  }, [refKey, tick]);

  const uri = resolveChatImageUri({
    metadata,
    signedUrl: ref ? signedUrl : null,
    signFailed,
  });

  if (!uri) {
    if (ref && !signFailed) return <View style={style} />;
    return <Text>Imagen no disponible</Text>;
  }

  const image = <Image source={{ uri }} style={style} resizeMode={resizeMode} />;
  if (!onPress) return image;
  return (
    <Pressable
      onPress={() => onPress(uri)}
      accessibilityRole="imagebutton"
      accessibilityLabel={accessibilityLabel}
    >
      {image}
    </Pressable>
  );
}
