import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppScreen } from '../../components/layout/AppScreen';
import { useAppToast } from '../../components/toast/toast';
import { isSupabaseConfigured } from '../../config/supabase';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCommerceShell } from '../../context/CommerceShellContext';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import { storeStatusLabel } from '../../services/storeRegistrationSupabase';
import { updateMyStoreAvatarFromUri } from '../../services/storeQuotesSupabase';
import { normalizeLocalImageUri } from '../../utils/normalizeLocalImage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<CommerceStackParamList, 'CommerceAccount'>;

/**
 * Cuenta del shell comercio: avatar del local + estado + cerrar sesión.
 */
export function CommerceAccountScreen({ navigation }: Props) {
  const toast = useAppToast();
  const { signOut, user } = useAuth();
  const {
    primaryStore,
    stores,
    clearCommerceIntent,
    clearSessionRole,
    chooseSessionRole,
    refresh,
  } = useCommerceShell();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [storeAvatarUri, setStoreAvatarUri] = useState<string | null>(
    primaryStore?.avatarUrl ?? null,
  );

  useEffect(() => {
    setStoreAvatarUri(primaryStore?.avatarUrl ?? null);
  }, [primaryStore?.avatarUrl]);

  const onSwitchToClient = () => {
    void chooseSessionRole('client');
  };

  const onSignOut = () => {
    Alert.alert('Cerrar sesión', '¿Seguro que querés salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await clearSessionRole();
            await clearCommerceIntent();
            await signOut();
          })();
        },
      },
    ]);
  };

  const pickAndUploadAvatar = async () => {
    if (!isSupabaseConfigured()) {
      toast.warning('Supabase no está configurado.', 'Foto');
      return;
    }
    if (!primaryStore?.id) {
      toast.warning('No hay un comercio seleccionado.', 'Foto');
      return;
    }

    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') {
      Alert.alert(
        'Permiso de galería',
        'Necesitamos acceso a tus fotos para cambiar la foto del comercio.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Abrir ajustes',
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ],
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    setUploadingAvatar(true);
    try {
      const localUri = await normalizeLocalImageUri(result.assets[0].uri, {
        squareCrop: true,
      });
      const publicUrl = await updateMyStoreAvatarFromUri(primaryStore.id, localUri);
      setStoreAvatarUri(publicUrl);
      await refresh();
      toast.success('Foto del comercio actualizada.', 'Listo');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo subir la foto.', 'Error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const avatarUri = (storeAvatarUri ?? primaryStore?.avatarUrl)?.trim();

  return (
    <AppScreen style={styles.flex} edges={['bottom', 'left', 'right']}>
      <Pressable
        style={({ pressed }) => [styles.avatarCard, pressed && styles.pressed]}
        onPress={() => void pickAndUploadAvatar()}
        disabled={uploadingAvatar}
        accessibilityRole="button"
        accessibilityLabel="Cambiar foto de perfil"
      >
        <View style={styles.avatar}>
          {uploadingAvatar ? (
            <ActivityIndicator color={colors.primary} />
          ) : avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
          ) : (
            <Ionicons name="storefront-outline" size={32} color={colors.textSecondary} />
          )}
        </View>
        <View style={styles.avatarText}>
          <Text style={styles.avatarTitle}>Foto del comercio</Text>
          <Text style={styles.avatarHint}>
            {uploadingAvatar
              ? 'Subiendo…'
              : Platform.OS === 'ios'
                ? 'Tocá para elegir de la galería'
                : 'Independiente de tu foto de cliente/profesional'}
          </Text>
        </View>
        <Ionicons name="camera-outline" size={22} color={colors.primary} />
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.label}>Cuenta</Text>
        <Text style={styles.value}>{user?.email ?? '—'}</Text>
        {user?.fullName ? <Text style={styles.muted}>{user.fullName}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Comercio</Text>
        {primaryStore ? (
          <>
            <Text style={styles.value}>{primaryStore.name}</Text>
            <Text style={styles.status}>
              Estado: {storeStatusLabel(primaryStore.status)}
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>Todavía no registraste un local.</Text>
        )}
        {stores.length > 1 ? (
          <Text style={styles.muted}>{stores.length} locales vinculados a esta cuenta.</Text>
        ) : null}
      </View>

      {primaryStore && primaryStore.status !== 'rejected' ? (
        <Pressable
          style={({ pressed }) => [styles.rowBtn, pressed && styles.pressed]}
          onPress={() => navigation.navigate('EditStore')}
        >
          <Ionicons name="create-outline" size={22} color={colors.primary} />
          <Text style={styles.rowBtnText}>Editar datos y rubros</Text>
        </Pressable>
      ) : null}

      {!primaryStore || primaryStore.status === 'rejected' ? (
        <Pressable
          style={({ pressed }) => [styles.rowBtn, pressed && styles.pressed]}
          onPress={() => navigation.navigate('RegisterStore')}
        >
          <Ionicons name="storefront-outline" size={22} color={colors.primary} />
          <Text style={styles.rowBtnText}>Registrar / reenviar comercio</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.rowBtn, pressed && styles.pressed]}
        onPress={() => {
          refresh();
          navigation.navigate('StoreMaterialRequests');
        }}
      >
        <Ionicons name="cube-outline" size={22} color={colors.text} />
        <Text style={[styles.rowBtnText, { color: colors.text }]}>Ver pedidos</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.rowBtn, pressed && styles.pressed]}
        onPress={onSwitchToClient}
        accessibilityRole="button"
        accessibilityLabel="Ir a módulo cliente o profesional"
      >
        <Ionicons name="people-outline" size={22} color={colors.primary} />
        <View style={styles.switchText}>
          <Text style={styles.rowBtnText}>Ir a cliente / profesional</Text>
          <Text style={styles.switchSub}>Chat, trabajos y publicaciones</Text>
        </View>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
        onPress={onSignOut}
      >
        <Ionicons name="log-out-outline" size={22} color={colors.error} />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </Pressable>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  avatarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { flex: 1, gap: 2 },
  avatarTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  avatarHint: { fontSize: 13, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.4 },
  value: { fontSize: 16, fontWeight: '800', color: colors.text },
  status: { marginTop: 4, fontSize: 14, color: colors.textSecondary },
  muted: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  rowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBtnText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  switchText: { flex: 1, gap: 2 },
  switchSub: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  logoutBtn: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
  },
  logoutText: { fontSize: 16, fontWeight: '800', color: colors.error },
  pressed: { opacity: 0.9 },
});
