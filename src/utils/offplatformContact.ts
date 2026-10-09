/**
 * Antipuenteo, primera capa (sin IA).
 *
 * No se bloquea por la palabra («dirección», «teléfono», «ubicación»,
 * «whatsapp», «mail», «calle»…). Se detecta el dato y se reemplaza por «•••».
 * El envío sigue. La misma regla vive en el cliente y en
 * public.redact_offplatform_contact (SQL).
 */

export const OFFPLATFORM_REDACTION = '•••';

export const OFFPLATFORM_NOTICE =
  'La dirección y el contacto se comparten por la app después del pago del costo de servicio. Reemplazamos ese dato por •••.';

export type OffplatformKind =
  | 'telefono'
  | 'email'
  | 'url'
  | 'cbu'
  | 'alias'
  | 'usuario'
  | 'codigo'
  | 'direccion';

export type OffplatformResult = {
  text: string;
  kinds: OffplatformKind[];
  changed: boolean;
  notice: string | null;
};

const FOLD_FROM = 'áàäâãåéèëêíìïîóòöôõúùüûñÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ';
const FOLD_TO = 'aaaaaaeeeeiiiiooooouuuunaaaaaaeeeeiiiiooooouuuun';

/** Misma longitud que el original, para que los índices del regex coincidan. */
export function foldOffplatformText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charAt(i);
    const mapped = FOLD_FROM.indexOf(ch);
    if (mapped >= 0) {
      out += FOLD_TO.charAt(mapped);
      continue;
    }
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
  }
  return out;
}

type Span = { start: number; end: number; kind: OffplatformKind | 'ignore' };

const NUM_WORD_DIGITS: Record<string, string> = {
  cero: '0',
  uno: '1',
  una: '1',
  un: '1',
  dos: '2',
  tres: '3',
  cuatro: '4',
  cinco: '5',
  seis: '6',
  siete: '7',
  ocho: '8',
  nueve: '9',
  diez: '10',
  once: '11',
  doce: '12',
  trece: '13',
  catorce: '14',
  quince: '15',
  dieciseis: '16',
  diecisiete: '17',
  dieciocho: '18',
  diecinueve: '19',
  veinte: '20',
  veintiuno: '21',
  veintidos: '22',
  veintitres: '23',
  veinticuatro: '24',
  veinticinco: '25',
  veintiseis: '26',
  veintisiete: '27',
  veintiocho: '28',
  veintinueve: '29',
  treinta: '30',
  cuarenta: '40',
  cincuenta: '50',
  sesenta: '60',
  setenta: '70',
  ochenta: '80',
  noventa: '90',
};

const UNIT_WORDS = new Set([
  'mm',
  'cm',
  'm',
  'mt',
  'mts',
  'metro',
  'metros',
  'm2',
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'gr',
  'grs',
  'gramo',
  'gramos',
  'lt',
  'lts',
  'litro',
  'litros',
  'pulg',
  'pulgada',
  'pulgadas',
  'unidad',
  'unidades',
  'bolsa',
  'bolsas',
  'cajon',
  'cajones',
  'caja',
  'cajas',
  'chapa',
  'chapas',
  'baldosa',
  'baldosas',
  'ladrillo',
  'ladrillos',
  'rollo',
  'rollos',
  'varilla',
  'varillas',
  'tira',
  'tiras',
  'placa',
  'placas',
  'tubo',
  'tubos',
  'cano',
  'canos',
  'mil',
  'millones',
  'peso',
  'pesos',
  'ars',
  'hs',
  'hora',
  'horas',
  'dia',
  'dias',
]);

