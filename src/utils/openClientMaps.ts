import { Linking, Platform } from 'react-native';
import { clientMapsUrls, type ClientMapsTarget } from './clientMaps';

/**
 * iOS prueba Google Maps con openURL y, si falla, Apple Maps y después la web.
 * No usa canOpenURL: el esquema no está declarado y no se toca app.config.js.
 */
export async function openClientInMaps(target: ClientMapsTarget): Promise<void> {
  const urls = clientMapsUrls(target);
  if (Platform.OS === 'web') {
    await Linking.openURL(urls.web);
    return;
  }
  if (Platform.OS === 'ios' && urls.iosGoogle) {
    try {
      await Linking.openURL(urls.iosGoogle);
      return;
    } catch {
      // La app de Google Maps no está instalada.
    }
  }
  const native = Platform.OS === 'ios' ? urls.ios : urls.android;
  try {
    await Linking.openURL(native);
  } catch {
    await Linking.openURL(urls.web);
  }
}
