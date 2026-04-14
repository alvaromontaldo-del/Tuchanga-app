/**
 * Expo --tunnel: parchea AsyncNgrok (@expo/cli) + client.js de @expo/ngrok.
 * El cliente oficial asumía siempre error.response.body y tiraba TypeError.
 * Con EXPO_NGROK_AUTH_TOKEN en .env usás tu cuenta ngrok gratis.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '_expoNgrokAuthToken';
const V2 = 'PATCH_NGROK_V2';

const candidates = [
  path.join(__dirname, '..', 'node_modules', 'expo', 'node_modules', '@expo', 'cli', 'build', 'src', 'start', 'server', 'AsyncNgrok.js'),
  path.join(__dirname, '..', 'node_modules', '@expo', 'cli', 'build', 'src', 'start', 'server', 'AsyncNgrok.js'),
];

function main() {
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    console.warn('[patch-expo-ngrok] AsyncNgrok.js no encontrado (¿expo instalado?).');
    process.exit(0);
  }
  let s = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (!s.includes(MARKER)) {
    const ngrokConfigRe =
      /const NGROK_CONFIG = \{\s*authToken: '5W1bR67GNbWcXqmxZzBG1_56GezNeaX6sSRvn8npeQ8',\s*domain: 'exp\.direct'\s*\};/;

    if (!ngrokConfigRe.test(s)) {
      console.warn(
        '[patch-expo-ngrok] AsyncNgrok.js no coincide con Expo 54.x; actualizá scripts/patch-expo-ngrok.js si cambió el CLI.',
      );
      process.exit(0);
    }

    s = s.replace(
      ngrokConfigRe,
      `const NGROK_CONFIG = {
    authToken: '5W1bR67GNbWcXqmxZzBG1_56GezNeaX6sSRvn8npeQ8',
    domain: 'exp.direct'
};
function _expoNgrokAuthToken() {
    const t = process.env.EXPO_NGROK_AUTH_TOKEN;
    return typeof t === 'string' && t.trim() !== '' ? t.trim() : NGROK_CONFIG.authToken;
}
function _useOwnNgrokAccount() {
    return typeof process.env.EXPO_NGROK_AUTH_TOKEN === 'string' && process.env.EXPO_NGROK_AUTH_TOKEN.trim() !== '';
}`,
    );

    const propsNeedle = `    async _getConnectionPropsAsync() {
        const userDefinedSubdomain = _env.env.EXPO_TUNNEL_SUBDOMAIN;`;
    const propsRepl = `    async _getConnectionPropsAsync() {
        if (_useOwnNgrokAccount()) {
            return {};
        }
        const userDefinedSubdomain = _env.env.EXPO_TUNNEL_SUBDOMAIN;`;
    if (!s.includes(propsNeedle)) {
      console.warn('[patch-expo-ngrok] No se pudo parchear _getConnectionPropsAsync.');
      process.exit(0);
    }
    s = s.replace(propsNeedle, propsRepl);

    const tokenNeedle = 'authtoken: NGROK_CONFIG.authToken,';
    if (!s.includes(tokenNeedle)) {
      console.warn('[patch-expo-ngrok] No se pudo parchear authtoken.');
      process.exit(0);
    }
    s = s.replace(tokenNeedle, 'authtoken: _expoNgrokAuthToken(),');
    changed = true;
  }

  if (!s.includes(V2)) {
    const assertSnippetOld = `                    throw new _errors.CommandError('NGROK_CONNECT', [
                        error.body.msg,
                        (_error_body_details = error.body.details) == null ? void 0 : _error_body_details.err,`;
    const assertSnippetNew = `                    const _ngErrBody = error && error.body;
                    throw new _errors.CommandError('NGROK_CONNECT', [
                        _ngErrBody && _ngErrBody.msg,
                        (_error_body_details = _ngErrBody == null ? void 0 : _ngErrBody.details) == null ? void 0 : _error_body_details.err,`;

    if (s.includes(assertSnippetOld) && !s.includes('_ngErrBody')) {
      s = s.replace(assertSnippetOld, assertSnippetNew);
    }

    const err103Old =
      'if ((0, _NgrokResolver.isNgrokClientError)(error) && error.body.error_code === 103)';
    const err103New =
      'if ((0, _NgrokResolver.isNgrokClientError)(error) && error.body && error.body.error_code === 103)';
    if (s.includes(err103Old)) {
      s = s.replace(err103Old, err103New);
    }

    const tunOld = 'const TUNNEL_TIMEOUT = 10 * 1000;';
    if (s.includes(tunOld)) {
      s = s.replace(tunOld, `const TUNNEL_TIMEOUT = 55 * 1000; /* ${V2} */`);
    }

    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, s, 'utf8');
    console.log(
      '[patch-expo-ngrok] AsyncNgrok: token propio + timeouts. En .env: EXPO_NGROK_AUTH_TOKEN=tu_token',
    );
  }

  copyPatchedNgrokClient();
}

const NGROK_PATCH_FILES = [
  ['expo-ngrok-client-patched.js', 'src/client.js'],
  ['expo-ngrok-utils-patched.js', 'src/utils.js'],
  ['expo-ngrok-index-patched.js', 'index.js'],
  ['expo-ngrok-process-patched.js', 'src/process.js'],
];

/** @expo/ngrok: client + utils (reintentos ECONNREFUSED) + index (delay API) + process (EXPO_NGROK_BIN). */
function copyPatchedNgrokClient() {
  const root = path.join(__dirname, '..');
  const pkg = path.join(root, 'node_modules', '@expo', 'ngrok');
  if (!fs.existsSync(pkg)) {
    console.warn(
      '[patch-expo-ngrok] @expo/ngrok no está en node_modules. Ejecutá: npm install',
    );
    return;
  }
  for (const [srcName, relDest] of NGROK_PATCH_FILES) {
    const src = path.join(__dirname, srcName);
    const dest = path.join(pkg, relDest);
    if (!fs.existsSync(src)) {
      console.warn(`[patch-expo-ngrok] Falta scripts/${srcName}`);
      continue;
    }
    fs.copyFileSync(src, dest);
  }
  console.log(
    '[patch-expo-ngrok] @expo/ngrok parcheado (reintentos :4040, delay, EXPO_NGROK_BIN opcional).',
  );
}

main();
