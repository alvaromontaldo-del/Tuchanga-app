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

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

module.exports = {
  expo: {
    ...appJson.expo,
    updates: {
      url: 'https://u.expo.dev/c6c7474c-0df0-40ff-8baf-1ab347667b7b',
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
