import { ActivityIndicator, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../../constants/theme';
import { BRAND_HORIZONTAL_ASPECT } from '../brand/BrandMark';

const LOGO = require('../../../assets/brand/logo-yachanga-v22_bold_tracking1.png');

const BRAND_BURGUNDY = '#8B1A1A';

/**
 * Pantalla mientras se restaura la sesión: mismo gris que el lienzo del logo (`colors.background`).
 */
export function SplashLoadingScreen() {
  const { width } = useWindowDimensions();
  const logoW = Math.min(Math.round(width * 0.88), 340);
  const logoH = Math.round(logoW / BRAND_HORIZONTAL_ASPECT);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.center}>
        <Image
          source={LOGO}
          style={{ width: logoW, height: logoH }}
          resizeMode="contain"
          accessibilityLabel="Tu Changa"
        />
        <ActivityIndicator
          size="large"
          color={BRAND_BURGUNDY}
          style={styles.spinner}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  spinner: {
    marginTop: 32,
  },
});