const NAME_STOP = new Set([
  ...UNIT_WORDS,
  'cinta',
  'cable',
  'calor',
  'cemento',
  'arena',
  'cal',
  'pintura',
  'manguera',
  'tornillo',
  'tornillos',
  'tarugo',
  'tarugos',
  'llave',
  'griferia',
  'inodoro',
  'mesada',
  'puerta',
  'ventana',
  'vidrio',
  'membrana',
  'durlock',
  'yeso',
  'enduido',
  'revestimiento',
  'porcelanato',
  'ceramica',
  'zocalo',
  'perfil',
  'hierro',
  'alambre',
  'clavo',
  'clavos',
  'item',
  'codigo',
  'total',
  'precio',
  'mano',
  'obra',
  'mail',
  'whatsapp',
  'foto',
  'chat',
  'pin',
  'pago',
  'sena',
  'cantidad',
  'hola',
  'gracias',
  'bueno',
  'dale',
  'ok',
  'si',
  'no',
  'que',
  'por',
  'para',
  'con',
  'sin',
  'este',
  'esta',
  'hay',
  'son',
  'mas',
  'muy',
  'bien',
  'ahi',
  'aca',
  'ya',
  'hoy',
  'manana',
  'despues',
  'cuando',
  'donde',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
  'pedido',
  'cuesta',
  'vale',
  'queda',
  'salen',
  'llevan',
  'necesito',
  'quiero',
  'piso',
  'depto',
  'dpto',
  'dto',
  'departamento',
  'esquina',
  'entre',
  'calle',
  'avenida',
  'barrio',
  'lote',
  'manzana',
  'altura',
  'casa',
  'country',
  'las',
  'los',
  'del',
  'una',
  'uno',
  'direccion',
  'ubicacion',
  'telefono',
  'celular',
  'contacto',
]);

const ALIAS_DENY = new Set([
  'www',
  'com',
  'net',
  'org',
  'maps',
  'google',
  'goo',
  'app',
  'html',
  'http',
  'https',
]);

const IGNORE_RES = [
  /\$\s*\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d{1,2})?/g,
  /\$\s*\d+(?:[.,]\d{1,2})?/g,
  /\b\d{1,3}(?:\.\d{3})+(?:[.,]\d{1,2})?\b/g,
  /\b\d+(?:[.,]\d+)?\s*(?:mil|millones|pesos|peso|ars)\b/g,
  /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*(?:m|mm|cm|mts?|metros?|m2))?/g,
  /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|mts|mt|metros|metro|kg|kgs|kilos|kilo|grs?|gramos|lts|litros|litro|pulg|unidades|unidad|bolsas|bolsa|cajones|cajon|cajas|caja|chapas|chapa|baldosas|baldosa|ladrillos|ladrillo|rollos|rollo|varillas|varilla|tiras|tira|placas|placa|tubos|tubo|canos|cano)\b/g,
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{1,2}\s*(?:hs|h)\b/g,
  /\b\d{1,2}\s+a\s+\d{1,2}(?:\s*hs)?\b/g,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b/g,
];

const UNIT_AFTER = '(?:mm|cm|mts?|metros?|metro|kg|kgs|kilos?|bolsas?|unidades?|cajas?|chapas?|hs|hora|horas|pesos?|mil|millones|m2|m)';

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function overlapsAny(span: Span, list: Span[]): boolean {
  return list.some((other) => overlaps(span, other));
}

function pushMatches(
  folded: string,
  pattern: RegExp,
  kind: Span['kind'],
  into: Span[],
  accept?: (match: string, index: number) => boolean,
) {
  const re = new RegExp(pattern.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(folded))) {
    const text = match[0];
    if (!text) {
      re.lastIndex += 1;
      continue;
    }
    if (accept && !accept(text, match.index)) continue;
    into.push({ start: match.index, end: match.index + text.length, kind });
  }
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

function isThousands(token: string): boolean {
  return /^\d{1,3}(?:\.\d{3})+$/.test(token.trim());
}

function collectDigitPhones(folded: string, spans: Span[], ignored: Span[]) {
  const re = /(?:^|[^\d])((?:\+|00)?\d[\d\s().-]{5,28}\d)(?!\d)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(folded))) {
    const token = match[1] ?? '';
    const start = match.index + match[0].indexOf(token);
    const span: Span = { start, end: start + token.length, kind: 'telefono' };
    if (overlapsAny(span, ignored) || overlapsAny(span, spans)) continue;
    if (isThousands(token)) continue;
    const digits = digitsOf(token);
    if (digits.length >= 8 && digits.length <= 15) spans.push(span);
  }
}

