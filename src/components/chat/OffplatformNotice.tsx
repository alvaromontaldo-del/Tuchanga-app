import { StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { offplatformNoticeFor } from '../../utils/offplatformContact';

/** Aviso inmediato mientras se escribe. No traba el envío. */
export function OffplatformNotice({ text }: { text: string }) {
  const notice = offplatformNoticeFor(text);
  if (!notice) return null;
  return <Text style={styles.notice}>{notice}</Text>;
}

const styles = StyleSheet.create({
  notice: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.error,
  },
});
