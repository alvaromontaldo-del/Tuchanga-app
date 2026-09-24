import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, spacing } from '../../constants/theme';

/** Líneas visibles antes de mostrar "Ver más" (oficios, reseñas, bios, etc.). */
export const EXPANDABLE_TEXT_LINES = 3;

type Props = {
  text: string;
  numberOfLinesCollapsed?: number;
  moreLabel?: string;
  lessLabel?: string;
  textStyle?: TextProps['style'];
  style?: ViewStyle;
  /** Alineación del enlace "Ver más" / "Ver menos" */
  moreAlign?: 'left' | 'right';
};

export function ExpandableText({
  text,
  numberOfLinesCollapsed = EXPANDABLE_TEXT_LINES,
  moreLabel = 'Ver más',
  lessLabel = 'Ver menos',
  textStyle,
  style,
  moreAlign = 'left',
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(0);

  useEffect(() => {
    setExpanded(false);
    setCanExpand(false);
  }, [text, numberOfLinesCollapsed]);

  /**
   * onTextLayout devuelve las líneas renderizadas.
   * El Text visible con numberOfLines nunca reporta más de N líneas aunque haya truncado.
   * Medimos el texto completo en un Text oculto (mismo ancho) para decidir el toggle.
   */
  const onMeasureLayout = useCallback(
    (e: { nativeEvent?: { lines?: unknown[] } }) => {
      const lines = e.nativeEvent?.lines?.length ?? 0;
      setCanExpand(lines > numberOfLinesCollapsed);
    },
    [numberOfLinesCollapsed],
  );

  const onContainerLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0) setLayoutWidth(w);
  }, []);

  const toggle = useCallback(() => setExpanded((p) => !p), []);
  const clamped = useMemo(
    () => (!expanded ? numberOfLinesCollapsed : undefined),
    [expanded, numberOfLinesCollapsed],
  );

  const safeText = typeof text === 'string' ? text : '';
  if (!safeText.trim()) return null;

  return (
    <View style={style} onLayout={onContainerLayout}>
      {layoutWidth > 0 ? (
        <Text
          style={[textStyle, styles.measure, { width: layoutWidth }]}
          onTextLayout={onMeasureLayout}
          accessible={false}
          importantForAccessibility="no"
        >
          {safeText}
        </Text>
      ) : null}

      <Text style={textStyle} numberOfLines={clamped}>
        {safeText}
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
    left: 0,
    top: 0,
    pointerEvents: 'none',
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