function collectWordPhones(folded: string, spans: Span[], ignored: Span[]) {
  const tokenRe = /\b([a-z]+|\d{1,4})\b/g;
  const tokens: { word: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(folded))) {
    tokens.push({
      word: match[1] ?? '',
      start: match.index,
      end: match.index + (match[1]?.length ?? 0),
    });
  }

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) break;
    const contributes =
      NUM_WORD_DIGITS[token.word] != null || /^\d{1,4}$/.test(token.word);
    if (!contributes) {
      i += 1;
      continue;
    }
    let j = i;
    let digits = '';
    let words = 0;
    let sawWord = false;
    while (j < tokens.length) {
      const current = tokens[j];
      if (!current) break;
      if (current.word === 'y' && words > 0) {
        const next = tokens[j + 1];
        if (next && (NUM_WORD_DIGITS[next.word] != null || /^\d{1,4}$/.test(next.word))) {
          j += 1;
          continue;
        }
        break;
      }
      if (UNIT_WORDS.has(current.word) && !NUM_WORD_DIGITS[current.word]) break;
      const piece = NUM_WORD_DIGITS[current.word];
      if (piece) {
        digits += piece;
        sawWord = true;
        words += 1;
        j += 1;
        continue;
      }
      if (/^\d{1,4}$/.test(current.word)) {
        digits += current.word;
        words += 1;
        j += 1;
        continue;
      }
      break;
    }
    const first = tokens[i];
    const last = tokens[j - 1];
    if (
      first &&
      last &&
      sawWord &&
      words >= 6 &&
      digits.length >= 8 &&
      digits.length <= 15
    ) {
      const span: Span = { start: first.start, end: last.end, kind: 'telefono' };
      if (!overlapsAny(span, ignored) && !overlapsAny(span, spans)) spans.push(span);
    }
    i = Math.max(j, i + 1);
  }
}

function nameRejected(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((word) => NAME_STOP.has(word) || word.length < 3);
}

function sideRejected(name: string): boolean {
  const words = name.split(/\s+/).filter((word) => word.length >= 3);
  if (words.length === 0) return true;
  return words.every((word) => NAME_STOP.has(word));
}

function collectAddresses(folded: string, spans: Span[], ignored: Span[]) {
  const streetPrefix =
    '(?:av\\.?|avenida|calle|bv\\.?|bulevar|boulevard|pje\\.?|pasaje|diag\\.?|diagonal|ruta|camino)';
  const patterns: RegExp[] = [
    new RegExp(
      `\\b${streetPrefix}\\s+(?:[a-z0-9°º.]+\\s+){0,6}(?:n[°ºo]\\.?\\s*|nro\\.?\\s*|numero\\s+|altura\\s+)?\\d{1,5}\\b(?!\\s*${UNIT_AFTER}\\b)`,
      'g',
    ),
    new RegExp(`\\bruta\\s+\\d{1,3}\\s+km\\s*\\d{1,4}\\b`, 'g'),
    new RegExp(`\\baltura\\s+\\d{2,5}\\b`, 'g'),
    new RegExp(`\\bcodigo\\s+postal\\s+\\d{4}\\b`, 'g'),
    new RegExp(`\\bbarrio\\s+cerrado(?:\\s+[a-z0-9]{3,}){0,4}\\b`, 'g'),
    new RegExp(`\\bcountry\\s+[a-z]{3,}(?:\\s+[a-z]{3,}){0,3}\\b`, 'g'),
    new RegExp(`\\blote\\s+\\d{1,4}\\b`, 'g'),
    new RegExp(`\\bmanzana\\s+\\d{1,4}\\b`, 'g'),
    new RegExp(`\\bpiso\\s+\\d{1,2}(?:\\s*[a-z])?\\b`, 'g'),
    new RegExp(`\\b(?:depto|dpto|dto|departamento)\\.?\\s*(?:\\d{1,4}[a-z]?|[a-z]\\d{0,2})\\b`, 'g'),
    new RegExp(`\\bplanta\\s+baja\\b`, 'g'),
    new RegExp(`-?\\d{2}\\.\\d{4,}\\s*[, ]\\s*-?\\d{2,3}\\.\\d{4,}`, 'g'),
  ];

  for (const pattern of patterns) {
    pushMatches(folded, pattern, 'direccion', spans, (text, start) => {
      const span = { start, end: start + text.length, kind: 'direccion' as const };
      return !overlapsAny(span, ignored);
    });
  }

  pushMatches(
    folded,
    new RegExp(
      `\\b((?:[a-z]{4,}|[a-z]{3,}\\s+[a-z]{3,})(?:\\s+[a-z]{3,}){0,2})\\s+(\\d{3,5})\\b(?!\\s*${UNIT_AFTER}\\b)`,
      'g',
    ),
    'direccion',
    spans,
    (text, start) => {
      const name = text.replace(/\s+\d{3,5}$/, '');
      if (nameRejected(name)) return false;
      return !overlapsAny({ start, end: start + text.length, kind: 'direccion' }, ignored);
    },
  );

  const intersections = [
    /\b(?:esquina(?:\s+de)?|entre)\s+([a-z]{3,}(?:\s+[a-z]{3,}){0,2})\s+y\s+([a-z]{3,}(?:\s+[a-z]{3,}){0,2})\b/g,
    /\b([a-z]{3,}(?:\s+[a-z]{3,}){0,2})\s+y\s+([a-z]{3,}(?:\s+[a-z]{3,}){0,2})\s+esquina\b/g,
    /\b(?:calle|avenida|av\.?)\s+[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\s+y\s+(?:calle|avenida|av\.?)?\s*[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\b/g,
  ];
  for (const pattern of intersections) {
    const re = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(folded))) {
      const left = match[1] ?? '';
      const right = match[2] ?? '';
      if (left && right && sideRejected(left) && sideRejected(right)) continue;
      if (left && !right && sideRejected(left)) continue;
      const span: Span = {
        start: match.index,
        end: match.index + match[0].length,
        kind: 'direccion',
      };
      if (!overlapsAny(span, ignored)) spans.push(span);
    }
  }
}

