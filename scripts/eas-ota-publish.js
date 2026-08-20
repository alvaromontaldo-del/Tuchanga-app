/**
 * Publica un OTA en EAS **por channel** (alineado con `eas.json`).
 * Cursor / guardar archivos NO dispara esto: ejecutá manualmente `npm run eas:update`
 * o automatizá con GitHub Actions (ver .github/workflows/eas-update.yml).
 */
const { execSync } = require('child_process');

process.env.EAS_NO_VCS = '1';

const argv = process.argv.slice(2);
const channelArg = argv[0];
const messageArg = argv.slice(1).join(' ').trim();

const channel = (channelArg || 'preview').trim();
const msg = messageArg || `OTA ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

// JSON.stringify cita el mensaje para cmd.exe (mensajes con espacios fallaban con spawn+shell en Windows).
const cmd = `npx eas-cli update --channel ${JSON.stringify(channel)} --message ${JSON.stringify(msg)}`;

try {
  execSync(cmd, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, EAS_NO_VCS: '1' },
    windowsHide: true,
  });
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}
