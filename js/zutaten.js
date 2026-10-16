// Zutaten-Logik ohne DOM: Zeilen zerlegen, Mengen umrechnen, zusammenfassen
// und für die Anzeige formatieren. Läuft im Browser und in Node (Tests).

// ---------------------------------------------------------------- Einheiten und Muster

// [id, Einzahl, Mehrzahl, Familie, Faktor zur Basis, Schreibweisen (klein)]
const EINHEITEN_LISTE = [
  ['g', 'g', 'g', 'masse', 1, 'g gr gr. gramm'], ['kg', 'kg', 'kg', 'masse', 1000, 'kg kilo kilogramm'],
  ['mg', 'mg', 'mg', 'masse', 0.001, 'mg milligramm'], ['dag', 'dag', 'dag', 'masse', 10, 'dag dkg dekagramm'],
  ['Pfund', 'Pfund', 'Pfund', 'masse', 500, 'pfund pfd.'], ['ml', 'ml', 'ml', 'volumen', 1, 'ml milliliter'],
  ['cl', 'cl', 'cl', 'volumen', 10, 'cl zentiliter centiliter'], ['dl', 'dl', 'dl', 'volumen', 100, 'dl deziliter'],
  ['l', 'l', 'l', 'volumen', 1000, 'l liter ltr ltr.'],
  ['EL', 'EL', 'EL', 'loeffel', 3, 'el el. essl. esslöffel eßlöffel eßl. c.s.'],
  ['TL', 'TL', 'TL', 'loeffel', 1, 'tl tl. teel. teelöffel c.c.'],
  ['Stück', 'Stück', 'Stück', 'stueck', 1, 'stück stücke stk stk. st. stck stck.'],
  ['Packung', 'Pck.', 'Pck.', 'Packung', 1,
    'packung packungen pck. pck pckg. pkg. pkg pk. pkt. päckchen päckli packerl pack paket pakete beutel tüte tüten'],
  // nicht summierbar
  ['Prise', 'Prise', 'Prisen', null, null, 'prise prisen pr.'], ['Tropfen', 'Tropfen', 'Tropfen', null, null, 'tropfen'],
  ['Msp', 'Msp.', 'Msp.', null, null, 'msp msp. messerspitze messerspitzen'],
  ['Handvoll', 'Handvoll', 'Handvoll', null, null, 'handvoll händevoll'],
  ['Spritzer', 'Spritzer', 'Spritzer', null, null, 'spritzer'], ['Schuss', 'Schuss', 'Schuss', null, null, 'schuss schüsse'],
];
// Behälter und Stückiges: eigene Familie, Faktor 1 ('Einzahl/Mehrzahl weitere Schreibweisen')
const BEHAELTER = ['Bund/Bund bd. bunde bündel', 'Dose/Dosen ds.', 'Zehe/Zehen', 'Scheibe/Scheiben',
  'Stange/Stangen stg.', 'Zweig/Zweige', 'Stiel/Stiele stängel', 'Blatt/Blätter bl.', 'Becher/Becher',
  'Glas/Gläser gl.', 'Tasse/Tassen', 'Würfel/Würfel', 'Kopf/Köpfe', 'Knolle/Knollen', 'Rolle/Rollen',
  'Topf/Töpfe', 'Tafel/Tafeln', 'Flasche/Flaschen fl.', 'Schale/Schalen', 'Kugel/Kugeln'];
for (const [namen, ...weitere] of BEHAELTER.map((b) => b.split(' '))) {
  const [ez, mz] = namen.split('/');
  EINHEITEN_LISTE.push([ez, ez, mz, ez, 1, [ez.toLowerCase(), mz.toLowerCase(), ...weitere].join(' ')]);
}

/** Einheit-id → { name, plural, familie, faktor }. familie null = nicht summierbar. */
export const EINHEITEN = {};
const ALIAS = new Map();
for (const [id, name, plural, familie, faktor, aliase] of EINHEITEN_LISTE) {
  EINHEITEN[id] = Object.freeze({ name, plural, familie, faktor });
  ALIAS.set(id.toLowerCase(), id);
  for (const a of aliase.split(' ')) ALIAS.set(a, id);
}
Object.freeze(EINHEITEN);

// Basis-Einheit je Familie (Behälter-Familien sind ihre eigene Basis)
const BASIS = { masse: 'g', volumen: 'ml', loeffel: 'TL', stueck: 'Stück' };

const BRUECHE = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6,
  '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const BZ = '[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]';
const ZAHL = `(?:\\d+ \\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)? ?${BZ}|\\d+(?:[.,]\\d+)?|${BZ})`;
const MENGE_RE = new RegExp(`^(${ZAHL})(?: ?(?:-|–|bis|oder) ?(${ZAHL}))?(.*)$`, 'i');
const ZAHL_VORNE_RE = new RegExp(`^(?:\\d|${BZ})`);
const WORTZAHLEN = { ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eines: 1, zwei: 2, drei: 3, vier: 4,
  fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12,
  halb: 0.5, halbe: 0.5, halber: 0.5, halbes: 0.5, halben: 0.5, viertel: 0.25, dreiviertel: 0.75,
  anderthalb: 1.5, eineinhalb: 1.5 };

