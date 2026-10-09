/**
 * Antipuenteo, primera capa (sin IA).
 *
 * No se bloquea por la palabra («dirección», «teléfono», «ubicación»,
 * «whatsapp», «mail», «calle»…). Se detecta el dato y se reemplaza por «•••».
 * El envío sigue. La misma regla vive en el cliente y en
 * public.redact_offplatform_contact (SQL).
 *
 * La comparación contra el teléfono y la dirección cargados en el perfil
 * (match_perfil) vive solo en el servidor. Este archivo no la hace.
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
  | 'direccion'
  | 'canal';

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
  trenta: '30',
  cuarenta: '40',
  cincuenta: '50',
  sesenta: '60',
  setenta: '70',
  ochenta: '80',
  noventa: '90',
  sero: '0',
  cuato: '4',
  sinco: '5',
  sies: '6',
  nuebe: '9',
  beinte: '20',
};

const DECADE_BASE: Record<string, number> = {
  veinte: 20,
  beinte: 20,
  treinta: 30,
  trenta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const UNIT_VALUE: Record<string, number> = {
  uno: 1,
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cuato: 4,
  cinco: 5,
  sinco: 5,
  seis: 6,
  sies: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  nuebe: 9,
};

/** «trentaiuno», «treinta y uno» escrito pegado, «veintiuno». */
function fusedDecadeDigits(word: string): string | null {
  const veinti = /^(?:veinti|beinti)(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)$/.exec(word);
  if (veinti) {
    const unit = UNIT_VALUE[veinti[1] ?? ''];
    if (unit != null) return String(20 + unit);
  }
  const fused =
    /^(trenta|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|beinte|veinte)(?:i|y)(uno|un|dos|tres|cuatro|cuato|cinco|sinco|seis|sies|siete|ocho|nueve|nuebe)$/.exec(
      word,
    );
  if (!fused) return null;
  const base = DECADE_BASE[fused[1] ?? ''];
  const unit = UNIT_VALUE[fused[2] ?? ''];
  if (base == null || unit == null) return null;
  return String(base + unit);
}

function tokenDigits(word: string): string | null {
  const fused = fusedDecadeDigits(word);
  if (fused) return fused;
  const mapped = NUM_WORD_DIGITS[word];
  if (mapped) return mapped;
  if (/^\d{1,4}$/.test(word)) return word;
  return null;
}

function spokenNumber(word: string): boolean {
  return fusedDecadeDigits(word) != null || NUM_WORD_DIGITS[word] != null;
}

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
  'miles',
  'millones',
  'millon',
  'peso',
  'pesos',
  'lucas',
  'luca',
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

/**
 * Palabra pegada a un número que no es una calle: verbo de precio, o
 * modelo / año / código de producto. Aunque arranque en mayúscula.
 * Tiene que coincidir con street_block en el SQL.
 */
const STREET_BLOCK = new Set([
  'cobro',
  'cobra',
  'cobramos',
  'cobran',
  'cobras',
  'cobren',
  'sale',
  'salen',
  'salio',
  'cuesta',
  'cuestan',
  'son',
  'sos',
  'dejame',
  'dejamelo',
  'deja',
  'dejenme',
  'pago',
  'paga',
  'pagan',
  'pagame',
  'pagas',
  'sena',
  'senia',
  'presupuesto',
  'presupuestos',
  'modelo',
  'modelos',
  'ano',
  'anio',
  'anos',
  'codigo',
  'codigos',
  'producto',
  'productos',
  'hora',
  'horas',
  'adelanto',
  'item',
  'items',
  'total',
  'precio',
  'precios',
  'mano',
  'obra',
]);

const STREET_CONNECTOR = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

