import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { feedScoreLabel, feedTrustIcons, type FeedTrustIcon } from '../../utils/feedTrust';
import { OficioMatriculaIcon } from '../profile/OficioMatriculaIcon';

type Props = {
  score?: number | null;
  jobs?: number | null;
  antecedentesAprobado?: boolean;
  oficios?: readonly unknown[];
  /** En listas propias se puede ocultar la estrella y dejar solo los sellos. */
  showScore?: boolean;
};

export function trustIconsForPost(
  antecedentesAprobado?: boolean,
  oficios?: readonly unknown[],
): FeedTrustIcon[] {
  return feedTrustIcons(antecedentesAprobado === true, oficios ?? []);
}

/** Estrella única, puntaje, trabajos y sellos. Los sellos no llevan texto. */
export function FeedPublicationMeta({
  score,
  jobs,
  antecedentesAprobado,
  oficios,
  showScore = true,
}: Props) {
  const icons = trustIconsForPost(antecedentesAprobado, oficios);
  const scoreText = feedScoreLabel(score, jobs);
  if (!showScore && icons.length === 0) return null;

  return (
    <View style={styles.row}>
      {showScore ? (
        <View style={styles.scoreRow}>
          <Ionicons name="star" size={13} color="#C4A574" />
          <Text style={styles.score}>{scoreText}</Text>
        </View>
      ) : null}
      {icons.map((code) => (
        <OficioMatriculaIcon key={code} code={code} size={18} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flexShrink: 0,
    gap: 4,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  score: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
});
