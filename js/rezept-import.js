// Rezept-Import ohne DOM: JSON-LD (über den Import-Dienst) und eingefügter Text → Rezept-Entwurf.
// Läuft im Browser und in Node (Tests). Nur ladeRezept() greift aufs Netz zu.

import { parseZahl, parseZeile, parseZeilen } from './zutaten.js';

const MELDUNGEN = {
  'kein-proxy': 'Für Links wird der Import-Dienst gebraucht (Mehr → Import-Dienst).',
  netz: 'Der Import-Dienst ist nicht erreichbar.', blockiert: 'Die Webseite erlaubt das automatische Laden nicht.',
  'kein-rezept': 'Auf der Seite wurde kein Rezept gefunden – nutze „Text einfügen“.',
  limit: 'Der Import-Dienst ist gerade ausgelastet.', ungueltig: 'Ungültiger Link oder ungültige Antwort.',
};

/** Fehler beim Import; code: 'kein-proxy' | 'netz' | 'blockiert' | 'kein-rezept' | 'limit' | 'ungueltig'. */
export class ImportFehler extends Error {
  constructor(code, message) {
    super(message || MELDUNGEN[code] || 'Import fehlgeschlagen.');
    this.name = 'ImportFehler';
    this.code = code;
  }
}

const neueId = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- Links

