import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextProps, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';

type Props = {
  text: string;
  numberOfLinesCollapsed?: number;
  moreLabel?: string;
  lessLabel?: string;
  textStyle?: TextProps['style'];
  /** Alineación del enlace "Ver más" / "Ver menos" */
  moreAlign?: 'left' | 'right';
};

export function ExpandableText({
  text,
  numberOfLinesCollapsed = 5,
  moreLabel = 'Ver más',
  lessLabel = 'Ver menos',
  textStyle,
  moreAlign = 'left',
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const measuredOnce = useRef(false);

  /**
   * Importante: onTextLayout devuelve las líneas *renderizadas*.
   * Si al Text visible le ponemos numberOfLines, nunca va a reportar "más de N" aunque haya truncado.
   * Por eso medimos el texto completo en un Text oculto (sin clamp) y con eso decidimos el "Ver más".
   */
  const onMeasureLayout = useCallback(
    (e: any) => {
      if (measuredOnce.current) return;
      const lines = e?.nativeEvent?.lines?.length ?? 0;
      if (lines > numberOfLinesCollapsed) setCanExpand(true);
      measuredOnce.current = true;
    },
    [numberOfLinesCollapsed],
  );

  const toggle = useCallback(() => setExpanded((p) => !p), []);
  const clamped = useMemo(() => (!expanded ? numberOfLinesCollapsed : undefined), [expanded, numberOfLinesCollapsed]);

  return (
    <View>
      {/* Medición fuera de layout (no visible) */}
      <Text
        style={[textStyle, styles.measure]}
        numberOfLines={undefined}
        onTextLayout={onMeasureLayout}
      >
        {text}
      </Text>

      <Text style={textStyle} numberOfLines={clamped}>
        {text}
      </Text>
      {canExpand ? (
        <View style={moreAlign === 'right' ? styles.moreRowRight : styles.moreRowLeft}>
          <Pressable
            onPress={toggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={expanded ? lessLabel : moreLabel}
          >
            <Text style={styles.more}>{expanded ? lessLabel : moreLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  measure: {
    position: 'absolute',
    opacity: 0,
    zIndex: -1,
    // Evitar que aporte altura.
    height: 0,
    width: '100%',
  },
  moreRowLeft: {
    width: '100%',
    alignItems: 'flex-start',
  },
  moreRowRight: {
    width: '100%',
    alignItems: 'flex-end',
  },
  more: {
    marginTop: spacing.xs,
    color: colors.primary,
    fontWeight: '800',
    fontSize: 13,
  },
});

