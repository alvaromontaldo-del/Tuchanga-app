const path = require('path');

// Carga .env en Node al arrancar Expo (web y nativo); más fiable que depender solo del inlining de Metro.
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