// 'Zwiebel(n)', 'Ei(er)': vor dem Herauslösen der Klammern durch Marken ersetzt
const ENDUNG_RE = /(\p{L}) ?\((n|en|e|er|s|nen|ern)\)/gu;
const MARKIERT_RE = /\uE000(\p{L}+)\uE001/gu;

const ADJ = 'e[rsnm]?';
const GROESSE_RE = new RegExp(`^(?:kl\\.?|klein(?:${ADJ})?|gr\\.|gro(?:ß|ss)(?:${ADJ})?|mittelgro(?:ß|ss)(?:${ADJ})?|` +
  `mittlere[rsnm]?|mittel|geh\\.|gehäuft(?:${ADJ})?|gestr\\.|gestrichen(?:${ADJ})?|knapp(?:${ADJ})?|gut(?:${ADJ})?)$`, 'i');
const GROESSE_OHNE_MENGE_RE = new RegExp(`^(?:kl\\.|klein(?:${ADJ})?|gr\\.|gro(?:ß|ss)(?:${ADJ})?|` +
  `mittelgro(?:ß|ss)(?:${ADJ})?|mittlere[rsnm]?)$`, 'i');
const LOEFFEL_ZUSATZ_RE = new RegExp(`^(?:geh\\.|gehäuft(?:${ADJ})?|gestr\\.|gestrichen(?:${ADJ})?)$`, 'i');
const LOEFFEL_EINHEITEN = new Set(['EL', 'TL', 'Tasse', 'Msp']);

const VAGE_VORNE_RE = /^(etwas|etw\.|ein wenig|ein bisschen|ein paar|einige|reichlich|wenig|evtl\.|eventuell|optional|n\. ?b\.|nach belieben|nach geschmack)(?: +|$)/i;
const UNGEFAEHR_RE = /^(ca\.?|circa|zirka|etwa|ungefähr|je|gut|knapp) *(?=\d|[½⅓⅔¼¾]|(?:ein|eine|zwei|drei|vier|fünf|sechs)\b)/i;
const VAGE_NOTIZ_RE = /nach belieben|nach geschmack|n\. ?b\.|optional|evtl\.|eventuell|bei bedarf|aus der mühl?e|^(?:zum|zur) |für (?:die|das|den) (?:form|blech|backblech|pfanne)/i;
const VAGE_NAME_RE = /(?:salz|pfeffer|muskat|muskatnuss|wasser|fleur de sel)$/;
const SAFT_RE = new RegExp('^((?:(?:frisch )?(?:gepresste[rns]?|abgeriebene[rnms]?|geriebene[rnms]?) )?' +
  '(?:saft|abrieb|schale|zesten?|fruchtfleisch)(?: (?:und|&|\\+) (?:(?:abgeriebene[rnms]?|geriebene[rnms]?) )?' +
  '(?:saft|abrieb|schale|zesten?))?)(?: (?:von|aus|vom))? (?=\\d|' + BZ +
  '|(?:einer|eines|einem|ein|eine|zwei|drei|vier|halben?)\\b)(.+)$', 'i');
// Zusätze, die vom Namen in die Notiz wandern ('Öl zum Braten', 'Spinat oder Mangold')
const NOTIZ_TRENNER_RE = / (?=(?:zum|zur) \p{L}|für (?:die|das|den) (?:form|blech|backblech|pfanne)|nach belieben|nach geschmack|n\. ?b\.|aus der mühl?e\b|oder |alternativ|bzw\. |à |a (?=\d)|optional|evtl\.)/iu;
const TK_RE = /^(?:tk|tiefgekühlt|tiefgefroren|tiefkühl(?:ware)?|gefroren)$/i;

// ---------------------------------------------------------------- Hilfen

const rund = (x) => Math.round(x * 1e6) / 1e6;
const zahlOk = (x) => x != null && x !== '' && Number.isFinite(Number(x));

const neueIdLokal = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function normalisiere(text) {
  return String(text ?? '').normalize('NFC')
    .replace(/[\u00a0\u2007\u2009\u202f\t]/g, ' ')
    .replace(/[\u2044\u2215]/g, '/')
    .replace(/[\u2012\u2013\u2014\u2212]/g, '–')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(?:[•▢☐■□✓✔·▪◦►]|[*\-–](?= ))\s*/, '');
}

/** Klammern (auch verschachtelt/offen) herauslösen. Text behält seine Länge (Positionen bleiben gültig). */
function klammernHeraus(s) {
  const notizen = [];
  let text = '', inhalt = '', start = 0, tiefe = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') {
      if (tiefe++ === 0) start = i;
      else inhalt += ' ';
    } else if (ch === ')' || ch === ']') {
      if (tiefe > 0 && --tiefe === 0) { notizen.push({ text: inhalt, pos: start }); inhalt = ''; }
    } else if (tiefe > 0) inhalt += ch;
    text += tiefe > 0 || '()[]'.includes(ch) ? ' ' : ch;
  }
  if (tiefe > 0) notizen.push({ text: inhalt, pos: start });
  notizen.forEach((n) => { n.text = n.text.replace(/\s+/g, ' ').trim(); });
  return { text, notizen: notizen.filter((n) => n.text) };
}

