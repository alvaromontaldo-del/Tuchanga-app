import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { ComponentProps } from 'react';
import { Image, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CommonActions, StackActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { colors, spacing } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useUnreadMessages } from '../context/UnreadMessagesContext';
import { useUserMode } from '../context/UserModeContext';
import { openAuthModal } from './openAuthModal';

const TAB_ICON: Record<string, ComponentProps<typeof Ionicons>['name']> = {
  Inicio: 'home-outline',
  Agenda: 'calendar-outline',
  Mensajes: 'chatbubbles-outline',
  Perfil: 'person-circle-outline',
};

const TAB_ROOT_SCREEN: Record<string, string> = {
  Inicio: 'Home',
  Agenda: 'Agenda',
  Mensajes: 'ConversationsList',
  Perfil: 'MyAccount',
};

export function MainTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { isAuthed, user } = useAuth();
  const { isWorker } = useUserMode();
  const { unreadCount } = useUnreadMessages();
  const bottomPad = Math.max(insets.bottom, spacing.sm);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const showSub = Keyboard.addListener('keyboardDidShow', () => setVisible(false));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setVisible(true));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (!visible) return null;

  return (
    <View style={[styles.shell, { paddingBottom: bottomPad }]}>
      <View style={styles.row}>
        {state.routes.map((route) => {
          if (route.name === 'Agenda') {
            if (!isAuthed || !isWorker) return null;
          }
          if (route.name === 'Publicar') {
            if (!isAuthed || !isWorker) return null;
            return (
              <View key={route.key} style={styles.publishSlot}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Publicar trabajo"
                  onPress={() => {
                    if (!isAuthed) {
                      openAuthModal('Login');
                      return;
                    }
                    navigation.navigate('Inicio', { screen: 'PublishPost' });
                  }}
                  style={({ pressed }) => [styles.publishFab, pressed && styles.pressed]}
                >
                  <Ionicons name="add" size={30} color="#fff" />
                </Pressable>
                <Text style={styles.publishLabel}>Publicar</Text>
              </View>
            );
          }

          const { options } = descriptors[route.key];
          const routeIndex = state.routes.findIndex((r) => r.key === route.key);
          const isFocused = state.index === routeIndex;
          const locked = route.name === 'Mensajes' && !isAuthed;

          const labelRaw =
            options.tabBarLabel !== undefined
              ? typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : options.title
              : options.title;
          const label = typeof labelRaw === 'string' ? labelRaw : route.name;

          const color = locked
            ? colors.textSecondary
            : isFocused
              ? colors.primary
              : colors.textSecondary;

          const iconName = TAB_ICON[route.name] ?? 'ellipse-outline';
          const profileAvatarUri = route.name === 'Perfil' && isAuthed ? user?.avatarUri : undefined;
          const showProfilePhoto = !!profileAvatarUri;

          const showMsgBadge = route.name === 'Mensajes' && isAuthed && unreadCount > 0;
          const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: isFocused, disabled: false }}
              onPress={() => {
                if (locked) {
                  openAuthModal('Login');
                  return;
                }
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) {
                  // Si ya estamos en la pestaña, popToTop del stack interno (evita “carrusel”).
                  if (isFocused) {
                    const nestedKey = (route as any)?.state?.key;
                    if (nestedKey) {
                      (navigation as any).dispatch({
                        ...StackActions.popToTop(),
                        target: nestedKey,
                      });
                    } else {
                      navigation.navigate(route.name);
                    }
                    if (route.name === 'Inicio') {
                      (navigation as any).navigate('Inicio', {
                        screen: 'Home',
                        params: { scrollToTopToken: Date.now() },
                      });
                    }
                    return;
                  }
                  // UX: tocar el tab siempre te lleva al inicio de esa pestaña (y resetea stack interno).
                  const root = TAB_ROOT_SCREEN[route.name];
                  if (route.name === 'Perfil' && !isAuthed) {
                    // Invitado: el stack Perfil es distinto (AccountGuest).
                    (navigation as any).dispatch(
                      CommonActions.navigate({
                        name: 'Perfil',
                        params: { screen: 'AccountGuest' },
                        merge: false,
                      }),
                    );
                    return;
                  }
                  if (root) {
                    // `merge: false` evita que el tab recuerde pantallas internas (p.ej. WorkerProfile).
                    (navigation as any).dispatch(
                      CommonActions.navigate({
                        name: route.name,
                        params: { screen: root },
                        merge: false,
                      }),
                    );
                    return;
                  }
                  navigation.navigate(route.name);
                }
              }}
              style={styles.tabSlot}
            >
              <View style={styles.iconWrap}>
                {showProfilePhoto ? (
                  <Image
                    source={{ uri: profileAvatarUri }}
                    style={[
                      styles.profileAvatar,
                      { borderColor: isFocused ? colors.primary : 'rgba(17,24,39,0.12)' },
                    ]}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <Ionicons
                    name={iconName}
                    size={24}
                    color={color}
                    style={locked ? styles.iconLocked : undefined}
                  />
                )}
                {showMsgBadge ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{badgeText}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, { color }, locked && styles.labelLocked]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  tabSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
    minHeight: 48,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E5E5E5',
    borderWidth: 2,
  },
  unreadBadge: {
    position: 'absolute',
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#DC2626',
    borderWidth: 1.8,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 14 },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    marginTop: 4,
    marginBottom: 2,
  },
  iconLocked: { opacity: 0.42 },
  labelLocked: { opacity: 0.42 },
  publishSlot: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  publishFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.22,
        shadowRadius: 5,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  publishLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    lineHeight: 14,
  },
  pressed: { opacity: 0.9 },
});