const UPPER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ';

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
  /\b\d+(?:[.,]\d+)?\s*(?:mil|millones|pesos|peso|ars|lucas|luca)\b/g,
  /\b(?:cero|sero|uno|una|dos|tres|cuatro|cuato|cinco|sinco|seis|sies|siete|ocho|nueve|nuebe|diez|once|doce|trece|catorce|quince|veinte|beinte|treinta|trenta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+(?:mil|lucas|luca|pesos|peso)\b/g,
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

const PHONE_FILLERS = new Set([
  'y',
  'e',
  'o',
  'van',
  'mas',
  'que',
  'eh',
  'va',
  'hay',
  'son',
  'es',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'al',
  'por',
  'con',
]);

const AMOUNT_BREAK = new Set([
  'mil',
  'miles',
  'millones',
  'millon',
  'peso',
  'pesos',
  'lucas',
  'luca',
  'ars',
]);

function softGap(folded: string, prevEnd: number, nextStart: number): boolean {
  return /^[\s,]*$/.test(folded.slice(prevEnd, nextStart));
}

function collectWordPhones(folded: string, spans: Span[], ignored: Span[]) {
  const tokenRe = /\b([a-z]+|\d{1,4})\b/g;
  const tokens: { word: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(folded))) {
    const word = match[1] ?? '';
    const start = match.index;
    const end = match.index + word.length;
    const span = { start, end, kind: 'ignore' as const };
    if (overlapsAny(span, ignored)) continue;
    tokens.push({ word, start, end });
  }

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token || tokenDigits(token.word) == null) {
      i += 1;
      continue;
    }
    let j = i;
    let digits = '';
    let words = 0;
    let sawWord = false;
    let aborted = false;
    let prevEnd = token.start;
    while (j < tokens.length) {
      const current = tokens[j];
      if (!current) break;
      if (words > 0 && !softGap(folded, prevEnd, current.start)) break;
      if (words > 0 && AMOUNT_BREAK.has(current.word)) {
        aborted = true;
        break;
      }
      const decade = DECADE_BASE[current.word];
      const joiner = tokens[j + 1];
      const unitTok = tokens[j + 2];
      if (
        decade != null &&
        joiner?.word === 'y' &&
        unitTok &&
        UNIT_VALUE[unitTok.word] != null &&
        softGap(folded, current.end, joiner.start) &&
        softGap(folded, joiner.end, unitTok.start)
      ) {
        digits += String(decade + (UNIT_VALUE[unitTok.word] ?? 0));
        sawWord = true;
        words += 1;
        prevEnd = unitTok.end;
        j += 3;
        continue;
      }
      const piece = tokenDigits(current.word);
      if (piece) {
        digits += piece;
        if (spokenNumber(current.word)) sawWord = true;
        words += 1;
        prevEnd = current.end;
        j += 1;
        continue;
      }
      if (words > 0 && PHONE_FILLERS.has(current.word)) {
        let k = j;
        let fillers = 0;
        let end = prevEnd;
        while (k < tokens.length && fillers < 3 && PHONE_FILLERS.has(tokens[k]?.word ?? '')) {
          const filler = tokens[k];
          if (!filler || !softGap(folded, end, filler.start)) break;
          end = filler.end;
          k += 1;
          fillers += 1;
        }
        const next = tokens[k];
        if (fillers > 0 && next && tokenDigits(next.word) != null && softGap(folded, end, next.start)) {
          prevEnd = end;
          j = k;
          continue;
        }
      }
      break;
    }
    const first = tokens[i];
    const last = tokens[j - 1];
    if (
      !aborted &&
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
    i = aborted ? j + 1 : Math.max(j, i + 1);
  }
}

const PASS_VERBS =
  'pasame|pasar|pasamos|paso|mandame|agregame|escribime|anotame|tirame|manda|agrega|pasa';
const OFF_CHANNELS = 'whatsapp|wsp|wp|instagram|insta|facebook|telegram';