// Satzzeichen/Striche an den Rändern weg und 'Pinseln.' → 'Pinseln' (ohne Regex-Backtracking bei langen Zeilen)
function stutze(t) {
  let a = 0, b = t.length;
  while (a < b && ' ,;:–-'.includes(t[a])) a++;
  while (b > a && ' ,;:–-'.includes(t[b - 1])) b--;
  t = t.slice(a, b);
  return t.endsWith('.') && /^\p{L}{5}$/u.test(t.slice(-6, -1)) ? t.slice(0, -1) : t;
}

// Erstes Komma/Semikolon, das nicht zu einer Dezimalzahl gehört
function kommaIndex(s) {
  for (let i = 0; i < s.length; i++) if ((s[i] === ',' || s[i] === ';') && !/\d/.test(s[i + 1] ?? '')) return i;
  return -1;
}

// 'Zwiebel / Zwiebeln' → 'Zwiebel'; echte Alternativen ('Salz/Pfeffer') bleiben stehen
function slashAlternative(text) {
  const m = text.match(/^([^/\d]+?) ?\/ ?([^/\d]+)$/);
  if (!m) return text;
  const a = m[1].trim();
  return a.length >= 2 && m[2].trim().toLowerCase().startsWith(a.slice(0, 4).toLowerCase()) ? a : text;
}

// Ohne Menge zählen nur eindeutige, längere Schreibweisen ('Bund', 'Prise', nicht 'g')
function einheitAusToken(tok, mitMenge) {
  if (!tok) return null;
  const t = tok.toLowerCase().replace(/[,;:]+$/, '');
  const id = ALIAS.get(t) ?? (t.endsWith('.') ? ALIAS.get(t.slice(0, -1)) : ALIAS.get(t + '.'));
  return id && (mitMenge || t.length >= 4) ? id : null;
}

// Einheit-id aus id oder Schreibweise; Unbekanntes bleibt, wie es ist
function einheitId(unit) {
  if (unit == null || unit === '' || EINHEITEN[unit]) return unit || null;
  return einheitAusToken(String(unit).trim(), true) ?? String(unit).trim();
}

function wortzahlenErsetzen(s) {
  const t = s.split(' ');
  const w = (x) => WORTZAHLEN[String(x ?? '').toLowerCase()];
  if (t.length < 2 || w(t[0]) == null) return s;
  t[0] = String(w(t[0]));
  if (t.length > 3 && /^(?:bis|oder|-|–)$/i.test(t[1]) && w(t[2]) != null) t[2] = String(w(t[2]));
  return t.join(' ');
}

// ---------------------------------------------------------------- Zahlen und Zeilen lesen

/** Liest '1', '1,5', '800.0', '½', '1 ½', '1/2', '1 1/2', 'zwei', 'anderthalb' … → Zahl oder null. */
export function parseZahl(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const s = String(text ?? '').normalize('NFC').toLowerCase()
    .replace(/[\u2044\u2215]/g, '/').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (WORTZAHLEN[s] != null) return WORTZAHLEN[s];
  let m = s.match(/^(\p{L}+)einhalb$/u);
  if (m && WORTZAHLEN[m[1]] >= 1) return WORTZAHLEN[m[1]] + 0.5;
  if (BRUECHE[s] != null) return BRUECHE[s];
  if ((m = s.match(new RegExp(`^(\\d+(?:[.,]\\d+)?) ?(${BZ})$`)))) return rund(+m[1].replace(',', '.') + BRUECHE[m[2]]);
  if ((m = s.match(/^(\d+) (\d+)\/(\d+)$/))) return +m[3] ? rund(+m[1] + m[2] / m[3]) : null;
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[2] ? rund(m[1] / m[2]) : null;
  return /^\d+(?:[.,]\d+)?$/.test(s) ? parseFloat(s.replace(',', '.')) : null;
}

