import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { ComponentProps } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useUserMode } from '../context/UserModeContext';
import { openAuthModal } from './openAuthModal';

const TAB_ICON: Record<string, ComponentProps<typeof Ionicons>['name']> = {
  Inicio: 'home-outline',
  Buscar: 'search-outline',
  Mensajes: 'chatbubbles-outline',
  Perfil: 'person-circle-outline',
};

export function MainTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { isAuthed } = useAuth();
  const { isWorkerMode } = useUserMode();
  const bottomPad = Math.max(insets.bottom, spacing.sm);

  return (
    <View style={[styles.shell, { paddingBottom: bottomPad }]}>
      <View style={styles.row}>
        {state.routes.map((route) => {
          if (route.name === 'Publicar') {
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
                    if (!isWorkerMode) {
                      Alert.alert(
                        'Modo trabajador',
                        'Activá «Modo trabajador» en la pestaña Perfil para publicar trabajos.',
                      );
                      navigation.navigate('Inicio', { screen: 'Home' });
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
                navigation.navigate(route.name);
              }}
              style={styles.tabSlot}
            >
              <Ionicons
                name={iconName}
                size={24}
                color={color}
                style={locked ? styles.iconLocked : undefined}
              />
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