function collect(folded: string): Span[] {
  const ignored: Span[] = [];
  for (const pattern of IGNORE_RES) {
    pushMatches(folded, pattern, 'ignore', ignored);
  }

  const spans: Span[] = [];

  pushMatches(
    folded,
    /\b(?:https?:\/\/|www\.)[^\s<>()]+/g,
    'url',
    spans,
  );
  pushMatches(
    folded,
    /\b(?:wa\.me|maps\.google|goo\.gl|maps\.app\.goo\.gl|instagram\.com|facebook\.com|fb\.com|fb\.me|t\.me|telegram\.me|bit\.ly|youtu\.be|waze\.com|google\.com\/maps|maps\.apple\.com)(?:\/[^\s<>()]*)?/g,
    'url',
    spans,
  );
  pushMatches(
    folded,
    /\b[a-z0-9][a-z0-9-]{0,40}\.(?:com|net|org|app|io|me|gl|ly|ar)(?:\.[a-z]{2})?(?:\/[^\s<>()]*)?/g,
    'url',
    spans,
    (text) => !text.includes('@'),
  );

  pushMatches(
    folded,
    /\b[a-z0-9][a-z0-9._%+-]{0,40}@[a-z0-9][a-z0-9.-]{0,40}\.[a-z]{2,}\b/g,
    'email',
    spans,
  );
  pushMatches(
    folded,
    /\b[a-z0-9][a-z0-9._%+-]{0,40}\s*(?:@|\(arroba\)|\[arroba\]|arroba)\s*[a-z0-9][a-z0-9-]{1,40}\s*(?:\.|\(punto\)|punto)\s*[a-z]{2,}(?:\s*(?:\.|punto)\s*[a-z]{2})?\b/g,
    'email',
    spans,
  );

  const cbuRe = /(?:^|[^\d])((?:\d[\s.-]?){22})(?!\d)/g;
  let cbu: RegExpExecArray | null;
  while ((cbu = cbuRe.exec(folded))) {
    const token = cbu[1] ?? '';
    if (digitsOf(token).length !== 22) continue;
    const start = cbu.index + cbu[0].indexOf(token);
    const span: Span = { start, end: start + token.length, kind: 'cbu' };
    if (!overlapsAny(span, ignored)) spans.push(span);
  }

  collectDigitPhones(folded, spans, ignored);
  collectWordPhones(folded, spans, ignored);

  pushMatches(
    folded,
    /\b[a-z][a-z0-9]{1,18}(?:\.[a-z][a-z0-9]{1,18}){2}\b/g,
    'alias',
    spans,
    (text) => {
      if (text.length < 6 || text.length > 20) return false;
      const parts = text.split('.');
      if (parts.length !== 3) return false;
      return parts.every((part) => part.length >= 2 && !ALIAS_DENY.has(part));
    },
  );

  pushMatches(folded, /(?<![a-z0-9._%+-])@[a-z0-9._]{3,30}\b/g, 'usuario', spans);

  pushMatches(
    folded,
    /\b(?:codigo|clave|pin)(?:\s+es)?\s*[:=]?\s*[a-z0-9][a-z0-9-]{3,15}\b/g,
    'codigo',
    spans,
    (text) => /\d/.test(text) && !/\bpostal\b/.test(text),
  );

  collectAddresses(folded, spans, ignored);

  return spans.filter((span) => span.kind !== 'ignore');
}

