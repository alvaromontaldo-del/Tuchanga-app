import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components/common/AppButton';
import { colors, radii, spacing } from '../../constants/theme';
import { useFeed } from '../../context/FeedContext';
import { useUserMode } from '../../context/UserModeContext';
import type { FeedStackScreenProps } from '../../navigation/mainTypes';
import {
  CURRENT_USER_WORKER_ID,
  MAX_POST_IMAGES,
  normalizePostImageUrls,
} from '../../types/feed';

type Props = FeedStackScreenProps<'PublishPost'>;

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?img=68';

/**
 * Publicar hasta 3 fotos del trabajo y descripción.
 */
export function PublishPostScreen({ navigation }: Props) {
  const { addPost } = useFeed();
  const { isWorkerMode, workerTrade } = useUserMode();
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isWorkerMode) {
    return (
      <View style={styles.centered}>
        <Text style={styles.warn}>
          Activá &quot;Modo trabajador&quot; en Perfil para publicar.
        </Text>
        <AppButton title="Volver" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const slotsLeft = MAX_POST_IMAGES - imageUris.length;

  async function pickImages() {
    if (slotsLeft <= 0) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permisos',
        'Necesitamos acceso a tu galería para elegir fotos del trabajo.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: slotsLeft,
      quality: 0.85,
    });

    if (!result.canceled && result.assets.length > 0) {
      const next = result.assets
        .map((a) => a.uri)
        .filter(Boolean)
        .slice(0, slotsLeft);
      setImageUris((prev) => normalizePostImageUrls([...prev, ...next]));
    }
  }

  function removeAt(index: number) {
    setImageUris((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePublish() {
    const urls = normalizePostImageUrls(imageUris);
    if (urls.length === 0) {
      Alert.alert('Fotos', 'Agregá al menos una imagen del trabajo (hasta 3).');
      return;
    }
    const trimmed = description.trim();
    if (!trimmed) {
      Alert.alert('Descripción', 'Escribí una breve descripción del trabajo.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      addPost({
        id: `local-${Date.now()}`,
        workerId: CURRENT_USER_WORKER_ID,
        workerFirstName: 'Vos',
        workerAvatarUrl: DEFAULT_AVATAR,
        trade: workerTrade,
        workImageUrls: urls,
        description: trimmed,
        createdAt: new Date().toISOString(),
        likeCount: 0,
        likedByMe: false,
      });
      setLoading(false);
      navigation.goBack();
    }, 400);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          Podés subir hasta {MAX_POST_IMAGES} fotos por publicación. Mostramos solo tu
          nombre (sin apellido) en el feed.
        </Text>

        <Text style={styles.label}>Fotos del trabajo ({imageUris.length}/{MAX_POST_IMAGES})</Text>
        <View style={styles.thumbRow}>
          {imageUris.map((uri, index) => (
            <View key={`${uri}-${index}`} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              <Pressable
                style={styles.removeBtn}
                onPress={() => removeAt(index)}
                hitSlop={8}
                accessibilityLabel="Quitar foto"
              >
                <Ionicons name="close-circle" size={28} color={colors.primary} />
              </Pressable>
            </View>
          ))}
          {slotsLeft > 0 ? (
            <Pressable style={styles.addTile} onPress={pickImages}>
              <Ionicons name="images-outline" size={36} color="#E5E5E5" />
              <Text style={styles.addTileText}>Agregar</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.label}>Descripción</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej.: Instalación lista en 24 hs, cliente muy conforme."
          placeholderTextColor={colors.textSecondary}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
        />

        <AppButton title="Publicar" onPress={handlePublish} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  thumbWrap: {
    width: 100,
    height: 100,
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2C2C2C',
  },
  removeBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 14,
  },
  addTile: {
    width: 100,
    height: 100,
    borderRadius: radii.card,
    backgroundColor: '#1A1A1A',
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTileText: {
    color: '#E5E5E5',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
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
