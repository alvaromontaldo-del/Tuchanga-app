import { Platform, StatusBar } from 'react-native';
import { colors } from '../constants/theme';

/** Barra de estado opaca en Android (coherente con app.json). El header reserva el inset por separado. */
export function configureAndroidSystemBars(): void {
  if (Platform.OS !== 'android') return;
  StatusBar.setTranslucent(false);
  StatusBar.setBackgroundColor(colors.surface);
}