const URL_RE = /https?:\/\/[^\s<>"«»“”„]+/gi;

// Satzzeichen am Ende weg; ')' nur, wenn die Klammer nicht zum Link gehört
function stutzeUrl(u) {
  while (/[.,;:!?»"'’”…]$/.test(u) || (u.endsWith(')') && u.split('(').length < u.split(')').length)) u = u.slice(0, -1);
  return u;
}

/** Erster http(s)-Link in einem der Texte oder null. */
export function findeUrl(...texte) {
  for (const t of texte) {
    if (t == null) continue;
    for (const m of String(t).matchAll(URL_RE)) {
      const u = stutzeUrl(m[0]);
      try { if (new URL(u).hostname.includes('.')) return u; } catch { /* weiter suchen */ }
    }
  }
  return null;
}

/** Text ohne den Link, Leerraum aufgeräumt. */
export function textOhneUrl(text, url) {
  let s = String(text ?? '');
  if (url) s = s.split(String(url)).join(' ');
  return s.replace(/\r\n?/g, '\n').split('\n').map((z) => z.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function absoluteUrl(u, basis) {
  try {
    const x = new URL(u.startsWith('//') ? `https:${u}` : u, basis || undefined);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch { return ''; }
}

function seiteVon(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
}

// ---------------------------------------------------------------- JSON-LD

function parseBlock(roh) {
  if (roh && typeof roh === 'object') return roh;
  if (typeof roh !== 'string') return undefined;
  // Rohe Steuerzeichen: Zeilenumbruch in Strings → \n (für Schritte), sonst Leerzeichen
  const s = roh.replace(/<!--|-->|<!\[CDATA\[|\]\]>/g, '')
    .replace(/"(?:[^"\\]|\\[\s\S])*"/g, (t) => t.replace(/\r?\n/g, '\\n')).replace(/[\u0000-\u001f]/g, ' ').trim();
  try { return JSON.parse(s); } catch { /* unten noch einmal ohne Rand */ }
  // Kommentar-Reste (/* */, //) oder ';' um das JSON herum abschneiden
  const a = s.search(/[{[]/);
  const b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (a < 0 || b <= a) return undefined;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return undefined; }
}

/** Rohe JSON-Texte (wie vom Import-Dienst) → geparste Objekte; ungültige werden übersprungen. */
export function parseJsonLdBloecke(texte) {
  return [].concat(texte ?? []).map(parseBlock).filter((o) => o != null && typeof o === 'object');
}

/** Alle <script type="application/ld+json"> eines HTML-Texts → geparste Objekte. */
export function extrahiereJsonLd(html) {
  const bloecke = [];
  for (const m of String(html ?? '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\btype\s*=\s*["']?\s*application\/ld\+json\b/i.test(m[1])) bloecke.push(m[2]);
  }
  return parseJsonLdBloecke(bloecke);
}

const istTyp = (o, typ) => [].concat(o?.['@type'] ?? [])
  .some((t) => typeof t === 'string' && t.replace(/^.*[/#:]/, '').toLowerCase() === typ);
const hatZutaten = (r) => [r.recipeIngredient, r.ingredients].some((w) => (Array.isArray(w) ? w.length : w));
const VORRANG = ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item'];

/** Sucht den Recipe-Knoten (auch in @graph, mainEntity, Listen); bevorzugt einen mit Zutaten. */
export function findeRezeptKnoten(objekte) {
  const funde = [];
  const gesehen = new Set();
  let budget = 20000;
  const besuche = (x, tiefe) => {
    if (!x || typeof x !== 'object' || tiefe > 12 || gesehen.has(x) || --budget < 0) return;
    gesehen.add(x);
    if (Array.isArray(x)) { for (const y of x) besuche(y, tiefe + 1); return; }
    if (istTyp(x, 'recipe')) funde.push(x);
    for (const k of VORRANG) besuche(x[k], tiefe + 1);
    for (const [k, v] of Object.entries(x)) if (!VORRANG.includes(k)) besuche(v, tiefe + 1);
  };
  besuche(objekte, 0);
  return funde.find(hatZutaten) ?? funde[0] ?? null;
}

// ---------------------------------------------------------------- Werte lesen

/** ISO-Dauer ('PT1H25M', 'P0DT1H25M', 'PT90S'), Minutenzahl oder '30 Min.' → Minuten oder null. */
export function parseDauer(iso) {
  if (typeof iso === 'number') return Number.isFinite(iso) && iso > 0 ? Math.ceil(iso) : null;
  const s = String(iso ?? '').replace(/\s+/g, '').toUpperCase();
  const z = '(\\d+(?:[.,]\\d+)?)';
  const m = s.match(new RegExp(`^P(?:${z}Y)?(?:${z}M)?(?:${z}W)?(?:${z}D)?(?:T(?:${z}H)?(?:${z}M)?(?:${z}S)?)?$`));
  let minuten = 0;
  if (m) {
    const [y, mo, w, d, h, mi, se] = m.slice(1).map((x) => (x ? parseFloat(x.replace(',', '.')) : 0));
    // 'P30M' (ohne T) meint in Rezepten fast immer Minuten, nicht Monate
    minuten = (w * 7 + d) * 1440 + h * 60 + mi + se / 60 + (!s.includes('T') && !y && !w && !d ? mo : 0);
  } else if (/^\d+(?:[.,]\d+)?$/.test(s)) minuten = parseFloat(s.replace(',', '.'));
  else if (s) minuten = (findeTimer(String(iso))[0]?.sekunden ?? 0) / 60;
  return minuten > 0 ? Math.ceil(minuten - 1e-9) : null;
}

/** recipeYield → Portionen: erste Zahl ('4 Portionen', 'Für 6 Personen', '2-3' → 2) oder null. */
export function parsePortionen(wert) {
  if (Array.isArray(wert)) return wert.map(parsePortionen).find((n) => n != null) ?? null;
  if (typeof wert === 'number') return Number.isFinite(wert) && wert > 0 ? wert : null;
  const m = String(wert ?? '').match(/\d+(?:[.,]\d+)?/);
  const n = m ? parseFloat(m[0].replace(',', '.')) : null;
  return n > 0 && n < 1000 ? n : null;
}

const ENTITAETEN = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ouml: 'ö', auml: 'ä', uuml: 'ü', Ouml: 'Ö',
  Auml: 'Ä', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', Eacute: 'É', ecirc: 'ê', euml: 'ë', agrave: 'à',
  aacute: 'á', acirc: 'â', ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ucirc: 'û', ntilde: 'ñ', oslash: 'ø',
  aring: 'å', aelig: 'æ', frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔', deg: '°', ndash: '–',
  mdash: '—', minus: '−', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚',
  laquo: '«', raquo: '»', times: '×', middot: '·', bull: '•', euro: '€', copy: '©', reg: '®', trade: '™',
  micro: 'µ', sup2: '²', sup3: '³', plusmn: '±', frasl: '⁄', shy: '', thinsp: ' ', ensp: ' ', emsp: ' ',
  zwnj: '', zwj: '', lrm: '', rlm: '',
};
// Windows-1252-Reste wie &#150; (–) oder &#132; („)
const CP1252 = { 128: '€', 130: '‚', 132: '„', 133: '…', 145: '‘', 146: '’', 147: '“', 148: '”', 150: '–', 151: '—' };

function entitaeten(s) {
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, (ganz, e) => {
    if (e[0] !== '#') return ENTITAETEN[e] ?? ENTITAETEN[e.toLowerCase()] ?? ganz;
    const cp = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (CP1252[cp]) return CP1252[cp];
    return !cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\ufffd' : String.fromCodePoint(cp);
  });
}

/** HTML-Entitäten dekodieren und Tags entfernen (<br>, Absätze → Zeilenumbruch). */
export function dekodiereEntities(text) {
  if (text == null) return '';
  let s = entitaeten(String(text))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|tr|section|article|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, '');
  if (/&(?:#\d|#x[0-9a-f]|[a-z]+\d*;)/i.test(s)) s = entitaeten(s); // doppelt kodiert ('&amp;ouml;')
  return s.replace(/\r\n?/g, '\n').replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[ \t\f\v\u00a0\u2000-\u200a\u202f\u205f\u3000]+/g, ' ')
    .split('\n').map((z) => z.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const einzeilig = (x) => (x == null || typeof x === 'object' ? '' : dekodiereEntities(x).replace(/\s+/g, ' ').trim());

function bildUrl(bild, basis, tiefe = 0) {
  if (!bild || tiefe > 3) return '';
  if (typeof bild === 'string') return absoluteUrl(einzeilig(bild), basis);
  if (Array.isArray(bild)) return bild.map((b) => bildUrl(b, basis, tiefe + 1)).find(Boolean) ?? '';
  return typeof bild === 'object' ? bildUrl(bild.url ?? bild.contentUrl ?? bild['@id'], basis, tiefe + 1) : '';
}

// ---------------------------------------------------------------- Schritte

const ALLGEMEIN_RE = /^(?:zubereitung|anleitung|schritte|arbeitsschritte|so geht['’]?s|instructions|directions|method)$/i;
const AUFZAEHLUNG_RE = /^(?:[•▢☐■□✓✔·▪◦►*]|[-–](?=\s))\s*/;
const KLEBT_RE = /(?<=\p{Ll}[.!?])(?=\p{Lu}\p{Ll})/u; // 'schneiden.Kichererbsen' = verschluckter Absatz

// Kurze Zeile auf ':' oder '## …' → Gruppenname (null bei 'Zubereitung:'), sonst undefined
function schrittKopf(z) {
  let t;
  const m = z.match(/^#{1,6}\s*(.+?)\s*#*$/);
  if (m) t = m[1];
  else if (z.endsWith(':') && z.length <= 60 && !/[.!?]/.test(z.slice(0, -1)) && !/^\d/.test(z)) t = z;
  else return undefined;
  t = t.replace(/:+$/, '').trim();
  return !t || ALLGEMEIN_RE.test(t) ? null : t;
}

function saeubereSchritt(t) {
  const s = String(t).replace(/\s+/g, ' ').trim().replace(AUFZAEHLUNG_RE, '')
    .replace(/^schritt\s*\d{1,2}\s*[.):–-]?\s*/i, '').replace(/^\d{1,2}\s*[.):]\s+/, '').trim();
  return /^\d*[.)]?$/.test(s) || /^[\p{P}\p{S}\s]*$/u.test(s) ? '' : s;
}

// '1. … 2. … 3. …' in einer Zeile → einzelne Teile
function teileNummeriert(z) {
  if (!/^1[.)]\s/.test(z)) return [z];
  const teile = [];
  let rest = z;
  for (let n = 2, i; (i = rest.search(new RegExp(`\\s${n}[.)]\\s`))) >= 0; n++) {
    teile.push(rest.slice(0, i));
    rest = rest.slice(i);
  }
  return [...teile, rest];
}

// recipeInstructions in allen Formen: Text, Liste, HowToStep, HowToSection (name → Gruppe), verschachtelt
function sammleSchritte(wert, gruppe, ziel, tiefe = 0) {
  if (wert == null || tiefe > 8) return;
  const neu = (text, g) => { const t = saeubereSchritt(text); if (t) ziel.push({ id: neueId(), group: g, text: t }); };
  if (Array.isArray(wert)) {
    for (const w of wert) sammleSchritte(w, gruppe, ziel, tiefe + 1);
  } else if (typeof wert === 'string' || typeof wert === 'number') {
    let g = gruppe;
    for (const zeile of dekodiereEntities(wert).split('\n')) {
      const kopf = schrittKopf(zeile);
      if (kopf !== undefined) g = kopf ?? gruppe;
      else for (const teil of teileNummeriert(zeile)) teil.split(KLEBT_RE).forEach((t) => neu(t, g));
    }
  } else if (typeof wert === 'object') {
    const liste = wert.itemListElement ?? wert.steps ?? wert.step;
    if (istTyp(wert, 'howtosection') || (liste && !wert.text && !istTyp(wert, 'howtostep'))) {
      const name = einzeilig(wert.name).replace(/:+$/, '');
      sammleSchritte(liste ?? wert.recipeInstructions, name && !ALLGEMEIN_RE.test(name) ? name : gruppe, ziel, tiefe + 1);
      return;
    }
    const text = [wert.text, wert.description, liste ? null : wert.name].map(einzeilig).find(Boolean);
    if (text) neu(text.replace(/(\p{Ll}[.!?])(?=\p{Lu}\p{Ll})/gu, '$1 '), gruppe);
    else if (liste) sammleSchritte(liste, gruppe, ziel, tiefe + 1);
  }
}

// ---------------------------------------------------------------- Entwürfe

// Gemeinsame Form beider Entwürfe; Gesamtzeit notfalls aus Vorbereitung + Kochen
function entwurf(felder) {
  const { prepMin = null, cookMin = null, sourceUrl = '' } = felder;
  const summe = prepMin != null || cookMin != null ? (prepMin ?? 0) + (cookMin ?? 0) : null;
  return { title: '', imageUrl: '', servings: null, tags: [], notes: '', ingredients: [], steps: [], ...felder,
    sourceUrl, sourceSite: seiteVon(sourceUrl), prepMin, cookMin, totalMin: felder.totalMin ?? summe, favorite: false };
}

// Von manchen Seiten am Komma zerlegte Zutaten ('250 g Fleisch', ' in Stücken') wieder zusammenfügen
const BRUCHSTUECK_RE = /^(?:in (?:\p{L}+ )?(?:stücke|würfel|scheiben|streifen|ringe|röllchen)\p{L}*|zzgl\.|zuzüglich)/iu;

function zutatenAus(wert) {
  const zeilen = [];
  for (const z of [].concat(wert ?? [])) {
    const roh = z && typeof z === 'object' ? z.text ?? z.name : z;
    if (roh == null || typeof roh === 'object') continue;
    for (const zeile of dekodiereEntities(roh).split('\n')) {
      const t = zeile.replace(/\s+/g, ' ').trim();
      if (t && zeilen.length && BRUCHSTUECK_RE.test(t)) zeilen[zeilen.length - 1] += `, ${t}`;
      else if (t) zeilen.push(t);
    }
  }
  // parseZeilen: Gruppen ('Für den Teig:') und Fortsetzungen ('oder …', offene Klammer)
  return parseZeilen(zeilen.join('\n'));
}

function tagsAus(k) {
  const tags = new Map();
  for (const w of [k.recipeCategory, k.recipeCuisine, k.keywords].flatMap((x) => [].concat(x ?? []))) {
    const text = w && typeof w === 'object' ? w.name : w;
    if (typeof text !== 'string') continue;
    for (const teil of text.split(',')) {
      const t = einzeilig(teil);
      if (t && t.length <= 40 && !tags.has(t.toLowerCase()) && tags.size < 8) tags.set(t.toLowerCase(), t);
    }
  }
  return [...tags.values()];
}

/** Recipe-Knoten (JSON-LD) → Rezept-Entwurf im App-Format. */
export function rezeptAusJsonLd(knoten, quelleUrl) {
  const k = knoten && typeof knoten === 'object' ? knoten : {};
  const sourceUrl = absoluteUrl(String(quelleUrl || '')) || absoluteUrl(einzeilig(k.url));
  const steps = [];
  sammleSchritte(k.recipeInstructions ?? k.instructions, null, steps);
  return entwurf({
    title: einzeilig(k.name) || einzeilig(k.headline), sourceUrl, imageUrl: bildUrl(k.image ?? k.thumbnailUrl, sourceUrl),
    servings: parsePortionen(k.recipeYield ?? k.yield), prepMin: parseDauer(k.prepTime),
    cookMin: parseDauer(k.cookTime), totalMin: parseDauer(k.totalTime), tags: tagsAus(k),
    ingredients: zutatenAus(k.recipeIngredient ?? k.ingredients), steps,
  });
}

// ---------------------------------------------------------------- Text einfügen

const UEBERSCHRIFTEN = [
  ['zutaten', /^(?:die\s+)?(?:zutaten(?:liste)?|einkaufsliste|du brauchst|das brauchst du)\b/i],
  ['schritte', /^(?:zubereitung|anleitung|(?:und\s+)?so geht['’]?s|so wird['’]?s gemacht|(?:arbeits|zubereitungs)?schritte)\b/i],
  ['notizen', /^(?:tipps?|notizen?|hinweise?|anmerkungen?)\b/i],
  ['weg', /^(?:nährwerte|nährwertangaben|naehrwerte)\b/i],
];
const KOPF_ZUSATZ_RE = /^\s*(?:\([^)]*\))?\s*(?:(?:für|fuer)\s+[^:]{1,40})?\s*:?\s*$/i;
const PORTIONEN_RE = [
  /^(?:für|fuer)\s+(\d+)(?:\s*[-–]\s*\d+)?\s*(?:portionen|personen|portion|person|pers\.?|port\.?|stück)?\s*:?$/i,
  /^(\d+)(?:\s*[-–]\s*\d+)?\s*(?:portionen|personen|pers\.|port\.)\s*:?$/i,
  /^(?:portionen|personen|anzahl portionen|ergibt)\s*:?\s*(?:ca\.\s*)?(\d+)\b/i,
];
const ZEIT_RE = new RegExp('^(arbeitszeit|vorbereitung(?:szeit)?|zubereitungs(?:zeit|dauer)|kochzeit|backzeit|garzeit|' +
  'bratzeit|gesamtzeit|ruhezeit|wartezeit|zeit|dauer)\\s*:?\\s*(?:ca\\.\\s*|etwa\\s*)?(?=\\d|eine?\\b)', 'i');
const META_RE = /^(?:schwierigkeit(?:sgrad)?|kalorien|brennwert|niveau|level)\b/i;
// Vorspann geteilter Texte ('Schau dir dieses Rezept an: Spaghetti Carbonara')
const TEILEN_RE = new RegExp('^(?:(?:schau|sieh) dir (?:mal )?(?:dieses|das|mein) rezept an|ich habe (?:da )?(?:ein|dieses) ' +
  'rezept[^:]*gefunden|hier (?:ist )?(?:ein|das) rezept[^:]*|check out this recipe|rezept)\\s*[:–-]\\s*', 'i');

// Überschrift? → { art, zusatz } ('Zutaten für 4 Portionen') oder { art, inhalt } ('Tipp: …'), sonst null
function ueberschrift(zeile) {
  const t = zeile.replace(/^[#*_=\s]+|[*_=\s]+$/g, '');
  for (const [art, re] of UEBERSCHRIFTEN) {
    const m = t.match(re);
    if (!m) continue;
    const rest = t.slice(m[0].length);
    if (KOPF_ZUSATZ_RE.test(rest)) return { art, zusatz: rest.replace(/[():]/g, ' ').replace(/\s+/g, ' ').trim() };
    const inhalt = art === 'schritte' || art === 'notizen' ? rest.match(/^\s*:\s*(.+)$/) : null;
    return inhalt ? { art, inhalt: inhalt[1] } : null;
  }
  return null;
}

// 'zutat' (Menge/Einheit vorne, kurz), 'schritt' (Satz, '1. …') oder 'kurz' (Titel, 'Salz', 'Teig:')
function zeilenArt(z) {
  const woerter = z.split(' ').length;
  if (/^(?:schritt\s*\d{1,2}|\d{1,2}\s*[.)]\s+\p{L})/iu.test(z)) return 'schritt';
  const satz = /[.!?]$/.test(z) && !/\b(?:n\.\s?b|ca|evtl|bzw|pck|gr|kl|stk|msp|el|tl|geh|gestr|ggf|z\.\s?b)\.$/i.test(z);
  if (/^(?:ca\.\s*|etwa\s+)?(?:\d|[½⅓⅔¼¾⅛])/i.test(z)) return (satz && woerter >= 5) || woerter > 12 ? 'schritt' : 'zutat';
  if (woerter >= 8 || (satz && woerter >= 4) || z.length > 80) return 'schritt';
  const p = parseZeile(z);
  return p && (p.qty != null || p.vague || p.unit) && !z.endsWith(':') ? 'zutat' : 'kurz';
}

// Kopierte Tabellen: Menge und Zutat auf zwei Zeilen ('200 g' / 'Mehl') → eine Zeile
const nurMenge = (z) => !z.endsWith(':') && parseZeile(`${z} X`)?.name === 'X';
const ohneMenge = (z) => !z.endsWith(':') && !/^[\d½⅓⅔¼¾⅛]/.test(z) && parseZeile(z)?.qty == null && !nurMenge(z);
function verbindeMengen(zeilen) {
  const aus = [];
  for (const z of zeilen) {
    if (aus.length && nurMenge(aus.at(-1)) && ohneMenge(z)) aus[aus.length - 1] += ` ${z}`;
    else aus.push(z);
  }
  return aus;
}

/** Eingefügter oder geteilter Text → Rezept-Entwurf (mit Überschriften oder Zeile für Zeile erkannt). */
export function rezeptAusText(text, { titel, quelleUrl } = {}) {
  const zeilen = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map((z) => z.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim().replace(AUFZAEHLUNG_RE, '').trim())
    .filter((z) => z && !/^[\p{P}\p{S}\s]*$/u.test(z));
  const koepfe = zeilen.map(ueberschrift);
  const zutatenKopf = koepfe.some((k) => k?.art === 'zutaten');
  const schrittKopfDa = koepfe.some((k) => k?.art === 'schritte');
  const zutaten = [], schritte = [], notizen = [], vorspann = [], zeiten = {};
  let abschnitt = null, phase = null, servings = null, erkannt = '';

  zeilen.forEach((roh, i) => {
    const z = !erkannt && !zutaten.length ? roh.replace(TEILEN_RE, '') : roh;
    const kopf = koepfe[i];
    if (kopf) {
      abschnitt = kopf.art;
      if (kopf.inhalt) (abschnitt === 'notizen' ? notizen : schritte).push(kopf.inhalt);
      // 'Zutaten für 4 Portionen' → Portionen; 'Zutaten für den Teig' → Gruppe
      const zahl = kopf.zusatz?.match(/(\d+)/);
      if (zahl) servings ??= Number(zahl[1]) || null;
      else if (kopf.zusatz && abschnitt === 'zutaten') zutaten.push(`${kopf.zusatz.replace(/^f(?:ü|ue)r/i, 'Für')}:`);
      return;
    }
    const portionen = PORTIONEN_RE.map((re) => z.match(re)).find(Boolean);
    if (portionen) { servings ??= Number(portionen[1]) || null; return; }
    const zeit = z.match(ZEIT_RE);
    if (zeit) {
      const feld = /ruhe|warte/i.test(zeit[1]) ? null : /koch|back|gar|brat/i.test(zeit[1]) ? 'cookMin'
        : /gesamt|^zeit|^dauer/i.test(zeit[1]) ? 'totalMin' : 'prepMin';
      if (feld) zeiten[feld] ??= parseDauer(z.slice(zeit[0].length));
      return;
    }
    if (!z || (META_RE.test(z) && z.length < 60 && abschnitt !== 'schritte') || abschnitt === 'weg') return;
    if (abschnitt === 'zutaten') {
      // ohne eigene Zubereitungs-Überschrift beginnt mit dem ersten Satz die Zubereitung
      if (!schrittKopfDa && zeilenArt(z) === 'schritt') abschnitt = 'schritte';
      (abschnitt === 'schritte' ? schritte : zutaten).push(z);
      return;
    }
    if (abschnitt) { (abschnitt === 'schritte' ? schritte : notizen).push(z); return; }
    // Vorspann bzw. Erkennung ohne Überschriften
    const art = zeilenArt(z);
    const titelOk = !erkannt && !zutaten.length && z.split(' ').length <= 14 && !/[.!?:]$/.test(z);
    if (zutatenKopf) { if (titelOk && art !== 'zutat') erkannt = z; }
    else if (phase === 'schritte') schritte.push(z);
    else if (art === 'zutat' || (art === 'kurz' && (phase === 'zutaten' || z.endsWith(':')))) {
      phase = 'zutaten';
      zutaten.push(z);
    } else if (art === 'schritt' && phase === 'zutaten') {
      phase = 'schritte';
      schritte.push(z);
    } else if (titelOk && art === 'kurz') erkannt = z;
    else if (art === 'schritt') vorspann.push(z);
  });
  // Nur Sätze, keine Zutaten → das sind die Schritte; 'Pfannkuchen für 2 Personen' → Portionen
  if (!zutaten.length && !schritte.length) schritte.push(...vorspann);
  const imTitel = erkannt.match(/\s*[(,–-]?\s*\bf(?:ü|ue)r\s+(\d+)\s*(?:portionen|personen)\)?$/i);
  if (imTitel && imTitel.index > 0) [servings, erkannt] = [servings ?? Number(imTitel[1]), erkannt.slice(0, imTitel.index)];

  const steps = [];
  let gruppe = null;
  for (const z of schritte) {
    const kopf = schrittKopf(z);
    if (kopf !== undefined) { gruppe = kopf; continue; }
    const t = saeubereSchritt(z);
    if (t) steps.push({ id: neueId(), group: gruppe, text: t });
  }
  return entwurf({
    title: String(titel ?? '').replace(/\s+/g, ' ').trim() || erkannt, sourceUrl: absoluteUrl(String(quelleUrl || '')),
    servings, ...zeiten, notes: notizen.join('\n'), ingredients: parseZeilen(verbindeMengen(zutaten).join('\n')), steps,
  });
}

// ---------------------------------------------------------------- Timer

const T_ZAHL = '\\d+ \\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?: ?[½¼¾⅓⅔])?|[½¼¾⅓⅔]|' +
  'eine[rnm]?|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|anderthalb|eineinhalb';
const T_EINHEIT = 'stunden|stunde|std\\.?|h|minuten|minute|min\\.?|sekunden|sekunde|sek\\.?';
const TIMER_RE = new RegExp(`(?<![\\p{L}\\d.,/])(?:(${T_ZAHL})(?: ?(?:-|–|bis) ?(${T_ZAHL}))? ?(${T_EINHEIT})(?!\\p{L})` +
  '|(halben? stunde|(?:drei)?viertelstunde)(?!\\p{L}))', 'giu');
const MINUTEN_DANACH_RE = /^ (?:und )?(\d+) ?(?:minuten|minute|min\.?)(?!\p{L})/iu;
const zahlLabel = (t, w) => (/^[\d½¼¾⅓⅔]/.test(t) ? t.replace(/(\d) (?=[½¼¾⅓⅔])/, '$1') : String(w)).replace('.', ',');

/** Zeitangaben im Text → [{ label: '10 Min.', sekunden: 600 }], höchstens 3, ohne Doppelte. */
export function findeTimer(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ');
  const timer = [];
  let weiterAb = 0;
  for (const m of s.matchAll(TIMER_RE)) {
    if (m.index < weiterAb) continue;
    let label, sekunden;
    if (m[4]) {
      const min = /^halb/i.test(m[4]) ? 30 : /^drei/i.test(m[4]) ? 45 : 15;
      [label, sekunden] = [`${min} Min.`, min * 60];
    } else {
      const e = m[3].toLowerCase();
      const [faktor, kurz] = /^(?:st|h)/.test(e) ? [3600, 'Std.'] : /^min/.test(e) ? [60, 'Min.'] : [1, 'Sek.'];
      const [a, b] = [parseZahl(m[1]), m[2] ? parseZahl(m[2]) : null];
      if (a == null || (m[2] && b == null)) continue;
      sekunden = Math.round((b ?? a) * faktor);
      label = `${zahlLabel(m[1], a)}${b != null ? `–${zahlLabel(m[2], b)}` : ''} ${kurz}`;
      // '1 Std. 20 Min.' → ein Timer
      const danach = faktor === 3600 && b == null ? s.slice(m.index + m[0].length).match(MINUTEN_DANACH_RE) : null;
      if (danach) {
        [sekunden, label] = [sekunden + Number(danach[1]) * 60, `${label} ${danach[1]} Min.`];
        weiterAb = m.index + m[0].length + danach[0].length;
      }
    }
    if (sekunden <= 0 || sekunden > 86400 || timer.some((t) => t.sekunden === sekunden)) continue;
    timer.push({ label, sekunden });
    if (timer.length === 3) break;
  }
  return timer;
}

// ---------------------------------------------------------------- Laden über den Import-Dienst

// Fehler-Kennungen aus proxy/worker.js → Codes der App
const FEHLER_DIENST = {
  blockiert: 'blockiert', origin: 'blockiert', limit: 'limit', url: 'ungueltig', host: 'ungueltig', methode: 'ungueltig',
  weiterleitungen: 'ungueltig', 'zu-gross': 'kein-rezept', 'kein-html': 'kein-rezept', upstream: 'netz', netz: 'netz',
  zeitueberschreitung: 'netz',
};

/** Lädt ein Rezept über den Import-Dienst → Entwurf; wirft ImportFehler. */
export async function ladeRezept(url, { proxyUrl, fetchFn = (...a) => globalThis.fetch(...a), timeoutMs = 15000 } = {}) {
  let basis = String(proxyUrl ?? '').trim();
  if (!basis) throw new ImportFehler('kein-proxy');
  if (!/^https?:\/\//i.test(basis)) basis = `https://${basis}`;
  if (!absoluteUrl(basis)) throw new ImportFehler('kein-proxy', 'Die Adresse des Import-Dienstes ist ungültig.');
  const ziel = findeUrl(url);
  if (!ziel) throw new ImportFehler('ungueltig', 'Bitte einen vollständigen Link (https://…) angeben.');

  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), timeoutMs);
  let antwort, roh;
  try {
    antwort = await fetchFn(`${basis}${basis.includes('?') ? '&' : '?'}url=${encodeURIComponent(ziel)}`, {
      signal: abbruch.signal, headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
    });
    roh = await antwort.text();
  } catch {
    throw new ImportFehler('netz', abbruch.signal.aborted ? 'Zeitüberschreitung beim Laden.' : undefined);
  } finally {
    clearTimeout(uhr);
  }

  let daten = null;
  try { daten = JSON.parse(roh); } catch { /* ungültig, siehe unten */ }
  if (!daten || typeof daten !== 'object' || Array.isArray(daten)) daten = null;
  const fehler = typeof daten?.fehler === 'string' ? daten.fehler : null;
  const status = Number(antwort.status) || 0;
  if (status === 403 || status === 451) throw new ImportFehler('blockiert');
  if (status === 429 || fehler === 'limit') throw new ImportFehler('limit');
  if (!antwort.ok || fehler) {
    const code = FEHLER_DIENST[fehler] ?? (status >= 400 && status < 500 ? 'ungueltig' : 'netz');
    throw new ImportFehler(code, `${MELDUNGEN[code]} (${fehler || `HTTP ${status}`})`);
  }
  if (!daten) throw new ImportFehler('ungueltig', 'Der Import-Dienst hat keine gültige Antwort geschickt.');

  const knoten = findeRezeptKnoten(parseJsonLdBloecke(Array.isArray(daten.jsonld) ? daten.jsonld : []));
  if (!knoten) throw new ImportFehler('kein-rezept');
  const rezept = rezeptAusJsonLd(knoten, absoluteUrl(String(daten.url ?? '')) || ziel);
  if (!rezept.title) rezept.title = einzeilig(daten.title);
  return rezept;
}
