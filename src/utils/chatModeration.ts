export type BlockedContactMatch = {
  keyword: string;
  /** Por qué se bloqueó (texto para UI). */
  reason: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta “antipuenteo” (intento de pasar contacto externo).
 * Mantenerlo barato (regex simples) para usarlo en tiempo real.
 */
export function detectBlockedContact(textRaw: string): BlockedContactMatch | null {
  const text = normalize(textRaw);
  if (!text) return null;

  // Tokens directos
  const keywords: Array<{ k: string; reason: string; re: RegExp }> = [
    { k: 'cel', reason: 'No compartas datos de contacto.', re: /\bcel(ular|u)?\b/i },
    { k: 'wsp', reason: 'No compartas datos de contacto.', re: /\b(wsp|wp)\b/i },
    { k: 'whatsapp', reason: 'No compartas datos de contacto.', re: /\bwhats(app)?\b/i },
    { k: 'telefono', reason: 'No compartas datos de contacto.', re: /\b(tel|telefono|telefonos|phone)\b/i },
    { k: 'contacto', reason: 'No compartas datos de contacto.', re: /\bcontacto\b/i },
    { k: 'instagram', reason: 'No compartas redes sociales.', re: /\b(instagram|insta)\b/i },
    { k: 'ig', reason: 'No compartas redes sociales.', re: /\big\b/i },
    { k: '@', reason: 'No compartas redes o emails.', re: /@/ },
    { k: 'direccion', reason: 'No compartas direcciones personales.', re: /\b(direccion|direccion|address)\b/i },
    { k: 'punto com', reason: 'No compartas links o sitios externos.', re: /\bpunto\s*com\b/i },
    { k: 'punto net', reason: 'No compartas links o sitios externos.', re: /\bpunto\s*net\b/i },
    { k: '.com', reason: 'No compartas links o sitios externos.', re: /\.com\b/i },
    { k: '.net', reason: 'No compartas links o sitios externos.', re: /\.net\b/i },
  ];

  for (const it of keywords) {
    if (it.re.test(text)) return { keyword: it.k, reason: it.reason };
  }

  return null;
}

