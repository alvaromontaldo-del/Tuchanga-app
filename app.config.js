const path = require('path');

/**
 * EAS Update (`updates.url` + `runtimeVersion`): los celulares que abren la app SIN Metro (link del
 * dashboard / `eas update`) descargan el último bundle publicado — los cambios en PC no aparecen hasta
 * `npx eas-cli update --branch main` (o el branch que uses).
 *
 * Para ver cambios al instante (Fast Refresh): `npm run start` o `npm run start:clear` + QR en Expo Go.
 *
 * Para que el dashboard de expo.dev muestre un update nuevo: Cursor NO publica solo. Ejecutá en la PC:
 *   npm run eas:update -- "descripción del cambio"
 * (o `git push` a main si configurás EXPO_TOKEN y el workflow de GitHub).
 *
 * Carga .env en Node al arrancar Expo (web y nativo).
 */
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const appJson = require('./app.json');

const googleServicesRelative = './google-services.json';
const hasGoogleServices = require('fs').existsSync(
  path.resolve(__dirname, googleServicesRelative),
);

/** Perfil de EAS Build (solo definido durante `eas build`, no en `expo start` local). */
const easProfile = (process.env.EAS_BUILD_PROFILE ?? '').trim();
const isEasDevelopmentBuild = easProfile === 'development';

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
/** Opcional: solo si en el futuro usás Google Maps en web (Android usa OSM en WebView). */
const googleMapsApiKey = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();

module.exports = {
  expo: {
    ...appJson.expo,
    /**
     * Android — teclado (IME): afecta **toda** la app, no solo el chat.
     * `resize` → `adjustResize` (encoge la ventana con el teclado). Requiere
     * `edgeToEdgeEnabled: false` en app.json; con edge-to-edge el resize no aplica bien en RN.
     * Cambiar este valor requiere **nueva build nativa** (EAS Build); EAS Update / OTA no lo aplica.
     */
    android: {
      ...appJson.expo.android,
      softwareKeyboardLayoutMode: 'resize',
      ...(hasGoogleServices ? { googleServicesFile: googleServicesRelative } : {}),
      ...(googleMapsApiKey
        ? {
            config: {
              ...(appJson.expo.android?.config ?? {}),
              googleMaps: { apiKey: googleMapsApiKey },
            },
          }
        : {}),
    },
    updates: {
      url: 'https://u.expo.dev/c6c7474c-0df0-40ff-8baf-1ab347667b7b',
      /**
       * En APK de perfil `development`, no pedir EAS Update al arranque: si no hay update compatible
       * o la red falla, el runtime muestra "Failed to download remote update" antes de poder enganchar Metro.
       * Preview/production siguen con el comportamiento por defecto (comprobar al cargar).
       */
      ...(isEasDevelopmentBuild ? { checkAutomatically: 'NEVER' } : {}),
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    extra: {
      supabaseUrl,
      supabaseAnonKey,
      eas: {
        projectId: 'c6c7474c-0df0-40ff-8baf-1ab347667b7b',
      },
    },
  },
};
