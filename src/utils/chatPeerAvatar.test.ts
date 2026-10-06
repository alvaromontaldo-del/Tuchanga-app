import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('foto del cliente en el chat', () => {
  it('el encabezado muestra la foto y la abre en lightbox', () => {
    const chat = read('src/screens/chat/ChatScreen.tsx');
    const header = chat.slice(
      chat.indexOf('<View style={styles.headerIdentity}>'),
      chat.indexOf('styles.headerNameColumn'),
    );
    expect(header).toContain('ClickableAvatar');
    expect(header).toContain('peerAvatarUrl');
    expect(header).toContain('peerAvatarAccessibilityLabel');
    expect(chat).toContain("return 'Ver foto de perfil del cliente'");
    expect(chat).toContain('fetchPeerAvatarUrl');
    expect(chat).toContain('otherAvatarUrl');
  });

  it('la lista pasa la foto y, si falta, el chat pide solo avatar_url', () => {
    const list = read('src/screens/chat/ConversationsListScreen.tsx');
    expect(list).toContain('otherAvatarUrl: item.otherAvatarUrl ?? null');

    const identity = read('src/services/profileIdentitySupabase.ts');
    const fn = identity.slice(
      identity.indexOf('export async function fetchPeerAvatarUrl'),
      identity.indexOf('export async function fetchPeerAvatarUrl') + 700,
    );
    expect(fn).toContain(".select('avatar_url')");
    expect(fn).not.toMatch(/apellido/);

    const inbox = read('src/services/chatSupabase.ts');
    expect(inbox).toContain(".select('nombre,avatar_url')");
    expect(inbox).toContain('otherAvatarUrl:');
    expect(inbox).not.toMatch(/select\([^)]*apellido/);
  });

  it('el cliente sigue viendo solo el nombre del profesional', () => {
    const chat = read('src/screens/chat/ChatScreen.tsx');
    expect(chat).toContain('professionalDisplayNameForClient(otherDisplayName)');
    expect(chat).toContain('return firstNameOnly(otherDisplayName)');
    expect(chat).not.toMatch(/select\([^)]*apellido/);
  });
});
