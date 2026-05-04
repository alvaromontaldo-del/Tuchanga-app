import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ChangaCard } from '../feed/ChangaCard';
import { StarRating } from '../profile/StarRating';
import { colors, radii, spacing, typography } from '../../constants/theme';

export type WorkerResultCardModel = {
  id: string;
  firstName: string;
  summary: string;
  avatarUrl: string;
  ratingAverage: number;
  reviewCount: number;
  distanceLabel?: string;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightParts(text: string, needleRaw: string): Array<{ t: string; h: boolean }> {
  const needle = needleRaw.trim();
  if (!needle) return [{ t: text, h: false }];
  const re = new RegExp(`(${escapeRegExp(needle)})`, 'ig');
  const parts = text.split(re);
  if (parts.length === 1) return [{ t: text, h: false }];
  return parts
    .filter((p) => p.length > 0)
    .map((p) => ({ t: p, h: p.toLowerCase() === needle.toLowerCase() }));
}

export function WorkerResultCard({
  worker,
  onPress,
  rightAccessory,
  showChevron = true,
  highlightQuery,
}: {
  worker: WorkerResultCardModel;
  onPress: () => void;
  rightAccessory?: ReactNode;
  showChevron?: boolean;
  highlightQuery?: string;
}) {
  const nameParts = highlightParts(worker.firstName, highlightQuery ?? '');
  const summaryParts = highlightParts(worker.summary, highlightQuery ?? '');

  return (
    <ChangaCard onPress={onPress} style={styles.cardMargin}>
      <View style={styles.thumbBox}>
        <Image source={{ uri: worker.avatarUrl }} style={styles.thumbImg} resizeMode="contain" />
      </View>

      <View style={styles.resultBody}>
        <Text style={styles.resultName} numberOfLines={1}>
          {nameParts.map((p, i) =>
            p.h ? (
              <Text key={`n-${i}`} style={styles.hl}>
                {p.t}
              </Text>
            ) : (
              p.t
            ),
          )}
        </Text>
        <Text style={styles.resultSummary} numberOfLines={2}>
          {summaryParts.map((p, i) =>
            p.h ? (
              <Text key={`s-${i}`} style={styles.hl}>
                {p.t}
              </Text>
            ) : (
              p.t
            ),
          )}
        </Text>
        <View style={styles.resultMeta}>
          <StarRating
            score={worker.ratingAverage}
            reviewCount={worker.reviewCount}
            size={16}
            textSize={13}
          />
        </View>
        {worker.distanceLabel ? (
          <Text style={styles.resultDistance} numberOfLines={1}>
            {worker.distanceLabel}
          </Text>
        ) : null}
      </View>

      {rightAccessory ? <View style={styles.rightAccessory}>{rightAccessory}</View> : null}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
      ) : null}
    </ChangaCard>
  );
}

const styles = StyleSheet.create({
  cardMargin: {
    marginBottom: spacing.md,
  },
  thumbBox: {
    width: 90,
    height: 90,
    borderRadius: radii.thumb,
    backgroundColor: colors.imagePlaceholder,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  resultBody: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
    minWidth: 0,
  },
  resultName: {
    ...typography.title,
    fontWeight: '700',
  },
  resultSummary: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 4,
  },
  hl: {
    backgroundColor: '#FDE047',
    color: '#111827',
    fontWeight: '900',
  },
  resultMeta: {
    marginTop: spacing.sm,
  },
  resultDistance: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
    fontWeight: '600',
  },
  rightAccessory: {
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
