import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, spacing } from '../../constants/theme';
import { useCurrentUserProfile } from '../../hooks/useCurrentUserProfile';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import { openAuthModal } from '../../navigation/openAuthModal';
import { displayNameFromUser, initialsFromAuthUser } from '../../utils/profileDisplay';
import { accountUi } from './accountUi';
import { StarRating } from '../../components/profile/StarRating';
import { useUserMode } from '../../context/UserModeContext';
import { formatBirthDateDisplay } from '../../utils/birthDate';

type Props = AccountStackScreenProps<'UserProfile'>;

function formatMemberSince(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return '—';
  }
}

function Field({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <View style={[styles.field, isLast && styles.fieldLast]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value || '—'}</Text>
    </View>
  );
}

export function UserProfileScreen({ navigation }: Props) {
  const { displayUser, loading, error, refresh, isAuthed, isRestoring } =
    useCurrentUserProfile();
  const { isWorker } = useUserMode();

  const kickedToLoginRef = useRef(false);
  useEffect(() => {
    if (isRestoring) return;
    if (isAuthed) {
      kickedToLoginRef.current = false;
      return;
    }
    if (kickedToLoginRef.current) return;
    kickedToLoginRef.current = true;
    openAuthModal('Login');
  }, [isAuthed, isRestoring]);

  useFocusEffect(
    useCallback(() => {
      if (isRestoring) return;
      if (!isAuthed) return;
      void refresh();
    }, [isAuthed, isRestoring, refresh]),
  );

  if (!isAuthed) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Ionicons name="lock-closed-outline" size={28} color={colors.textSecondary} />
        <Text style={styles.errorTitle}>Iniciá sesión para ver tu perfil</Text>
        <Text style={styles.errorText}>
          Por seguridad, los perfiles no están disponibles para invitados.
        </Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => openAuthModal('Login')}
          accessibilityRole="button"
          accessibilityLabel="Iniciar sesión"
        >
          <Text style={styles.retryBtnText}>Iniciar sesión</Text>
        </Pressable>
        <Pressable
          style={[styles.retryBtn, styles.secondaryBtn]}
          onPress={() => navigation.navigate('MyAccount')}
          accessibilityRole="button"
          accessibilityLabel="Volver a mi cuenta"
        >
          <Text style={styles.secondaryBtnLabel}>Mi cuenta</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (isRestoring || loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Cargando tu perfil…</Text>
      </SafeAreaView>
    );
  }

  if (!displayUser) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Text style={styles.errorTitle}>No se pudo cargar el perfil</Text>
        <Text style={styles.errorText}>
          Probá de nuevo o volvé a tu cuenta. Si la sesión expiró, iniciá sesión otra vez.
        </Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => void refresh()}
          accessibilityRole="button"
          accessibilityLabel="Reintentar cargar perfil"
        >
          <Text style={styles.retryBtnText}>Reintentar</Text>
        </Pressable>
        <Pressable
          style={[styles.retryBtn, styles.secondaryBtn]}
          onPress={() => navigation.navigate('MyAccount')}
          accessibilityRole="button"
          accessibilityLabel="Volver a mi cuenta"
        >
          <Text style={styles.secondaryBtnLabel}>Mi cuenta</Text>
        </Pressable>
        <Pressable
          style={styles.linkBtn}
          onPress={() => openAuthModal('Login')}
          accessibilityRole="button"
          accessibilityLabel="Iniciar sesión"
        >
          <Text style={styles.linkBtnText}>Iniciar sesión</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const name = displayNameFromUser(displayUser);
  const ratingAverage = displayUser.ratingAverage ?? 0;
  const reviewCount = displayUser.reviewCount ?? 0;
  const birthDateLabel = formatBirthDateDisplay(displayUser.birthDate);

  const uri = displayUser.avatarUri?.trim();

  return (
    <SafeAreaView style={accountUi.screenBg} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={[accountUi.scrollContent, styles.scrollTop]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="warning-outline" size={20} color={colors.error} />
            <Text style={styles.errorBannerText}>{error}</Text>
            <Pressable onPress={() => void refresh()} accessibilityRole="button">
              <Text style={styles.retryLink}>Reintentar</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.hero}>
          <View style={styles.avatarWrap}>
            {uri ? (
              <Image
                key={uri}
                source={{ uri }}
                style={styles.avatarImg}
                accessibilityLabel="Foto de perfil"
              />
            ) : (
              <View style={styles.avatarFallback} accessibilityLabel="Avatar con iniciales">
                <Text style={styles.avatarInitials}>{initialsFromAuthUser(displayUser)}</Text>
              </View>
            )}
          </View>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}</Text>
            {isWorker ? (
              <StarRating
                score={ratingAverage}
                reviewCount={reviewCount}
                size={14}
                textSize={13}
              />
            ) : null}
          </View>
          <Text style={styles.email}>{displayUser.email}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.regSectionTitle}>DATOS DE REGISTRO</Text>
          <Pressable
            onPress={() => navigation.navigate('EditRegistration')}
            style={({ pressed }) => [styles.editLink, pressed && styles.editLinkPressed]}
            accessibilityRole="button"
            accessibilityLabel="Modificar datos de registro"
          >
            <Text style={styles.editLinkText}>Modificar</Text>
            <Ionicons name="create-outline" size={18} color={colors.primary} />
          </Pressable>
        </View>
        <View style={accountUi.card}>
          <Field label="Email" value={displayUser.email} />
          <Field
            label="Miembro desde"
            value={formatMemberSince(displayUser.profileCreatedAt)}
          />
          <Field label="Teléfono" value={displayUser.phone ?? ''} />
          <Field label="DNI" value={displayUser.dni ?? ''} />
          <Field label="Fecha de nacimiento" value={birthDateLabel ?? 'Edad no disponible'} />
          <Field
            label="Ubicación"
            value={displayUser.baseLocation?.address ?? displayUser.location ?? ''}
            isLast
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const AVATAR = 88;

const styles = StyleSheet.create({
  scrollTop: {
    paddingTop: spacing.sm,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  loadingText: { marginTop: spacing.md, fontSize: 15, color: colors.textSecondary },
  errorTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  errorText: { marginTop: spacing.sm, fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
  },
  retryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  secondaryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  secondaryBtnLabel: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  linkBtn: { marginTop: spacing.lg, paddingVertical: 8 },
  linkBtnText: { fontSize: 16, fontWeight: '700', color: colors.primary },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFEBEE',
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorBannerText: { flex: 1, fontSize: 14, color: colors.error },
  retryLink: { fontSize: 14, fontWeight: '700', color: colors.primary },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatarWrap: { marginBottom: spacing.sm },
  avatarImg: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.border,
  },
  avatarFallback: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { fontSize: 28, fontWeight: '800', color: '#fff' },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    flexWrap: 'wrap',
  },
  email: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  field: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLast: { borderBottomWidth: 0 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
  fieldValue: { fontSize: 16, color: colors.text },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  regSectionTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.7,
  },
  editLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  editLinkPressed: { opacity: 0.85 },
  editLinkText: { fontSize: 14, fontWeight: '800', color: colors.primary },
});
