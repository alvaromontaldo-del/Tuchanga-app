import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { ModeratedTextField } from '../../components/common/ModeratedTextField';
import { useAppToast } from '../../components/toast/toast';
import { ImagePickerComponent } from '../../components/common/ImagePickerComponent';
import { colors, radii, spacing } from '../../constants/theme';
import { useFeed } from '../../context/FeedContext';
import { useUserMode } from '../../context/UserModeContext';
import { useAuth } from '../../context/AuthContext';
import type { FeedStackScreenProps } from '../../navigation/mainTypes';
import {
  CURRENT_USER_WORKER_ID,
  MAX_POST_IMAGES,
  normalizePostImageUrls,
} from '../../types/feed';
import { isSupabaseConfigured } from '../../config/supabase';
import { createPostInSupabase } from '../../services/supabasePosts';
import { mapContentModerationError } from '../../utils/contentModerationErrors';

type Props = FeedStackScreenProps<'PublishPost'>;

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?img=68';

/**
 * Publicar hasta 3 fotos del trabajo y descripción.
 */
export function PublishPostScreen({ navigation }: Props) {
  const { addPost, refresh } = useFeed();
  const { isWorker, workerTrade } = useUserMode();
  const { user } = useAuth();
  const toast = useAppToast();
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const MAX_DESC = 200;

  if (!isWorker) {
    return (
      <View style={styles.centered}>
        <Text style={styles.warn}>
          Registrá tus servicios en Perfil para publicar.
        </Text>
        <AppButton title="Volver" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const slotsLeft = MAX_POST_IMAGES - imageUris.length;

  async function handlePublish() {
    const urls = normalizePostImageUrls(imageUris);
    if (urls.length === 0) {
      toast.warning('Agregá al menos una imagen del trabajo (hasta 3).', 'Fotos');
      return;
    }
    const trimmed = description.trim();
    if (!trimmed) {
      toast.warning('Escribí una breve descripción del trabajo.', 'Descripción');
      return;
    }
    if (trimmed.length > MAX_DESC) {
      toast.warning(`La descripción no puede superar ${MAX_DESC} caracteres.`, 'Descripción');
      return;
    }

    setLoading(true);
    try {
      let postId = `local-${Date.now()}`;
      let createdAt = new Date().toISOString();
      let imageUrls = urls;

      if (isSupabaseConfigured()) {
        const remote = await createPostInSupabase({
          trade: workerTrade,
          description: trimmed,
          imageUris: urls,
        });
        postId = remote.postId;
        createdAt = remote.createdAt;
        imageUrls = remote.imageUrls;
      }

      const name = (user?.firstName ?? user?.fullName ?? 'Vos').trim() || 'Vos';
      addPost({
        id: postId,
        workerId: user?.id ?? CURRENT_USER_WORKER_ID,
        workerFirstName: name.split(' ')[0] ?? name,
        workerAvatarUrl: user?.avatarUri ?? DEFAULT_AVATAR,
        workerRatingAverage: user?.ratingAverage,
        workerReviewCount: user?.reviewCount,
        trade: workerTrade,
        workImageUrls: imageUrls,
        description: trimmed,
        createdAt,
        likeCount: 0,
        likedByMe: false,
      });

      // Re-sincronizar feed (ratings / listado) tras confirmar en Supabase.
      void refresh();
      navigation.goBack();
    } catch (e) {
      toast.error(mapContentModerationError(e), 'Publicar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppKeyboardAvoidingView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          Podés subir hasta {MAX_POST_IMAGES} fotos por publicación. Mostramos solo tu
          nombre (sin apellido) en el feed.
        </Text>

        <ImagePickerComponent
          mode="multi"
          label={`Fotos del trabajo (${imageUris.length}/${MAX_POST_IMAGES})`}
          hint="Podés usar cámara o galería. Recorte 1:1 automático antes de subir."
          value={imageUris}
          onChange={(next) => {
            const arr = Array.isArray(next) ? next : [String(next ?? '')];
            setImageUris(normalizePostImageUrls(arr.filter(Boolean)).slice(0, MAX_POST_IMAGES));
          }}
          maxCount={MAX_POST_IMAGES}
          squareCrop
          jpegQuality={0.88}
        />
        {slotsLeft <= 0 ? null : null}

        <Text style={styles.label}>Descripción</Text>
        <ModeratedTextField
          style={styles.input}
          containerStyle={styles.inputContainer}
          placeholder="Ej.: Instalación lista en 24 hs, cliente muy conforme."
          placeholderTextColor={colors.textSecondary}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={MAX_DESC}
          textAlignVertical="top"
        />
        <View style={styles.counterRow}>
          <Text style={[styles.counterText, description.trim().length >= MAX_DESC && styles.counterTextLimit]}>
            {Math.min(description.trim().length, MAX_DESC)}/{MAX_DESC}
          </Text>
        </View>

        <AppButton
          title="Publicar"
          onPress={() => void handlePublish()}
          loading={loading}
          disabled={!description.trim() || description.trim().length > MAX_DESC}
        />
      </ScrollView>
    </AppKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  hint: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  inputContainer: {
    marginBottom: spacing.lg,
  },
  input: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  counterRow: {
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
    alignItems: 'flex-end',
  },
  counterText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  counterTextLimit: {
    color: colors.error,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  warn: {
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
