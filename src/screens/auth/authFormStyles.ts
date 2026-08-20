import { StyleSheet } from 'react-native';
import { colors, spacing } from '../../constants/theme';

export const authFormStyles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  card: {
    alignSelf: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  linkWrap: {
    marginTop: spacing.md,
    width: '100%',
    alignItems: 'center',
    gap: spacing.sm,
  },
  submitError: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: colors.error,
    fontWeight: '600',
  },
  hint: {
    marginBottom: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