function collectOffplatformIntent(folded: string, spans: Span[], ignored: Span[]) {
  const verbRe = new RegExp(`\\b(?:${PASS_VERBS})\\b`);
  const channelRe = new RegExp(`\\b(?:por|al)\\s+(?:${OFF_CHANNELS})\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = channelRe.exec(folded))) {
    const before = folded.slice(Math.max(0, match.index - 60), match.index);
    if (!verbRe.test(before)) continue;
    const span: Span = {
      start: match.index,
      end: match.index + match[0].length,
      kind: 'canal',
    };
    if (!overlapsAny(span, ignored) && !overlapsAny(span, spans)) spans.push(span);
  }

  const imperativeRe =
    /\b(?:pasame|mandame|agregame|escribime|anotame|tirame|manda|agrega|pasa)\s+(?:(?:tu|el|la|un|una|mi|su)\s+)?(?:telefono|telefonos|celular|celu|numero|nro|whatsapp|wsp|wp|instagram|insta)\b/g;
  while ((match = imperativeRe.exec(folded))) {
    const span: Span = {
      start: match.index,
      end: match.index + match[0].length,
      kind: 'canal',
    };
    if (!overlapsAny(span, ignored) && !overlapsAny(span, spans)) spans.push(span);
  }

  const offerRe =
    /\b(?:te\s+|me\s+|le\s+)?(?:paso|pasar|pasamos)\s+(?:(?:la|el|mi|tu|un|una|su)\s+){0,2}(?:telefono|telefonos|celular|celu|numero|nro)\b/g;
  while ((match = offerRe.exec(folded))) {
    const span: Span = {
      start: match.index,
      end: match.index + match[0].length,
      kind: 'canal',
    };
    if (!overlapsAny(span, ignored) && !overlapsAny(span, spans)) spans.push(span);
  }
}

function sideRejected(name: string): boolean {
  const words = name.split(/\s+/).filter((word) => word.length >= 3);
  if (words.length === 0) return true;
  return words.every((word) => NAME_STOP.has(word));
}

type StreetWord = { start: number; end: number; text: string };

function wordsBeforeNumber(folded: string, numStart: number): StreetWord[] {
  const words: StreetWord[] = [];
  let cursor = numStart;
  while (cursor > 0 && /\s/.test(folded[cursor - 1] ?? '')) cursor--;
  while (words.length < 4 && cursor > 0 && /[a-z]/.test(folded[cursor - 1] ?? '')) {
    const end = cursor;
    while (cursor > 0 && /[a-z]/.test(folded[cursor - 1] ?? '')) cursor--;
    words.unshift({ start: cursor, end, text: folded.slice(cursor, end) });
    let gap = cursor;
    while (gap > 0 && /\s/.test(folded[gap - 1] ?? '')) gap--;
    if (gap > 0 && /[a-z]/.test(folded[gap - 1] ?? '')) {
      cursor = gap;
      continue;
    }
    break;
  }
  return words;
}

function isStreetName(raw: string, word: StreetWord): boolean {
  if (word.text.length < 3) return false;
  if (STREET_BLOCK.has(word.text) || NAME_STOP.has(word.text)) return false;
  return UPPER_LETTERS.includes(raw.charAt(word.start));
}

/** Calle y altura sin «calle»/«av.»: solo el nombre propio pegado al número. */
function collectBareStreets(raw: string, folded: string, spans: Span[], ignored: Span[]) {
  const re = new RegExp(`(?<!\\d)(\\d{3,5})(?!\\d)(?!\\s*${UNIT_AFTER}\\b)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(folded))) {
    const numStart = match.index;
    const numEnd = numStart + (match[1]?.length ?? 0);
    const words = wordsBeforeNumber(folded, numStart);
    if (words.length === 0) continue;
    const head = words[words.length - 1];
    if (!head || !isStreetName(raw, head)) continue;
    let start = head.start;
    let i = words.length - 2;
    while (i >= 0) {
      const word = words[i];
      if (!word) break;
      if (STREET_CONNECTOR.has(word.text) && i >= 1) {
        const prev = words[i - 1];
        if (prev && isStreetName(raw, prev)) {
          start = prev.start;
          i -= 2;
          continue;
        }
        break;
      }
      if (isStreetName(raw, word)) {
        start = word.start;
        i -= 1;
        continue;
      }
      break;
    }
    const span: Span = { start, end: numEnd, kind: 'direccion' };
    if (!overlapsAny(span, ignored) && !overlapsAny(span, spans)) spans.push(span);
  }
}

function collectAddresses(raw: string, folded: string, spans: Span[], ignored: Span[]) {
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

  collectBareStreets(raw, folded, spans, ignored);

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

function collect(raw: string, folded: string): Span[] {
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
  collectOffplatformIntent(folded, spans, ignored);

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

  collectAddresses(raw, folded, spans, ignored);

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
  return applySpans(text, collect(text, folded));
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
