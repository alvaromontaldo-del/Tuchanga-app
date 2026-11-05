import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { fetchMyMatriculas } from '../../services/matriculaVerificadaSupabase';
import {
  MATRICULA_OFICIO_CODIGOS,
  MATRICULA_SAVE_FIRST,
  matriculaOficiosFromTrades,
  matriculaUploadErrorMessage,
  type MatriculaCardMode,
  type MatriculaOficioCodigo,
  type MatriculaTradeRef,
  type MyMatriculasBundle,
} from '../../utils/matriculaVerificada';
import { MatriculaCard, MatriculaCardsLoading } from './MatriculaCard';
import { MatriculaLegadoCard } from './MatriculaLegadoCard';

type Props = {
  savedTrades: MatriculaTradeRef[];
  mode: MatriculaCardMode;
};

const EMPTY: MyMatriculasBundle = { oficios: [], legado: null };

export function MatriculasPorOficio({ savedTrades, mode }: Props) {
  const [bundle, setBundle] = useState<MyMatriculasBundle>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    try {
      const next = await fetchMyMatriculas();
      setBundle(next);
      setUnavailable(false);
    } catch (e) {
      const message = matriculaUploadErrorMessage(e);
      if (/no está habilitada/i.test(message)) setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const savedCodes = matriculaOficiosFromTrades(savedTrades);
  const cards = MATRICULA_OFICIO_CODIGOS.filter(
    (code) => savedCodes.includes(code) || bundle.oficios.some((row) => row.oficio === code),
  ).map((code) => ({
    code,
    puedeCargar: savedCodes.includes(code),
    row: bundle.oficios.find((item) => item.oficio === code) ?? null,
  }));

  if (mode === 'hidden' && (loading || (cards.length === 0 && !bundle.legado))) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Matrículas</Text>
      {mode === 'save-first' ? (
        <View style={styles.hold}>
          <Text style={styles.holdText}>{MATRICULA_SAVE_FIRST}</Text>
        </View>
      ) : null}
      {loading ? (
        <MatriculaCardsLoading />
      ) : unavailable ? (
        <Text style={styles.holdText}>La carga de la matrícula todavía no está habilitada.</Text>
      ) : (
        <>
          {cards.map((card) => (
            <MatriculaCard
              key={card.code}
              oficio={card.code as MatriculaOficioCodigo}
              row={card.row}
              puedeCargar={card.puedeCargar && mode === 'ready'}
              onReload={reload}
            />
          ))}
          {bundle.legado ? <MatriculaLegadoCard row={bundle.legado} onReload={reload} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  hold: {
    backgroundColor: '#FBF7F1',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: '#E7D9C6',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  holdText: { fontSize: 14, lineHeight: 20, color: '#6F6256' },
});
