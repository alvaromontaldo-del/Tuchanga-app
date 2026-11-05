import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../constants/theme';
import { deleteMyMatriculaFoto, signedMatriculaUrl } from '../../services/matriculaVerificadaSupabase';
import {
  MATRICULA_DELETE_APPROVED_WARNING,
  matriculaUploadErrorMessage,
  type MyMatriculaFoto,
  type MyMatriculaLegado,
} from '../../utils/matriculaVerificada';
import { useAppToast } from '../toast/toast';
import { MatriculaVerificadaBadge } from './MatriculaVerificadaBadge';
import { MatriculaPhotoTile } from './MatriculaCard';

type Props = {
  row: MyMatriculaLegado;
  onReload: () => Promise<void>;
};

/**
 * Matrícula anterior sin oficio demostrable.
 * Se muestra y se puede borrar. No se asigna a gas, electricidad, plomería ni fumigación.
 */
export function MatriculaLegadoCard({ row, onReload }: Props) {
  const toast = useAppToast();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        row.fotos.map(async (foto) => {
          const url = await signedMatriculaUrl(foto.storagePath);
          if (url) next[foto.id] = url;
        }),
      );
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.fotos]);

  function removeSaved(foto: MyMatriculaFoto) {
    const run = () => {
      void (async () => {
        setBusy(true);
        try {
          await deleteMyMatriculaFoto(foto.id);
          await onReload();
        } catch (e) {
          toast.error(matriculaUploadErrorMessage(e), 'No se pudo borrar', { durationMs: 4600 });
        } finally {
          setBusy(false);
        }
      })();
    };
    if (foto.status !== 'aprobada') {
      run();
      return;
    }
    Alert.alert('Borrar foto aprobada', MATRICULA_DELETE_APPROVED_WARNING, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: run },
    ]);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Sin oficio vinculado</Text>
      <Text style={styles.title}>Matrícula anterior</Text>
      <Text style={styles.copy}>
        La guardamos con su estado y sus fotos. No alcanza para saber qué oficio certifica, así que no
        la mostramos como gas, electricidad, plomería ni fumigación.
      </Text>
      {row.numero ? <Text style={styles.meta}>Número {row.numero}</Text> : null}
      {row.entidad ? <Text style={styles.meta}>{row.entidad}</Text> : null}
      {row.verificada ? (
        <View style={styles.badge}>
          <MatriculaVerificadaBadge />
        </View>
      ) : (
        <Text style={styles.meta}>
          {row.status === 'rechazada'
            ? row.motivo || 'No se aprobó.'
            : row.status === 'pendiente'
              ? 'En revisión'
              : 'Sin foto aprobada'}
        </Text>
      )}
      <View style={styles.photos}>
        {row.fotos.map((foto) => (
          <MatriculaPhotoTile
            key={foto.id}
            uri={urls[foto.id] ?? null}
            status={foto.status}
            busy={busy}
            label="Quitar foto de la matrícula anterior"
            onRemove={() => removeSaved(foto)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F7F4EF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4D9C8',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#6F6256',
  },
  title: { marginTop: 4, fontSize: 16, fontWeight: '800', color: '#2C2416' },
  copy: { marginTop: 6, fontSize: 14, lineHeight: 20, color: '#2C2416' },
  meta: { marginTop: 8, fontSize: 13, lineHeight: 18, color: '#6F6256' },
  badge: { marginTop: spacing.sm, alignItems: 'flex-start' },
  photos: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