/** Zerlegt eine Zutatenzeile → { raw, qty, qty2, unit, size, name, note, vague } oder null. */
export function parseZeile(roh) {
  const raw = normalisiere(roh);
  if (!raw) return null;
  let qty = null, qty2 = null, unit = null, vageWort = null, zahlText = null;
  const groessen = [], vorn = [];
  // Endungen markieren, Klammern als Notiz herauslösen
  const k = klammernHeraus(raw.replace(ENDUNG_RE, '$1\uE000$2\uE001'));
  let s = k.text.replace(/\bhand voll\b/gi, 'Handvoll').replace(/\s+/g, ' ').trim();
  let m;
  // 'Saft von 1 Zitrone' → 1 Zitrone (Saft); 'oder …' als eigene Zeile; 'evtl. 1 TL Zucker'
  if ((m = s.match(SAFT_RE))) { vorn.push(m[1]); s = m[2]; }
  if ((m = s.match(/^(oder|alternativ:?|bzw\.?) +/i))) { vorn.push(m[1].replace(/:$/, '')); s = s.slice(m[0].length); }
  if ((m = s.match(/^(evtl\.|eventuell|optional|wahlweise) +(?=\d|[½⅓⅔¼¾])/i))) {
    vorn.push(m[1]);
    s = s.slice(m[0].length);
  }
  if ((m = s.match(VAGE_VORNE_RE)) && !ZAHL_VORNE_RE.test(s.slice(m[0].length))) {
    [vageWort, s] = [m[1], s.slice(m[0].length)];
  } else if ((m = s.match(UNGEFAEHR_RE))) {
    if (/^(?:gut|knapp)$/i.test(m[1])) groessen.push(m[1].toLowerCase());
    s = s.slice(m[0].length);
  }
  if (!vageWort) s = wortzahlenErsetzen(s);
  // Menge und Spanne ('1-2', '1 bis 2'); '7-Korn-…' und '100%' sind keine Mengen
  m = s.match(MENGE_RE);
  if (m && !/^ ?(?:[-–]\p{L}|%)/u.test(m[3]) && (qty = parseZahl(m[1])) != null) {
    qty2 = m[2] ? parseZahl(m[2]) : null;
    if (qty2 === qty) qty2 = null;
    zahlText = m[1];
    s = m[3].replace(/^ ?[x×] +/i, '');
  }
  s = s.replace(MARKIERT_RE, (qty2 ?? qty ?? 0) > 1 ? '$1' : '').replace(/\s+/g, ' ').trim();
  const toks = s ? s.split(' ') : [];
  if (qty === 1 && toks.length > 1 && /^halbe[nrs]?$/i.test(toks[0])) { qty = 0.5; toks.shift(); }
  // Größe vor der Einheit ('1 kl. Bund', '2 große Eier'); 'gr.' bei großen Mengen = Gramm
  while (toks.length > 1 && (qty != null ? GROESSE_RE : GROESSE_OHNE_MENGE_RE).test(toks[0])) {
    if (/^gr\.$/i.test(toks[0]) && qty != null && qty > 4 && !einheitAusToken(toks[1], true)) break;
    groessen.push(toks.shift());
  }
  // Einheit (doppelte nur einmal: '4 El El Essig'), danach 'gestr.'/'gehäuft'
  const id = einheitAusToken(toks[0], qty != null);
  if (id && toks.length > 1) {
    unit = id;
    toks.shift();
    if (toks.length > 1 && einheitAusToken(toks[0], true) === id) toks.shift();
    while (LOEFFEL_EINHEITEN.has(unit) && toks.length > 1 && LOEFFEL_ZUSATZ_RE.test(toks[0])) {
      groessen.push(toks.shift());
    }
    if (toks.length > 1 && /^(?:de|des|du)$/i.test(toks[0])) toks.shift(); // '120 g de sucre' (Schweiz, franz.)
    else if (/^d['’]\p{L}/iu.test(toks[0] ?? '')) toks[0] = toks[0].slice(2);
  }
  // '1.000 g' = tausend Gramm (bei kg/l bleibt der Punkt ein Dezimalpunkt)
  if (/^\d{1,3}(?:\.\d{3})+$/.test(zahlText ?? '') && ['g', 'ml', 'mg'].includes(unit)) qty = +zahlText.replace(/\./g, '');
  // Name; Komma-Rest und Zusätze wie 'zum Braten' werden Notiz
  let name = toks.join(' ');
  let kommaNotiz = null, trennerNotiz = null;
  const ki = kommaIndex(name);
  if (ki >= 0) { kommaNotiz = name.slice(ki + 1).trim(); name = name.slice(0, ki); }
  const ti = name.search(NOTIZ_TRENNER_RE);
  if (ti > 0) { trennerNotiz = name.slice(ti + 1).trim(); name = name.slice(0, ti); }
  name = stutze(slashAlternative(name.trim()));
  // Notizen in Text-Reihenfolge; '(gestrichen)' → Größe, '(TK)' → Name 'TK-…' (für die Abteilung)
  const grenzen = [kommaIndex(k.text), k.text.search(NOTIZ_TRENNER_RE)].filter((i) => i > 0);
  const grenze = grenzen.length ? Math.min(...grenzen) : Infinity;
  const klammer = (vorGrenze) => k.notizen.filter((n) => (n.pos < grenze) === vorGrenze)
    .map((n) => n.text.replace(MARKIERT_RE, '($1)'));
  let notizen = [...vorn, ...klammer(true), trennerNotiz, kommaNotiz, ...klammer(false)].filter(Boolean);
  notizen = notizen.filter((n) => !(GROESSE_RE.test(n) && groessen.push(n)));
  const tk = notizen.findIndex((n) => TK_RE.test(n));
  if (tk >= 0 && name) {
    notizen.splice(tk, 1);
    if (!/(?:^|[\s-])tk\b|tiefkühl/i.test(name)) name = (name.includes(' ') ? 'TK ' : 'TK-') + name;
  }
  // 'nach Belieben' vorne gehört in die Notiz, 'etwas'/'einige' bleiben als Größe sichtbar
  if (vageWort && /^(?:n\.|nach)/i.test(vageWort)) notizen.unshift(vageWort);
  const note = notizen.join(', ') || null;
  if (!name) {
    // nichts Brauchbares übrig: ganze Zeile als Name, ohne Menge (Vorschau warnt)
    const text = k.text.replace(MARKIERT_RE, '($1)').replace(/\s+/g, ' ').trim() || raw;
    return { raw, qty: null, qty2: null, unit: null, size: null, name: text, note, vague: false };
  }
  const vague = qty == null && (Boolean(vageWort) || notizen.some((n) => VAGE_NOTIZ_RE.test(n)) ||
    (unit != null && EINHEITEN[unit].familie === null) || (unit == null && VAGE_NAME_RE.test(zutatSchluessel(name))));
  const vorne = vageWort && !/^(?:n\.|nach)/i.test(vageWort) ? vageWort.toLowerCase() : null;
  const size = [vorne, ...groessen].filter(Boolean).join(' ') || null;
  return { raw, qty, qty2, unit, size, name, note, vague };
}

// Gruppen-Überschrift? → Text, null ('Zutaten:' setzt zurück) oder undefined (keine)
function gruppenKopf(z) {
  const ZUTATEN = /^zutaten(?: *\(?(?:für )?\d+.*)?$/i;
  let m, t;
  if (z.length > 80) return undefined;
  if ((m = z.match(/^#{1,6} *(.+?) *#*$/))) t = m[1];
  else if ((m = z.match(/^(?:\*\*|__)(.+?)(?:\*\*|__):?$/))) t = m[1];
  else if ((m = z.match(/^[-=_~*]{2,} *(.+?) *[-=_~*]{2,}$/))) t = m[1];
  else if (z.endsWith(':') && !ZAHL_VORNE_RE.test(z)) t = z;
  else return ZUTATEN.test(z) ? null : undefined;
  t = t.replace(/:+$/, '').trim();
  return !t || ZUTATEN.test(t) ? null : t;
}

/** Mehrzeiliger Text → Zutat[] mit id und group (Zeilen auf ':' oder '## …' sind Gruppen). */
export function parseZeilen(text) {
  const ergebnis = [];
  let gruppe = null, vorige = null;
  for (const zeile of String(text ?? '').split(/\r?\n/)) {
    const z = normalisiere(zeile);
    if (!z) continue;
    const kopf = gruppenKopf(z);
    if (kopf !== undefined) { [gruppe, vorige] = [kopf, null]; continue; }
    // Fortsetzung: offene Klammer in der Vorzeile oder 'oder …' / 'alternativ …'
    const offen = vorige && vorige.raw.split('(').length > vorige.raw.split(')').length;
    if (vorige && (offen || /^(?:oder|alternativ|bzw\.?)(?=\s|:|$)/i.test(z))) {
      const komma = offen && !/^oder\b/i.test(z) && !/[,;]$/.test(vorige.raw);
      Object.assign(vorige, parseZeile(vorige.raw + (komma ? ', ' : ' ') + z));
      continue;
    }
    vorige = { id: neueIdLokal(), group: gruppe, ...parseZeile(z) };
    ergebnis.push(vorige);
  }
  return ergebnis;
}

/** Zutat[] → Text fürs Bearbeiten (Umkehrung von parseZeilen). */
export function zutatenAlsText(zutaten) {
  const zeilen = [];
  let gruppe = null;
  for (const z of zutaten || []) {
    if (!z) continue;
    const g = z.group || null;
    if (g !== gruppe && g) {
      if (zeilen.length) zeilen.push('');
      zeilen.push(`${g}:`);
    }
    gruppe = g;
    const text = (typeof z.raw === 'string' && z.raw.trim()) || formatZutat(z);
    if (text) zeilen.push(text);
  }
  return zeilen.join('\n');
}

// ---------------------------------------------------------------- Schlüssel

// Marke in GROSSBUCHSTABEN ('LE GUSTO'), aber nicht 'TK'
const istMarke = (t) =>
  /^[A-ZÄÖÜ0-9][A-ZÄÖÜ0-9’'&!.+-]*$/.test(t) && /[A-ZÄÖÜ].*[A-ZÄÖÜ]/.test(t) && !/^TK(?:-|$)/.test(t);
// Zubereitung vorne fällt weg ('frische Petersilie', 'gewürfelte Zwiebel', 'ganze Mandeln')
const VORNE_WEG_RE = new RegExp(`^(?:bio|(?:frisch|gewürfelt|fein|grob|gerieben|ganz)(?:${ADJ})?)$`);
// Zusätze, die ein anderes Produkt meinen ('passierte Tomaten', 'Thymian, getrockneter'): bleiben im
// Schlüssel als 'tomate, passiert', damit sie nicht mit frischer Ware zusammenlaufen
const ZUSATZ_RE = new RegExp(`^(passiert|stückig|getrocknet|gemahlen|geräuchert|eingelegt|geschält|gehackt)(?:${ADJ})?$`);
const ZUSATZ_FUELL_RE = new RegExp(`^(?:fein|grob|frisch|ganz(?:${ADJ})?)$`);
// geschält/gehackt ist nur bei Tomaten ein eigenes Produkt (Dose), sonst Zubereitung ('gehackte Zwiebel')
const NUR_TOMATE = new Set(['geschält', 'gehackt']);
// so ohnehin üblich: 'gemahlener Pfeffer' = 'Pfeffer', 'getrockneter Majoran' = 'Majoran'
const UEBLICH = {
  gemahlen: /(?:pfeffer|salz|zimt|muskat|muskatnuss|kurkuma|pulver|mehl|zucker|kaffee)$/,
  getrocknet: /(?:oregano|majoran|lorbeer|lorbeerblatt|bohnenkraut|flocke|flocken|pulver|rosine|sultanine|korinthe|cranberry|cranberries)$/,
};
const NIE_AENDERN_RE = /(?:reis|mais|ananas|couscous|hummus|kürbis|anis|spaghetti|zucchini|brokkoli|gnocchi|samen|kräuter|flocken|[^s]chen)$/;
// Mehrzahl-Endungen → Einzahl (längste zuerst). Gruppen: '-n weg', '-s weg', '-e weg', Sonderfälle.
const PLURAL_ENDUNGEN = [
  ['n', 'tomaten karotten limetten schalotten sardellen zitronen melonen bananen birnen rosinen mandarinen ' +
    'nektarinen clementinen auberginen orangen pflaumen aprikosen artischocken pastinaken kirschen feigen ' +
    'trauben beeren möhren gurken oliven erbsen bohnen linsen rüben garnelen nelken keulen schoten zehen ' +
    'stangen scheiben knollen sprossen kapern'],
  ['s', 'zucchinis champignons tortillas avocados mangos kiwis chilis paprikas steaks filets wraps baguettes'],
  ['e', 'eigelbe kerne pilze zweige stiele linge brote'],
].flatMap(([weg, woerter]) => woerter.split(' ').map((w) => [w, w.slice(0, -weg.length)]))
  .concat(Object.entries({ pfifferlingen: 'pfifferling', blätter: 'blatt', körner: 'korn', würste: 'wurst',
    nüsse: 'nuss', äpfel: 'apfel', eiern: 'ei', eier: 'ei' }))
  .sort((a, b) => b[0].length - a[0].length);

function einzahl(wort) {
  if (NIE_AENDERN_RE.test(wort) && !wort.endsWith('kirschen')) return wort;
  for (const [mz, ez] of PLURAL_ENDUNGEN) if (wort.endsWith(mz)) return wort.slice(0, -mz.length) + ez;
  return wort.length > 4 && wort.endsWith('eln') ? wort.slice(0, -1) : wort;
}

// Produkt-Zusätze eines Notiz-Teils, der nur aus solchen besteht ('passierte', 'fein gemahlen');
// sonst [] ('geschält und halbiert', 'gemischt' sind Zubereitung bzw. etwas anderes)
function zusaetzeAus(teil) {
  const woerter = String(teil ?? '').toLowerCase().split(' ').filter(Boolean);
  if (!woerter.length || woerter.length > 4) return [];
  const staemme = [];
  for (const w of woerter) {
    const m = w.replace(/[.!:]+$/, '').match(ZUSATZ_RE);
    if (m) staemme.push(m[1]);
    else if (!ZUSATZ_FUELL_RE.test(w)) return [];
  }
  return staemme;
}

/**
 * Schlüssel zum Zusammenführen: 'Rote Zwiebeln' → 'rote zwiebel', 'LE GUSTO Salz' → 'salz'.
 * Zusätze, die ein anderes Produkt meinen, bleiben: 'passierte Tomaten' / 'Tomate(n), passierte'
 * → 'tomate, passiert', 'gemahlene Mandeln' → 'mandel, gemahlen'; 'gehackte Zwiebel' → 'zwiebel'.
 */
export function zutatSchluessel(name) {
  let s = String(name ?? '').normalize('NFC').replace(/[   ]/g, ' ').replace(ENDUNG_RE, '$1');
  const k = klammernHeraus(s);
  s = k.text.replace(/\s+/g, ' ').trim();
  const zusaetze = k.notizen.flatMap((n) => n.text.split(/[,;]/).flatMap(zusaetzeAus));
  const ki = kommaIndex(s);
  if (ki >= 0) {
    zusaetze.push(...s.slice(ki + 1).split(/[,;]/).flatMap(zusaetzeAus));
    s = s.slice(0, ki);
  }
  const ti = s.search(NOTIZ_TRENNER_RE);
  if (ti > 0) s = s.slice(0, ti);
  const toks = slashAlternative(s.trim()).split(' ').filter(Boolean);
  while (toks.length > 1 && istMarke(toks[0])) toks.shift();
  s = toks.join(' ').toLowerCase().replace(/^(?:beste wahl|feine welt|gut & günstig) +/, '');
  // vorne: Produkt-Zusätze merken, Zubereitung und 'bio' weg
  for (;;) {
    s = s.replace(/^(?:bio- *)+/, '') || s;
    const leer = s.indexOf(' ');
    if (leer < 0) break;
    const wort = s.slice(0, leer);
    const m = wort.match(ZUSATZ_RE);
    if (m) zusaetze.push(m[1]);
    else if (!VORNE_WEG_RE.test(wort)) break;
    s = s.slice(leer + 1);
  }
  s = s.replace(/ +type +\d+$/, '');
  while (/[.,;: ]$/.test(s)) s = s.slice(0, -1);
  const i = Math.max(s.lastIndexOf(' '), s.lastIndexOf('-')) + 1;
  const basis = s.slice(0, i) + einzahl(s.slice(i));
  const bleiben = [...new Set(zusaetze)]
    .filter((z) => !(NUR_TOMATE.has(z) && !/tomate$/.test(basis)) && !UEBLICH[z]?.test(basis)).sort();
  return basis && bleiben.length ? `${basis}, ${bleiben.join(' ')}` : basis;
}

/**
 * Name samt Produkt-Zusatz aus der Notiz: { name: 'Tomaten', note: 'passierte' } → 'Tomaten, passierte'.
 * Reine Zubereitung bleibt weg ('Zwiebeln, gehackt'), ebenso bei gezählten Tomaten ('3 Tomaten, geschält').
 */
export function produktName(zutat) {
  const name = String(zutat?.name ?? '').trim();
  const teile = String(zutat?.note ?? '').split(/[,;]/).map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => zusaetzeAus(t).length);
  if (!name || !teile.length) return name;
  const gezaehlt = zahlOk(zutat.qty) && (zutat.unit == null || einheitId(zutat.unit) === 'Stück');
  const relevant = gezaehlt ? teile.filter((t) => zusaetzeAus(t).some((z) => !NUR_TOMATE.has(z))) : teile;
  const mit = relevant.length ? `${name}, ${relevant.join(', ')}` : name;
  return zutatSchluessel(mit) === zutatSchluessel(name) ? name : mit;
}

// ---------------------------------------------------------------- Rechnen

/** Neue Zutat mit qty/qty2 × faktor (null bleibt null). */
export function skaliere(zutat, faktor) {
  const f = Number(faktor);
  if (!zutat || !Number.isFinite(f) || f < 0) return { ...zutat };
  const mal = (x) => (zahlOk(x) ? rund(Number(x) * f) : x ?? null);
  return { ...zutat, qty: mal(zutat.qty), qty2: mal(zutat.qty2) };
}

/** Familie der Einheit: 'masse', 'volumen', 'loeffel', 'stueck' (auch ohne Einheit), Behälter-id oder null. */
export function familieVon(unit) {
  const id = einheitId(unit);
  return id == null ? 'stueck' : EINHEITEN[id] ? EINHEITEN[id].familie : id;
}

/** Menge in der Basis-Einheit: (1.5, 'kg') → { menge: 1500, basis: 'g' }; EL → TL. */
export function inBasis(qty, unit) {
  const id = einheitId(unit);
  const familie = familieVon(id);
  const menge = zahlOk(qty) ? Number(qty) : null;
  if (familie == null) return { menge, basis: null };
  const faktor = EINHEITEN[id]?.faktor ?? 1;
  return { menge: menge == null ? null : rund(menge * faktor), basis: BASIS[familie] ?? familie };
}

const gleicheQuelle = (a, b) => a === b ||
  (typeof a === 'object' && typeof b === 'object' && a && b && JSON.stringify(a) === JSON.stringify(b));

/**
 * Fasst Posten gleicher Zutat zusammen → [{ key, name, teile, vage, quellen }] in Reihenfolge des Auftretens.
 * Produkt-Zusätze aus der Notiz zählen mit ('Tomaten' + 'passierte' ≠ frische Tomaten).
 */
export function zusammenfassen(posten) {
  const gruppen = new Map();
  for (const p of posten || []) {
    if (!p) continue;
    const name = produktName(p);
    const key = p.key || zutatSchluessel(name);
    if (!key) continue;
    if (!gruppen.has(key)) gruppen.set(key, { key, namen: new Map(), teile: new Map(), vage: false, quellen: [] });
    const g = gruppen.get(key);
    if (name) g.namen.set(name, (g.namen.get(name) || 0) + 1);
    if (p.quelle != null && !g.quellen.some((q) => gleicheQuelle(q, p.quelle))) g.quellen.push(p.quelle);
    const { menge, basis } = inBasis(parseZahl(p.qty), p.unit);
    if (p.vague || menge == null || basis == null) { g.vage = true; continue; }
    const q2 = parseZahl(p.qty2);
    const menge2 = q2 == null ? menge : inBasis(q2, p.unit).menge;
    if (!g.teile.has(basis)) g.teile.set(basis, { qty: 0, qty2: 0, spanne: false });
    const t = g.teile.get(basis);
    t.qty += menge;
    t.qty2 += menge2;
    t.spanne ||= menge2 !== menge;
  }
  return [...gruppen.values()].map((g) => {
    // Löffel zu ml, wenn dieselbe Zutat auch als Volumen vorkommt (1 TL = 5 ml)
    const tl = g.teile.get('TL');
    const ml = g.teile.get('ml');
    if (tl && ml) {
      Object.assign(ml, { qty: ml.qty + tl.qty * 5, qty2: ml.qty2 + tl.qty2 * 5, spanne: ml.spanne || tl.spanne });
      g.teile.delete('TL');
    }
    const teile = [...g.teile].map(([unit, t]) => ({ qty: rund(t.qty), qty2: t.spanne ? rund(t.qty2) : null, unit }));
    // häufigster Originalname (bei Gleichstand der erste)
    const [name] = [...g.namen].reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
    return { key: g.key, name: name || g.key, teile, vage: g.vage && teile.length === 0, quellen: g.quellen };
  });
}

// ---------------------------------------------------------------- Anzeige

const DEZIMAL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false });
const BRUCH_ANZEIGE = [[1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾']];

/** Deutsche Zahl: '2', '1,5'; bei Löffeln/Stück/Behältern unter 10 auch '½', '1¼', '⅔'. */
export function formatZahl(n, einheit) {
  if (!zahlOk(n)) return '';
  const x = Number(n);
  if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
  const familie = familieVon(einheit);
  if (familie !== 'masse' && familie !== 'volumen' && x > 0 && x < 10) {
    const ganz = Math.floor(x);
    const bruch = BRUCH_ANZEIGE.find(([wert]) => Math.abs(x - ganz - wert) < 0.01);
    if (bruch) return (ganz ? String(ganz) : '') + bruch[1];
  }
  return DEZIMAL.format(x);
}

// Zahl- und Einheiten-Text getrennt (für formatMenge, formatZutat, teileAlsText)
function mengenTeile(qty, qty2, unit) {
  if (!zahlOk(qty)) return null;
  let a = Number(qty);
  let b = zahlOk(qty2) && Number(qty2) !== a ? Number(qty2) : null;
  let id = einheitId(unit);
  const teilen = (d) => { a /= d; if (b != null) b /= d; };
  // ab 3 TL in ganzen oder halben EL: 9 TL → 3 EL, 7,5 TL → 2½ EL (4 TL bleiben 4 TL)
  const dreierTL = (x) => x >= 3 && Math.abs((x * 2) / 3 - Math.round((x * 2) / 3)) < 1e-6;
  if (id === 'g' && a >= 1000) { teilen(1000); id = 'kg'; }
  else if (id === 'ml' && a >= 1000) { teilen(1000); id = 'l'; }
  else if (id === 'TL' && dreierTL(a) && (b == null || dreierTL(b))) { teilen(3); id = 'EL'; }
  const glatt = (x) => ((id === 'g' || id === 'ml') && x >= 100 ? Math.round(x) : x);
  [a, b] = [glatt(a), b == null ? null : glatt(b)];
  const zahl = b == null ? formatZahl(a, id) : `${formatZahl(a, id)}–${formatZahl(b, id)}`;
  if (id == null || id === 'Stück') return { zahl, einheit: '', stueck: true };
  const e = EINHEITEN[id];
  return { zahl, einheit: e ? ((b ?? a) > 1 ? e.plural : e.name) : id, stueck: false };
}

/** '500 g', '1,5 kg', '2–3' (Stück), '½ TL', '1 EL', '2 Dosen'; '' ohne Menge. */
export function formatMenge(qty, qty2, unit) {
  const t = mengenTeile(qty, qty2, unit);
  return t ? [t.zahl, t.einheit].filter(Boolean).join(' ') : '';
}

/** Zutat als Text: '200 g Mehl (gesiebt)', '1 kl. Bund Petersilie', 'etwas Schnittlauch'. */
export function formatZutat(zutat) {
  if (!zutat) return '';
  const groesse = zutat.size ? String(zutat.size).trim() : '';
  const id = einheitId(zutat.unit);
  const t = mengenTeile(zutat.qty, zutat.qty2, zutat.unit);
  const teile = [];
  if (t) {
    const vorne = /^(?:gut|knapp)$/i.test(groesse);
    teile.push(vorne ? groesse : '', t.zahl, vorne ? '' : groesse);
    teile.push(t.einheit || (groesse && id === 'Stück' ? 'Stück' : ''));
  } else {
    teile.push(groesse, id ? EINHEITEN[id]?.name ?? id : '');
  }
  teile.push(String(zutat.name ?? '').trim());
  const text = teile.filter(Boolean).join(' ');
  return zutat.note ? `${text} (${zutat.note})` : text;
}

/** Teile einer zusammengefassten Zeile: '3 Stück + 200 g', nur Stück → '3'. */
export function teileAlsText(teile) {
  const liste = (teile || []).map((x) => x && mengenTeile(x.qty, x.qty2, x.unit)).filter(Boolean);
  if (liste.length === 1) return [liste[0].zahl, liste[0].einheit].filter(Boolean).join(' ');
  return liste.map((x) => `${x.zahl} ${x.stueck ? 'Stück' : x.einheit}`).join(' + ');
}
