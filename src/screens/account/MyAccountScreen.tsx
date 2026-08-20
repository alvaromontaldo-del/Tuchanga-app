import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { ClickableAvatar } from '../../components/common/ClickableAvatar';
import { StarRating } from '../../components/profile/StarRating';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCommerceShell } from '../../context/CommerceShellContext';
import { useUserMode } from '../../context/UserModeContext';
import { useWorkerProfile } from '../../context/WorkerProfileContext';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import { navigateToInicioTab } from '../../navigation/openAuthModal';
import { displayNameFromUser, initialsFromAuthUser } from '../../utils/profileDisplay';
import { accountUi } from './accountUi';

type Props = AccountStackScreenProps<'MyAccount'>;

function Row({
  icon,
  title,
  onPress,
  subtitle,
  isLast,
  destructive,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  onPress: () => void;
  isLast?: boolean;
  /** Estilo de acción destructiva (p. ej. cerrar sesión) */
  destructive?: boolean;
}) {
  const accent = destructive ? colors.error : colors.text;
  const chevron = destructive ? colors.error : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowBorder,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={22} color={accent} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, destructive && styles.rowTitleDestructive]}>{title}</Text>
          {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={chevron} />
    </Pressable>
  );
}

export function MyAccountScreen({ navigation }: Props) {
  const { signOut, user } = useAuth();
  const { clearSessionRole, clearCommerceIntent, chooseSessionRole, hasCommerceStore } =
    useCommerceShell();
  const { isWorker } = useUserMode();
  const { isWorkerRegistered } = useWorkerProfile();
  const isWorkerRegisteredAnywhere = isWorkerRegistered || Boolean(isWorker);

  const displayName = displayNameFromUser(user);
  const initials = initialsFromAuthUser(user);
  const ratingAverage = user?.ratingAverage ?? 0;
  const reviewCount = user?.reviewCount ?? 0;
  const scrollRef = useRef<ScrollView | null>(null);
  useScrollToTop(scrollRef);
  return (
    <AppScreen style={accountUi.screenBg} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={accountUi.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.pageHeader}>
          <Text style={accountUi.pageTitle}>Perfil</Text>
          <Text style={accountUi.pageSubtitle}>
            Tu identidad en YaChanga y herramientas de cuenta.
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.heroCard, pressed && styles.rowPressed]}
          onPress={() => navigation.navigate('UserProfile')}
          accessibilityRole="button"
          accessibilityLabel="Ver mis datos completos"
        >
          <View style={styles.heroAvatar}>
            {user?.avatarUri ? (
              <ClickableAvatar uri={user.avatarUri} style={styles.heroAvatarImg} fill />
            ) : (
              <Text style={styles.heroInitials}>{initials}</Text>
            )}
          </View>
          <View style={styles.heroBody}>
            <View style={styles.heroNameRow}>
              <Text style={styles.heroName} numberOfLines={1}>
                {displayName}
              </Text>
              {isWorkerRegisteredAnywhere ? (
                <StarRating score={ratingAverage} reviewCount={reviewCount} size={12} textSize={12} />
              ) : null}
            </View>
            <Text style={styles.heroEmail} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
            <Text style={styles.heroCta}>Ver ficha completa</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
        </Pressable>

        <Text style={accountUi.sectionLabel}>PROFESIONAL</Text>
        <View style={accountUi.card}>
          {!isWorkerRegisteredAnywhere ? (
            <Row
              icon="briefcase-outline"
              title="Ofrecer mis servicios"
              subtitle="Registrá oficios y zona para aparecer en búsquedas"
              onPress={() => navigation.navigate('WorkerABM')}
              isLast
            />
          ) : (
            <>
              <Row
                icon="images-outline"
                title="Mis publicaciones"
                subtitle="Lo que mostrás en el inicio"
                onPress={() => navigation.navigate('MyJobs')}
              />
              <Row
                icon="clipboard-outline"
                title="Mis trabajos"
                subtitle="Contratos y changas en curso o terminadas"
                onPress={() => navigation.navigate('MyWorkOrders')}
              />
              <Row
                icon="create-outline"
                title="Editar perfil profesional"
                subtitle="Oficios, cobertura y ubicación"
                onPress={() => navigation.navigate('WorkerABM')}
                isLast
              />
            </>
          )}
        </View>

        {hasCommerceStore ? (
          <>
            <Text style={accountUi.sectionLabel}>MÓDULOS</Text>
            <View style={accountUi.card}>
              <Row
                icon="storefront-outline"
                title="Ir a módulo comercio"
                subtitle="Pedidos de materiales y cotizaciones"
                onPress={() => {
                  void chooseSessionRole('commerce');
                }}
                isLast
              />
            </View>
          </>
        ) : null}

        <Text style={accountUi.sectionLabel}>CUENTA</Text>
        <View style={accountUi.card}>
          <Row
            icon="briefcase-outline"
            title="Trabajos contratados"
            subtitle="Servicios que contrataste como cliente"
            onPress={() => navigation.navigate('ContractedWorkOrders')}
          />
          <Row
            icon="heart-outline"
            title="Mis favoritos"
            subtitle="Profesionales guardados"
            onPress={() => navigation.navigate('Favorites')}
          />
          <Row
            icon="key-outline"
            title="Cambiar contraseña"
            subtitle="Actualizá tu clave de acceso"
            onPress={() => navigation.navigate('ChangePassword')}
          />

          <Row
            icon="share-social-outline"
            title="Compartir app"
            subtitle="Invitá a otros a YaChanga"
            onPress={() => {
              void Share.share({
                message: 'Probá YaChanga: encontrá profesionales y recomendá trabajos.',
              });
            }}
          />

          <Row
            icon="log-out-outline"
            title="Cerrar sesión"
            destructive
            onPress={() => {
              Alert.alert('Cerrar sesión', '¿Seguro que querés cerrar sesión?', [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Cerrar sesión',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      await clearSessionRole();
                      await clearCommerceIntent();
                      await signOut();
                      const parent = navigation.getParent();
                      if (parent && 'reset' in parent) {
                        (parent as any).reset({
                          index: 0,
                          routes: [{ name: 'Inicio', params: { screen: 'Home' } }],
                        });
                      } else {
                        navigateToInicioTab();
                      }
                    })();
                  },
                },
              ]);
            }}
            isLast
          />
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const AVATAR = 56;

const styles = StyleSheet.create({
  pageHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  brandRow: {
    marginBottom: spacing.sm,
  },
  heroCard: {
    marginHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  heroAvatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroAvatarImg: { width: '100%', height: '100%' },
  heroInitials: { fontSize: 20, fontWeight: '800', color: '#fff' },
  heroBody: { flex: 1, minWidth: 0 },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  heroName: { fontSize: 18, fontWeight: '800', color: colors.text },
  heroEmail: { marginTop: 2, fontSize: 14, color: colors.textSecondary },
  heroCta: { marginTop: 6, fontSize: 13, fontWeight: '700', color: colors.primary },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: spacing.md,
  },
  modeRowText: { flex: 1 },
  modeTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  modeSub: { marginTop: 4, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { opacity: 0.92 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowText: { marginLeft: spacing.sm, flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowTitleDestructive: { color: colors.error },
  rowSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary },
});
