import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chips del encabezado del chat', () => {
  const src = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');

  it('centra Cotizar y Materiales junto a la columna nombre + subtítulo', () => {
    const identity = src.slice(src.indexOf('headerIdentity:'), src.indexOf('headerIconCluster:'));
    expect(identity).toContain("flexDirection: 'row'");
    expect(identity).toContain('headerNameColumn:');
    expect(identity).toMatch(/headerNameColumn:\s*\{[^}]*flex:\s*1[^}]*minWidth:\s*0/s);
    expect(identity).toContain("alignSelf: 'center'");

    const header = src.slice(src.indexOf('styles.headerIdentity'), src.indexOf('styles.headerIconCluster'));
    expect(header).toContain('styles.headerNameColumn');
    expect(header).toContain('styles.headerChipsInline');
    expect(header).toContain('styles.headerNameLink');
    expect(header).toContain('openWorkerProfile');
    expect(header).toContain('styles.headerTrade');
    expect(header).toContain('{headerSubtitle}');
    expect(header).toContain("numberOfLines={1}");
    expect(header).toContain('ellipsizeMode="tail"');
    expect(header).toContain("participants?.myRole === 'trabajador' && !chatBlocked");
    expect(header).toContain('disabled={quoteChip.disabled}');
    expect(header).toContain('{quoteChip.label}');
    expect(header).toContain('accessibilityLabel={quoteChip.label}');
    expect(header).toContain('>Materiales<');
    expect(header.indexOf('styles.headerNameColumn')).toBeLessThan(header.indexOf('styles.headerChipsInline'));
    expect(header.indexOf('styles.headerTrade')).toBeLessThan(header.indexOf('styles.headerChipsInline'));
  });

  it('mantiene una sola fila con menú y papelera', () => {
    const start = src.indexOf('<View style={styles.headerTopRow}>');
    expect(start).toBeGreaterThan(-1);
    const row = src.slice(start, src.indexOf('<KeyboardAvoidingView', start));
    expect(row).toContain('accessibilityLabel="Volver"');
    expect(row).toContain('accessibilityLabel="Opciones de seguridad"');
    expect(row).toContain('accessibilityLabel="Eliminar chat"');
    expect(row.split('styles.headerTopRow').length - 1).toBe(1);
  });
});
