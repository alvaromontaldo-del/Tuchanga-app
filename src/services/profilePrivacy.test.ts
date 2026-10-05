import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #120: la app no lee directo profiles.apellido, profiles.location ni
 * material_requests.client_address. El servidor les sacó el permiso de lectura:
 * el propio usuario los pide con get_my_profile_identity, el profesional ve el
 * apellido de su cliente con get_peer_display_name y el comercio destinatario
 * recibe la calle con get_store_request_client_address para cotizar el flete.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function selectClauses(src: string): string[] {
  const out: string[] = [];
  const re = /\.select\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    out.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  const consts = /const PROFILE_[A-Z0-9_]+ =\s*\n?\s*(?:'([^']*)'|`([^`]*)`)/g;
  while ((match = consts.exec(src))) {
    out.push(match[1] ?? match[2] ?? '');
  }
  return out;
}

describe('privacidad de apellido, ubicación y dirección (#120)', () => {
  const files = sourceFiles('src');

  it('ningún select directo pide apellido, location ni client_address', () => {
    let total = 0;
    for (const file of files) {
      for (const clause of selectClauses(readFileSync(file, 'utf8'))) {
        total += 1;
        expect(clause, file).not.toMatch(/\bapellido\b/);
        expect(clause, file).not.toMatch(/\blocation\b/);
        expect(clause, file).not.toMatch(/\bclient_address\b/);
      }
    }
    expect(total).toBeGreaterThan(20);
  });

  it('el perfil propio, el chat y el comercio usan los RPC', () => {
    const user = readFileSync('src/services/supabaseUser.ts', 'utf8');
    expect(user).toMatch(/fetchMyProfileIdentity\(\)/);
    const media = readFileSync('src/services/chatMediaSupabase.ts', 'utf8');
    expect(media).toMatch(/fetchMyProfileIdentity\(\)/);
    const store = readFileSync('src/services/storeQuotesSupabase.ts', 'utf8');
    expect(store).toMatch(/get_store_request_client_address/);
    for (const f of ['src/services/notificationRouting.ts', 'src/navigation/openPagoCheckout.ts']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/fetchPeerFullName\(otherId\)/);
    }
  });
});
