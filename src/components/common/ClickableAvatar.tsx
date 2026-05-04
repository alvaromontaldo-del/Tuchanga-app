import { useMemo, useState } from 'react';
import { Image, Pressable, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { ImageLightboxModal } from './ImageLightboxModal';

type Props = {
  uri?: string | null;
  style: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Si el estilo del Image es 100% (fill), setear true para que el wrapper también mida 100%. */
  fill?: boolean;
};

export function ClickableAvatar({
  uri,
  style,
  containerStyle,
  accessibilityLabel = 'Ver foto de perfil ampliada',
  disabled = false,
  fill = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const photos = useMemo(() => (open && uri ? [uri] : []), [open, uri]);

  if (!uri) {
    // Si no hay uri, no renderizamos imagen; el caller suele mostrar iniciales.
    return null;
  }

  return (
    <>
      <ImageLightboxModal photos={photos} onClose={() => setOpen(false)} />
      <Pressable
        onPress={() => {
          if (disabled) return;
          setOpen(true);
        }}
        style={({ pressed }) => [
          fill ? ({ width: '100%', height: '100%' } as const) : null,
          containerStyle as any,
          pressed && { opacity: 0.92 },
        ]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Image source={{ uri }} style={style} />
      </Pressable>
    </>
  );
}

