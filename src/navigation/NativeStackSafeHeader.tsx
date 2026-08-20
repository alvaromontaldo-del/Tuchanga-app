import { getHeaderTitle, Header } from '@react-navigation/elements';
import type {
  NativeStackHeaderProps,
  NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveTopSafeInset } from '../utils/resolveSafeAreaInsets';

/** Opciones de stack en Android: cabecera JS con inset bajo status bar / notch. */
export const androidNativeStackHeaderOptions: NativeStackNavigationOptions = {
  header: (props) => <NativeStackSafeHeader {...props} />,
  statusBarTranslucent: false,
};

/**
 * Cabecera del native stack en Android con padding explícito bajo status bar / notch.
 * Evita que la flecha "volver" quede bajo la hora o la cámara frontal.
 */
export function NativeStackSafeHeader({
  options,
  route,
  back,
}: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const title = getHeaderTitle(options, route.name);

  return (
    <Header
      {...options}
      title={title}
      back={back}
      headerStatusBarHeight={resolveTopSafeInset(insets)}
    />
  );
}