function applySpans(raw: string, spans: Span[]): OffplatformResult {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number; kinds: OffplatformKind[] }[] = [];
  for (const span of sorted) {
    if (span.kind === 'ignore') continue;
    const last = merged[merged.length - 1];
    if (!last || span.start > last.end) {
      merged.push({ start: span.start, end: span.end, kinds: [span.kind] });
      continue;
    }
    last.end = Math.max(last.end, span.end);
    if (!last.kinds.includes(span.kind)) last.kinds.push(span.kind);
  }

  if (merged.length === 0) {
    return { text: raw, kinds: [], changed: false, notice: null };
  }

  let text = '';
  let cursor = 0;
  const kinds: OffplatformKind[] = [];
  for (const span of merged) {
    text += raw.slice(cursor, span.start);
    text += OFFPLATFORM_REDACTION;
    cursor = span.end;
    for (const kind of span.kinds) {
      if (!kinds.includes(kind)) kinds.push(kind);
    }
  }
  text += raw.slice(cursor);
  return { text, kinds, changed: text !== raw, notice: OFFPLATFORM_NOTICE };
}

export function redactOffplatformContact(raw: string | null | undefined): OffplatformResult {
  const text = raw ?? '';
  if (!text) return { text, kinds: [], changed: false, notice: null };
  const folded = foldOffplatformText(text);
  return applySpans(text, collect(folded));
}

export function offplatformNoticeFor(raw: string | null | undefined): string | null {
  return redactOffplatformContact(raw).notice;
}

/**
 * Texto que se manda. Si al reemplazar queda más corto que el mínimo del
 * campo (fundamentos), se envía el original y lo redacta el servidor.
 */
export function offplatformSubmitText(raw: string, minLength = 0): string {
  const trimmed = raw.trim();
  const redacted = redactOffplatformContact(trimmed);
  if (!redacted.changed) return trimmed;
  if (minLength > 0 && redacted.text.trim().length < minLength) return trimmed;
  return redacted.text.trim();
}

/** Campo opcional: vacío queda null. Si hay un dato, vuelve el texto ya reemplazado. */
export function offplatformSubmitOptional(raw: string | null | undefined): string | null {
  const text = offplatformSubmitText(raw ?? '');
  return text ? text : null;
}

export const OFFPLATFORM_TEXT_KEYS = [
  'service_detail',
  'description',
  'caption',
  'notes',
  'note',
  'detail',
  'comment',
  'label',
  'title',
  'text',
  'message',
  'fundamentos',
  'item_note',
  'alternative_description',
  'variant_label',
] as const;

function redactValue(value: unknown, depth: number): { value: unknown; kinds: OffplatformKind[] } {
  if (depth > 4 || value == null) return { value, kinds: [] };
  if (typeof value === 'string') {
    const redacted = redactOffplatformContact(value);
    return { value: redacted.text, kinds: redacted.kinds };
  }
  if (Array.isArray(value)) {
    const kinds: OffplatformKind[] = [];
    const next = value.map((item) => {
      const child = redactValue(item, depth + 1);
      for (const kind of child.kinds) if (!kinds.includes(kind)) kinds.push(kind);
      return child.value;
    });
    return { value: next, kinds };
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...rec };
    const kinds: OffplatformKind[] = [];
    for (const key of OFFPLATFORM_TEXT_KEYS) {
      if (!(key in copy)) continue;
      const child = redactValue(copy[key], depth + 1);
      copy[key] = child.value;
      for (const kind of child.kinds) if (!kinds.includes(kind)) kinds.push(kind);
    }
    return { value: copy, kinds };
  }
  return { value, kinds: [] };
}

export function redactOffplatformMessage(
  type: string | null | undefined,
  body: string | null | undefined,
  metadata?: unknown,
): { body: string; metadata: unknown; kinds: OffplatformKind[]; notice: string | null } {
  if ((type ?? 'text') === 'system') {
    return { body: body ?? '', metadata, kinds: [], notice: null };
  }
  const bodyResult = redactOffplatformContact(body ?? '');
  const metaResult = redactValue(metadata, 0);
  const kinds = [...bodyResult.kinds];
  for (const kind of metaResult.kinds) if (!kinds.includes(kind)) kinds.push(kind);
  return {
    body: bodyResult.text,
    metadata: metaResult.value,
    kinds,
    notice: kinds.length > 0 ? OFFPLATFORM_NOTICE : null,
  };
}
