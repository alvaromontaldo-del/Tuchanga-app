import { Ionicons } from '@expo/vector-icons';
import {
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
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
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  onPress: () => void;
  isLast?: boolean;
}) {
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
        <Ionicons name={icon} size={22} color={colors.text} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{title}</Text>
          {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

export function MyAccountScreen({ navigation }: Props) {
  const { signOut, user } = useAuth();
  const { isWorkerMode, setWorkerMode } = useUserMode();
  const { isWorkerRegistered } = useWorkerProfile();

  const displayName = displayNameFromUser(user);
  const initials = initialsFromAuthUser(user);

  return (
    <SafeAreaView style={accountUi.screenBg} edges={['top']}>
      <ScrollView
        contentContainerStyle={accountUi.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.pageHeader}>
          <Text style={accountUi.pageTitle}>Perfil</Text>
          <Text style={accountUi.pageSubtitle}>
            Tu identidad en Tu Changa y herramientas de cuenta.
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
              <Image
                key={user.avatarUri}
                source={{ uri: user.avatarUri }}
                style={styles.heroAvatarImg}
              />
            ) : (
              <Text style={styles.heroInitials}>{initials}</Text>
            )}
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.heroEmail} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
            <Text style={styles.heroCta}>Ver ficha completa</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
        </Pressable>

        <Text style={accountUi.sectionLabel}>PROFESIONAL</Text>
        <View style={accountUi.card}>
          <View style={[styles.modeRow, styles.rowBorder]}>
            <View style={styles.modeRowText}>
              <Text style={styles.modeTitle}>Modo trabajador</Text>
              <Text style={styles.modeSub}>
                Publicá en el feed y usá herramientas de oferta de servicios
              </Text>
            </View>
            <Switch
              value={isWorkerMode}
              onValueChange={setWorkerMode}
              trackColor={{ false: '#D1D5DB', true: '#FCA5A5' }}
              thumbColor={isWorkerMode ? colors.primary : '#F3F4F6'}
              accessibilityLabel="Modo trabajador"
            />
          </View>

          {!isWorkerRegistered ? (
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
                icon="create-outline"
                title="Editar perfil profesional"
                subtitle="Oficios, cobertura y ubicación"
                onPress={() => navigation.navigate('WorkerABM')}
                isLast
              />
            </>
          )}
        </View>

        <Text style={accountUi.sectionLabel}>CUENTA</Text>
        <View style={accountUi.card}>
          {!isWorkerMode ? (
            <Row
              icon="heart-outline"
              title="Favoritos"
              subtitle="Próximamente"
              onPress={() => {}}
            />
          ) : null}

          <Row
            icon="share-social-outline"
            title="Compartir app"
            subtitle="Invitá a otros a Tu Changa"
            onPress={() => {
              void Share.share({
                message: 'Probá Tu Changa: encontrá profesionales y recomendá trabajos.',
              });
            }}
          />

          <Row
            icon="log-out-outline"
            title="Cerrar sesión"
            onPress={() => {
              void (async () => {
                navigateToInicioTab();
                await signOut();
              })();
            }}
            isLast
          />
        </View>
      </ScrollView>
    </SafeAreaView>
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
  rowSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary },
});
