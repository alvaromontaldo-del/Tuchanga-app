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

  it('apila ícono arriba y texto chico abajo, sin cambiar la acción', () => {
    const chips = src.slice(
      src.indexOf('styles.headerChipsInline'),
      src.indexOf('styles.headerIconCluster'),
    );
    const cotizar = chips.indexOf('name="calculator-outline"');
    const cotizarLabel = chips.indexOf('{quoteChip.label}', cotizar);
    const materialesIcon = chips.indexOf('name="clipboard-outline"');
    const materialesLabel = chips.indexOf('>Materiales<', materialesIcon);
    expect(cotizar).toBeGreaterThan(-1);
    expect(cotizar).toBeLessThan(cotizarLabel);
    expect(materialesIcon).toBeGreaterThan(cotizarLabel);
    expect(materialesIcon).toBeLessThan(materialesLabel);
    expect(chips).toContain('size={16}');
    expect(chips).toContain('setQuoteModalOpen(true)');
    expect(chips).toContain("navigate('CreateMaterialRequest'");
    expect(chips).toContain('accessibilityLabel="Cotizaciones de materiales"');
    expect(chips).toContain('disabled={quoteChip.disabled}');

    const chipStyle = src.slice(src.indexOf('headerActionChip:'), src.indexOf('headerActionChipText:'));
    expect(chipStyle).toContain("flexDirection: 'column'");
    expect(chipStyle).toContain("alignItems: 'center'");
    expect(chipStyle).toContain("justifyContent: 'center'");
    expect(chipStyle).not.toContain("flexDirection: 'row'");

    const chipText = src.slice(src.indexOf('headerActionChipText:'), src.indexOf('center: {'));
    expect(chipText).toContain('fontSize: 10');
    expect(chipText).toContain('letterSpacing: -0.2');
    expect(chipText).toContain("textAlign: 'center'");
    expect(chipText).toContain('includeFontPadding: false');

    const row = src.slice(src.indexOf('headerChipsInline:'), src.indexOf('headerIconCluster:'));
    expect(row).toContain("flexDirection: 'row'");
    expect(row).toContain("alignItems: 'center'");
    expect(row).toContain("alignSelf: 'center'");
    expect(row).toContain("justifyContent: 'center'");

    const nameBlock = src.slice(src.indexOf('styles.headerNameColumn'), src.indexOf('styles.headerChipsInline'));
    expect(nameBlock).toContain('numberOfLines={1}');
    expect(nameBlock).toContain('adjustsFontSizeToFit');
    expect(nameBlock).toContain('minimumFontScale={0.7}');
    expect(nameBlock).toContain('ellipsizeMode="tail"');
    // Link, texto plano y subtítulo. El nombre achica la letra antes de cortar.
    expect(nameBlock.match(/ellipsizeMode="tail"/g)).toHaveLength(3);
    expect(nameBlock.match(/adjustsFontSizeToFit/g)).toHaveLength(2);
    expect(chips).not.toContain('ellipsizeMode');
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
