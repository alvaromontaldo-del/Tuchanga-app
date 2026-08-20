/**
 * Verifica requisitos de push Android (FCM) antes de un EAS Build.
 * Uso: node scripts/check-android-push-setup.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const googleServices = path.join(root, 'google-services.json');
const pkg = 'com.cuervolinkedout.tuchanga';

let ok = true;

if (!fs.existsSync(googleServices)) {
  ok = false;
  console.error(
    '[push-android] Falta google-services.json en la raíz del proyecto.\n' +
      '  1. Firebase Console → proyecto → Agregar app Android\n' +
      `  2. Package: ${pkg}\n` +
      '  3. Descargá google-services.json y colocalo en tuchanga-app/\n' +
      '  4. EAS → credentials → Android → FCM V1 → subí la service account key',
  );
} else {
  try {
    const json = JSON.parse(fs.readFileSync(googleServices, 'utf8'));
    const clients = json?.client ?? [];
    const match = clients.some(
      (c) => c?.client_info?.android_client_info?.package_name === pkg,
    );
    if (!match) {
      ok = false;
      console.error(
        `[push-android] google-services.json no contiene el package ${pkg}.`,
      );
    } else {
      console.log('[push-android] google-services.json OK');
    }
  } catch (e) {
    ok = false;
    console.error('[push-android] google-services.json inválido:', e.message);
  }
}

if (!ok) {
  process.exit(1);
}

console.log(
  '[push-android] Recordá subir la FCM v1 service account key en expo.dev → credentials → Android.',
);
