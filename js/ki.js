// KI-Rezeptideen für „Automatisch planen“: Anfrage an den Import-Dienst (Workers AI, siehe
// proxy/worker.js) und strenge Prüfung jeder Antwort. Läuft im Browser und in Node (Tests);
// nur holeKiRezepte() greift aufs Netz zu. KI-Rezepte sind Ideen – die App sagt das auch so.

import { EINHEITEN, parseZeile, parseZeilen, zutatSchluessel } from './zutaten.js';
import { PROTEINE, erkenneProtein, normalisiereProfil, passtZumProfil } from './planer.js';

// ---------------------------------------------------------------- Schema und Fehler

const tiefFrieren = (o) => {
  for (const w of Object.values(o)) if (w && typeof w === 'object') tiefFrieren(w);
  return Object.freeze(o);
};

/** JSON-Schema der Antwort des Import-Dienstes (gleich KI_SCHEMA in proxy/worker.js). */
export const KI_SCHEMA = tiefFrieren({
  type: 'object',
  properties: {
    rezepte: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          servings: { type: 'integer' },
          totalMin: { type: 'integer' },
          mahlzeit: { type: 'string', enum: ['haupt', 'frueh'] },
          protein: { type: 'array', items: { type: 'string', enum: ['schwein', 'rind', 'gefluegel', 'fisch', 'vegetarisch', 'vegan'] } },
          zutaten: { type: 'array', items: { type: 'string' } },
          schritte: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'servings', 'totalMin', 'mahlzeit', 'protein', 'zutaten', 'schritte'],
        additionalProperties: false,
      },
    },
  },
  required: ['rezepte'],
  additionalProperties: false,
});

/** So bekommt der Worker Zugriff auf Workers AI (für Hinweise in der App). */
export const KI_ANLEITUNG = 'Cloudflare Dashboard → Workers & Pages → deinen Worker öffnen → Settings → Bindings → '
  + 'Add → Workers AI → Variable name „AI“ → Deploy';

const DIENST = 'Mehr → Import-Dienst';
const SPAETER = 'Versuch es später noch einmal.';
const MELDUNGEN = {
  'kein-proxy': `Für neue Ideen von der KI brauchst du den Import-Dienst (${DIENST}).`,
  'proxy-adresse': `Die Adresse des Import-Dienstes ist ungültig (${DIENST}).`,
  'ki-fehlt': `Dein Import-Dienst ist noch nicht mit der KI verbunden. So richtest du es einmalig ein: ${KI_ANLEITUNG}. `
    + 'Das ist im kostenlosen Plan enthalten.',
  veraltet: 'Dein Import-Dienst ist noch die alte Version ohne KI. Ersetze im Cloudflare Dashboard den Code des Workers '
    + `durch die aktuelle proxy/worker.js und tippe „Deploy“. Danach: ${KI_ANLEITUNG}.`,
  limit: 'Das kostenlose KI-Kontingent für heute ist aufgebraucht (10.000 Neurons pro Tag). Morgen geht es wieder – '
    + 'der Plan klappt auch ohne neue Ideen.',
  beschaeftigt: 'Die KI ist gerade ausgelastet – versuch es in einer Minute noch einmal.',
  'ki-modell': 'Das KI-Modell deines Import-Dienstes passt nicht. Hast du im Worker die Variable KI_MODELL angelegt? '
    + 'Dann lösch sie (Settings → Variables and Secrets) und tippe „Deploy“ – sonst ersetze den Code des Workers durch '
    + 'die aktuelle proxy/worker.js.',
  origin: 'Der Import-Dienst lehnt Anfragen dieser App ab. Trag die Adresse der App im Worker unter ERLAUBTE_ORIGINS '
    + 'ein (Cloudflare → Worker → Settings → Variables and Secrets).',
  netz: `Die KI ist gerade nicht erreichbar. ${SPAETER}`,
  ki: `Die KI hat einen Fehler gemeldet. ${SPAETER}`,
  dienst: ({ status }) => `Der Import-Dienst hat einen Fehler gemeldet (HTTP ${status}). ${SPAETER}`,
  'nicht-erreichbar': `Der Import-Dienst ist nicht erreichbar. Prüfe die Internetverbindung und unter ${DIENST} die `
    + 'Adresse. Ist der Worker schon länger nicht aktualisiert? Dann ersetze seinen Code durch die aktuelle '
    + 'proxy/worker.js und tippe „Deploy“.',
  offline: 'Du bist offline – neue Ideen von der KI gibt es nur mit Internet.',
  zeit: 'Die KI hat zu lange gebraucht. Versuch es noch einmal.',
  ungueltig: 'Die KI hat keine brauchbare Antwort geliefert. Versuch es noch einmal.',
  anfrage: 'Der Import-Dienst hat die Anfrage abgelehnt. Prüfe deine Angaben und versuch es noch einmal.',
  antwort: `Der Import-Dienst hat keine gültige Antwort geschickt. Stimmt die Adresse unter ${DIENST}?`,
};
// Grund → Code (danach richtet sich die Ansicht); sonst Grund = Code
const CODES = {
  'proxy-adresse': 'kein-proxy', veraltet: 'ki-fehlt', 'ki-modell': 'ki-fehlt', ki: 'netz', beschaeftigt: 'netz',
  dienst: 'netz', 'nicht-erreichbar': 'netz', offline: 'netz', zeit: 'netz', anfrage: 'ungueltig', antwort: 'ungueltig',
};
// Kennung `fehler` des Workers → Grund
const DIENST_GRUENDE = {
  'ki-fehlt': 'ki-fehlt', limit: 'limit', beschaeftigt: 'beschaeftigt', 'ki-modell': 'ki-modell', origin: 'origin',
  methode: 'veraltet', 'ki-format': 'ungueltig', ki: 'ki', ungueltig: 'anfrage', 'zu-gross': 'anfrage', 'kein-json': 'anfrage',
};

/**
 * Fehler bei KI-Ideen. code: 'kein-proxy' | 'ki-fehlt' | 'limit' | 'origin' | 'netz' | 'ungueltig';
 * grund ist der genaue Anlass (z. B. 'beschaeftigt' bei code 'netz', 'ki-modell' bei 'ki-fehlt');
 * message ist ein fertiger deutscher Text für einen Toast.
 */
export class KiFehler extends Error {
  constructor(code, message, { grund = code, status = null } = {}) {
    const m = MELDUNGEN[grund] ?? MELDUNGEN[code];
    super(message || (typeof m === 'function' ? m({ status }) : m) || 'Die KI-Anfrage hat nicht geklappt.');
    Object.assign(this, { name: 'KiFehler', code, grund, status });
  }
}

const kiFehler = (grund, details) => new KiFehler(CODES[grund] ?? grund, null, { grund, ...details });

// ---------------------------------------------------------------- Anfrage

const STEUER_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;
const einzeilig = (s) => String(s ?? '').normalize('NFC').replace(STEUER_RE, ' ').replace(/\s+/g, ' ').trim();
const kappe = (s, max) => (s.length > max ? s.slice(0, max).trimEnd() : s);
const MAX_BODY_BYTES = 7000;              // der Worker nimmt höchstens 8 KB

/** Body für holeKiRezepte: nur die nötigen Vorlieben, anzahl 1–4, höchstens 30 Titel zum Vermeiden. */
export function kiAnfrage(profil, { anzahl = 2, mahlzeit = 'haupt', vermeiden = [] } = {}) {
  const p = normalisiereProfil(profil);
  const titel = [];
  for (const t of Array.isArray(vermeiden) ? vermeiden : []) {
    const s = kappe(einzeilig(t), 80);
    if (s && !titel.some((x) => x.toLowerCase() === s.toLowerCase())) titel.push(s);
    if (titel.length >= 30) break;
  }
  const body = {
    profil: {
      protein: [...p.protein],
      ohne: (p.ohne || []).map((w) => kappe(einzeilig(w), 40)).filter(Boolean).slice(0, 20),
      allergene: [...(p.allergene || [])],
      kochzeit: p.kochzeit,
      personen: p.personen,
    },
    anzahl: Math.min(4, Math.max(1, Math.round(Number(anzahl)) || 1)),
    mahlzeit: mahlzeit === 'frueh' ? 'frueh' : 'haupt',
    vermeiden: titel,
  };
  // sehr lange Listen kürzen, damit die Anfrage sicher unter dem Limit des Workers bleibt
  const groesse = () => new TextEncoder().encode(JSON.stringify(body)).length;
  while (body.vermeiden.length && groesse() > MAX_BODY_BYTES) body.vermeiden.pop();
  return body;
}

/** Schickt die Anfrage an `${proxyUrl}?aktion=ki-rezepte` → rohe Rezeptliste; wirft KiFehler. */
export async function holeKiRezepte(proxyUrl, body, { fetchFn = (...a) => globalThis.fetch(...a), timeoutMs = 45000 } = {}) {
  let basis = String(proxyUrl ?? '').trim();
  if (!basis) throw kiFehler('kein-proxy');
  if (!/^https?:\/\//i.test(basis)) basis = `https://${basis}`;
  try { new URL(basis); } catch { throw kiFehler('proxy-adresse'); }

  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), timeoutMs);
  let antwort, roh;
  try {
    antwort = await fetchFn(`${basis}${basis.includes('?') ? '&' : '?'}aktion=ki-rezepte`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: abbruch.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    roh = await antwort.text();
  } catch {
    // auch eine Absage ohne CORS-Freigabe (fremde Origin, alter Worker ohne POST) landet hier
    throw kiFehler(abbruch.signal.aborted ? 'zeit' : globalThis.navigator?.onLine === false ? 'offline' : 'nicht-erreichbar');
  } finally {
    clearTimeout(uhr);
  }

  let daten = null;
  try { daten = JSON.parse(roh); } catch { /* unten */ }
  const status = Number(antwort.status) || 0;
  const fehler = typeof daten?.fehler === 'string' ? daten.fehler : null;
  if (fehler && Object.hasOwn(DIENST_GRUENDE, fehler)) throw kiFehler(DIENST_GRUENDE[fehler], { status });
  if (status === 501) throw kiFehler('ki-fehlt', { status });
  if (status === 429) throw kiFehler('limit', { status });
  if (status === 403) throw kiFehler('origin', { status });
  if (status === 405) throw kiFehler('veraltet', { status });
  if (status >= 500) throw kiFehler('dienst', { status });
  if (!antwort.ok || fehler) throw kiFehler('anfrage', { status });
  if (!daten || !Array.isArray(daten.rezepte)) throw kiFehler('antwort', { status });
  return daten.rezepte;
}

// ---------------------------------------------------------------- Prüfung

const FLEISCH = ['schwein', 'rind', 'gefluegel', 'fisch'];
const PROTEIN_IDS = PROTEINE.map((p) => p.id);
// Sicherheitsnetz zusätzlich zu erkenneProtein: versteckt Tierisches in fleischlosen Gerichten
const NICHT_VEGETARISCH = ['gelatine', 'worcester', 'fischsauce', 'fischsoße', 'austernsauce', 'austernsoße', 'auster',
  'fleischbrühe', 'rinderbrühe', 'hühnerbrühe', 'geflügelbrühe', 'kalbsfond', 'rinderfond', 'geflügelfond', 'wildfond',
  'fischfond', 'bratenfond', 'bratensaft', 'schweineschmalz', 'gänseschmalz', 'sardelle', 'anchovis', 'knochenmark'];
const NICHT_VEGAN = ['honig', 'gelée royale', 'schellack'];
// … außer in diesen Wörtern (Austernpilze und Honigmelone sind vegan)
const VERSTECKT_AUSSER = ['austernpilz', 'austernseitling', 'honigmelone'];
const MAX = { titel: 80, zeile: 120, schritt: 400, zutaten: 30, schritte: 12 };
// Kein Zutatenname: nur eine Einheit ('200 g' → 'g') oder ein Füllwort
const KEIN_NAME = new Set([...Object.entries(EINHEITEN).flatMap(([id, e]) => [id, e.name, e.plural]),
  'gramm', 'kilo', 'liter', 'stk', 'etwas', 'zutaten', 'nach belieben'].map((w) => w.toLowerCase().replace(/\.$/, '')));
const hatNamen = (z) => /\p{L}{2}/u.test(z?.name ?? '') && !KEIN_NAME.has(z.name.toLowerCase().replace(/\.$/, '').trim());

// ---------------------------------------------------------------- Texte prüfen (Titel, Schritte, „oder …“)
// KI-Rezepte nennen Zutaten oft nur in den Schritten („Speck auslassen“) oder als Alternative
// („Räuchertofu oder Speck“). Diese Texte werden in Stücke zerlegt und wie Zutaten geprüft.

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|\S/gu;
// Grenzen zwischen Stücken; nach „und“/„oder“ gilt eine Verneinung weiter („ohne Butter und Sahne“)
const AUFZAEHLUNG = new Set(['und', 'oder', 'bzw', 'beziehungsweise', 'sowie', 'alternativ', 'wahlweise']);
const GRENZE = new Set(['mit', 'in', 'im', 'ins', 'auf', 'aufs', 'zum', 'zur', 'für', 'nach', 'dazu', 'dann', 'danach',
  'anschließend', 'aber', 'bis', 'bei', 'beim', 'während', 'sobald']);
// Was darauf folgt, kommt nicht hinein („ohne Speck“, „statt Butter“) oder ist nur ein Vergleich („wie Rührei“)
const VERNEINUNG = new Set(['ohne', 'statt', 'anstatt', 'anstelle', 'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines',
  'wie', 'ähnlich']);
// Kein Tier, kein Allergen: hacken/gehackt („Hack“ und „Gehacktes“ sind Fleisch), Kürbisfleisch & Co., fleischlos,
// Bratensatz, Genuss und nussig ('nuss'), butterweich, milchig, halbieren/probieren ('bier'), mehligkochend ('mehl');
// Rinde ist kein Rind
const HACKEN_RE = /^(?:hacken|hackt|gehackt(?:e[nmr]?)?)$/i;
const HARMLOS_RE = new RegExp(`^(?:${[
  '[\\p{L}-]*(?:frucht|kokos|kürbis|avocado|melonen?|mango|auberginen?|tomaten|zucchini|papaya|ananas|pfirsich|kiwi)-?fleisch',
  'fleisch(?:los|frei)\\p{L}*', 'bratensatz', '\\p{L}*genu(?:ss|ß)\\p{L}*', 'nussig\\p{L}*', 'butter(?:weich|zart)\\p{L}*',
  'milchig\\p{L}*', '\\p{L}+bier(?:en|t|te|ten|tem|tes|st)', 'mehlig\\p{L}*'].join('|')})$`, 'u');
// Gerichtsformen, die es auch ohne Fleisch, Milch oder Weizen gibt (Linsen-Gulasch, Nussbraten, Chia-Pudding,
// spanische Tortilla, „Öl zum Braten“) – zählen nur, wenn sie ein Tier im Namen tragen („Schweinebraten“)
const FORMEN = ['gulaschs?', 'schnitzeln?', 'steaks?', 'rouladen?', 'frikadellen?', 'buletten?', 'köttbullar', 'cevapcici',
  'köfte', 'kofta', 'gyros', 'döner', 'kebabs?', 'schaschliks?', 'wiener', 'braten', 'medaillons?', 'geschnetzelte[nmrs]?',
  'patty', 'patties', 'puddings?', 'tortillas?'].join('|');
const FORM_RE = new RegExp(`^(?:${FORMEN})$`);
const FORM_ENDE_RE = new RegExp(`(?:${FORMEN})$`);         // 'Linsenköfte', 'Portobellosteaks'
// „das Fleisch“ ohne Tierart: in Schritten meist das Fleisch aus der Zutatenliste
const FLEISCH_WORT_RE = /^fleisch(?:es|stücke?n?|stückchen|würfeln?|streifen|scheiben)?$/;
// Wörter, die ein Stück als Ersatzprodukt kennzeichnen ('vegane Wurst', 'Tofu') – fallen nie weg
const ERSATZ_RE = /vegan|vegetar|veggie|pflanzlich|ersatz|soja|tofu|seitan|tempeh|lupine/;
const GROSS_RE = /^\p{Lu}/u;
// Partizip als Adjektiv am Satzanfang („Gebratener Reis“, „Geriebenen Käse …“) ist kein Hauptwort – „Gehacktes“ schon
const PARTIZIP_RE = /^ge\p{L}+(?:t|en)(?:e|er|es|en|em)$/u;

// Wörter der Zutatenzeilen (ohne Einheiten und Füllwörter)
function zutatenWoerter(zeilen) {
  const woerter = new Set();
  for (const z of zeilen) for (const w of z.toLowerCase().match(/\p{L}+/gu) ?? []) if (!KEIN_NAME.has(w)) woerter.add(w);
  return woerter;
}

// Nennt ein Schritt nur eine Zutat der Liste („Milch erhitzen“ bei Hafermilch)? Die ist dort schon geprüft.
function inZutaten(wort, woerter) {
  if (woerter.has(wort)) return true;
  if (wort.length <= 3 || ERSATZ_RE.test(wort)) return false;
  for (const w of woerter) if (w.includes(wort)) return true;
  return false;
}

/**
 * Text → Stücke ohne Verneintes („Reis ohne Butter kochen“ → nur „reis“): { text, nomen } mit dem Text klein
 * geschrieben und den Hauptwörtern (groß geschrieben, samt 'vegane' davor) – nur in ihnen stehen Tiere, Verben
 * wie „braten“ zählen so nicht. bekannt: Wörter der Zutatenliste weglassen; „das Fleisch“ landet in merker.fleisch.
 */
function textStuecke(text, { bekannt = null, merker = {} } = {}) {
  const stuecke = [];
  let woerter = [], nomen = [], ersatz = [], verneint = false;
  const schliessen = () => {
    if (woerter.length && !verneint) stuecke.push({ text: woerter.join(' '), nomen });
    woerter = [];
    nomen = [];
    ersatz = [];
  };
  for (const roh of einzeilig(text).match(TOKEN_RE) ?? []) {
    const wort = roh.toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(wort) || GRENZE.has(wort)) {
      schliessen();
      verneint = false;
    } else if (AUFZAEHLUNG.has(wort)) {
      schliessen();
    } else if (VERNEINUNG.has(wort)) {
      schliessen();
      verneint = true;
    } else if (!HACKEN_RE.test(wort) && !HARMLOS_RE.test(wort)) {
      const teile = wort.replace(/rinden?$/, '').split('-').filter((t) => {
        if (!t || FORM_RE.test(t)) return false;
        if (FLEISCH_WORT_RE.test(t)) {
          if (!verneint) merker.fleisch = true;
          return false;
        }
        return !(bekannt && inZutaten(t, bekannt));
      });
      if (!teile.length) continue;
      const w = teile.join('-');
      woerter.push(w);
      if (GROSS_RE.test(roh) && (w === 'gehacktes' || !PARTIZIP_RE.test(w))) nomen.push([...ersatz, w].join(' '));
      else if (ERSATZ_RE.test(w)) ersatz.push(w);
    }
  }
  schliessen();
  return stuecke;
}

// Allergene und „Lieber nicht“ (wie passtZumProfil) in Textstücken; tierisch: Milch, Ei, Honig oder Pesto darin
function pruefeStuecke(texte, p) {
  const pseudo = { title: '', mahlzeit: 'haupt', protein: ['vegan'], totalMin: 5, ingredients: texte.map((name) => ({ name })) };
  const alle = { ...p, protein: PROTEIN_IDS, kochzeit: 'egal' };
  const passt = passtZumProfil(pseudo, alle);
  const tierisch = !passtZumProfil(pseudo, { ...alle, allergene: ['laktose', 'ei'], ohne: [] }).ok
    || texte.some((t) => !/vegan|pflanzlich/.test(t) && verstecktIn(t, ['honig', 'pesto']));
  return { grund: passt?.ok ? null : passt?.grund || 'Passt nicht zu den Vorlieben', tierisch };
}

// Proteine aus mehreren Erkennungen: Fleisch/Fisch aus allen, sonst vegetarisch, wenn eine Tierprodukte fand
function vereine(...listen) {
  const alle = listen.flat();
  const fleisch = FLEISCH.filter((id) => alle.includes(id));
  if (fleisch.length) return fleisch;
  return alle.includes('vegetarisch') ? ['vegetarisch'] : ['vegan'];
}

// Enthält ein Text ein Wort der Liste (Ausnahmen wie 'austernpilz' vorher entfernt)?
function verstecktIn(text, woerter) {
  let t = text;
  for (const a of VERSTECKT_AUSSER) t = t.split(a).join(' ');
  return woerter.some((w) => t.includes(w));
}

// Zahl aus Zahl oder Text ('4', '4 Portionen', '2,5'), sonst null
const zahlOderNull = (w) => {
  const n = typeof w === 'number' ? w : typeof w === 'string' ? parseFloat(w.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const klemme = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

// Texte einer Liste säubern; Aufzählungszeichen (und bei Schritten Nummern) vorne weg
function saubereListe(liste, { max, laenge, nummern = false }) {
  if (!Array.isArray(liste)) return null;
  const ergebnis = [];
  for (const x of liste) {
    if (typeof x !== 'string') continue;
    let s = einzeilig(x).replace(/^[-–•*·▢☐]+\s*/, '');
    if (nummern) s = s.replace(/^(?:schritt\s*)?\d{1,2}\s*[.):]\s*/i, '');
    s = kappe(s, laenge);
    if (s) ergebnis.push(s);
    if (ergebnis.length >= max) break;
  }
  return ergebnis;
}

// Protein aus behauptetem und erkanntem: Fleisch/Fisch aus beiden zählt; fleischlos nur, wenn beides passt
function bestimmeProtein(behauptet, erkannt) {
  const b = PROTEIN_IDS.filter((id) => behauptet.includes(id));
  const e = erkannt.length ? erkannt : ['vegetarisch'];
  const fleisch = FLEISCH.filter((id) => b.includes(id) || e.includes(id));
  const bFleischlos = b.includes('vegetarisch') || b.includes('vegan');
  if (fleisch.length) {
    return bFleischlos ? { grund: 'Fleisch oder Fisch in einem fleischlosen Gericht' } : { protein: fleisch };
  }
  if (b.includes('vegan') && !b.includes('vegetarisch')) {
    return e.includes('vegan') ? { protein: ['vegan'] } : { grund: 'Tierische Zutaten in einem veganen Gericht' };
  }
  // behauptet vegetarisch → bleibt vegetarisch (vorsichtig), sonst gilt das Erkannte
  return { protein: b.length ? ['vegetarisch'] : (e.includes('vegan') ? ['vegan'] : ['vegetarisch']) };
}

/** Kurze, stabile id aus dem Titel: gleicher Titel → gleiche id ('ki-' + 8 Hex-Zeichen). */
export function kiId(titel) {
  let h = 0x811c9dc5;
  for (const z of einzeilig(titel).toLowerCase()) h = Math.imul(h ^ z.codePointAt(0), 0x01000193) >>> 0;
  return `ki-${h.toString(16).padStart(8, '0')}`;
}

/**
 * Prüft eine KI-Antwort genau → { index, rezept, grund }: rezept im Rohformat von js/daten (herkunft 'ki')
 * oder null mit grund (deutscher Text). index = Position in der Antwort.
 */
export function bewerteKiRezept(roh, profil, index = 0) {
  const nein = (grund) => ({ index, rezept: null, grund });
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return nein('Kein Rezept');
  const p = normalisiereProfil(profil);
  const title = kappe(einzeilig(typeof roh.title === 'string' ? roh.title : '').replace(/^["„“]+|["“”]+$/g, ''), MAX.titel);
  const servings = zahlOderNull(roh.servings);
  const totalMin = zahlOderNull(roh.totalMin);
  const zutaten = saubereListe(roh.zutaten, { max: MAX.zutaten, laenge: MAX.zeile })?.filter((z) => !/:$/.test(z));
  const schritte = saubereListe(roh.schritte, { max: MAX.schritte, laenge: MAX.schritt, nummern: true });
  if (!title || servings === null || totalMin === null || !zutaten || !schritte) return nein('Angaben fehlen');

  // jede Zeile muss eine Zutat ergeben; mindestens 3 Zutaten und 2 Schritte
  if (!zutaten.map(parseZeile).every(hatNamen)) return nein('Zutat nicht lesbar');
  const ingredients = parseZeilen(zutaten.join('\n'));
  if (ingredients.length < 3) return nein('Zu wenige Zutaten');
  if (schritte.length < 2) return nein('Zu wenige Schritte');

  // Zutaten (Schlüssel) und zusätzlich als Text: ganze Zeilen mit „oder …“, Titel und Schritte
  // (Zeilen ganz, in Titel und Schritten nur die Hauptwörter, die nicht schon in der Zutatenliste stehen)
  const merker = { fleisch: false };
  const zeilen = zutaten.flatMap((z) => textStuecke(z));
  const bekannt = zutatenWoerter(zutaten);
  const saetze = [title, ...schritte].flatMap((t) => textStuecke(t, { bekannt, merker }));
  const texte = [...zeilen, ...saetze].map((s) => s.text);
  const imText = pruefeStuecke(texte, p);
  const behauptet = Array.isArray(roh.protein) ? roh.protein.filter((x) => typeof x === 'string') : [];
  // Hauptwörter einzeln; eins für Fleisch ohne Tierart („Filets“, „Bratensaft“) zählt wie „das Fleisch“,
  // eine Gerichtsform mit Pflanzlichem davor („Linsenköfte“) gar nicht
  const tiere = [];
  const tiereIn = (text) => erkenneProtein({ zutaten: [text] }).filter((id) => FLEISCH.includes(id));
  for (const nomen of saetze.flatMap((s) => s.nomen)) {
    const e = tiereIn(nomen);
    const form = e.length ? FORM_ENDE_RE.exec(nomen) : null;
    if (form && form.index >= 3 && !tiereIn(nomen.slice(0, form.index)).length) continue;
    if (e.length >= 3) merker.fleisch = true;
    else tiere.push(...e);
  }
  let erkannt = vereine(erkenneProtein({ title, ingredients }), erkenneProtein({ zutaten: zeilen.map((s) => s.text) }),
    tiere, imText.tierisch ? ['vegetarisch'] : []);
  // „das Fleisch“ ohne Tierart zählt nur, wenn sonst nirgends Fleisch oder Fisch steht (wie im Planer: Rind)
  if (merker.fleisch && !FLEISCH.some((id) => erkannt.includes(id) || behauptet.includes(id))) erkannt = ['rind'];
  const diaet = bestimmeProtein(behauptet, erkannt);
  if (!diaet.protein) return nein(diaet.grund);
  const schluessel = [...ingredients.map((z) => zutatSchluessel(z.name)), ...texte];
  const fleischlos = !diaet.protein.some((id) => FLEISCH.includes(id));
  const versteckt = [...(fleischlos ? NICHT_VEGETARISCH : []), ...(diaet.protein.includes('vegan') ? NICHT_VEGAN : [])];
  if (schluessel.some((k) => verstecktIn(k, versteckt))) return nein('Versteckte tierische Zutat');

  const rezept = {
    id: kiId(title),
    title,
    servings: klemme(servings, 1, 12),
    prepMin: null,
    cookMin: null,
    totalMin: klemme(totalMin, 5, 240),
    mahlzeit: roh.mahlzeit === 'frueh' ? 'frueh' : 'haupt',
    protein: diaet.protein,
    tags: [],
    zutaten,
    schritte,
    herkunft: 'ki',
  };
  // Vorlieben, „Lieber nicht“ und Allergene wie beim Planen (die Kochzeit prüft erst der Planer),
  // danach dieselben Wörter in Titel, Schritten und Alternativen
  const passt = passtZumProfil(kiRezeptZuRezept(rezept), { ...p, kochzeit: 'egal' });
  if (!passt?.ok) return nein(passt?.grund || 'Passt nicht zu den Vorlieben');
  if (imText.grund) return nein(imText.grund);
  return { index, rezept, grund: null };
}

/** Geprüftes KI-Rezept im Rohformat (wie js/daten, herkunft 'ki') oder null, wenn es unbrauchbar ist. */
export function pruefeKiRezept(roh, profil, index = 0) {
  return bewerteKiRezept(roh, profil, index).rezept;
}

/**
 * Prüft eine ganze Antwort: doppelte Titel und Titel aus `vorhanden` (z. B. Grundrezepte) fallen weg.
 * → { rezepte: [Rohformat], verworfen: [{ index, titel, grund }] }
 */
export function pruefeKiRezepte(liste, profil, { vorhanden = [] } = {}) {
  const bekannt = new Set([...vorhanden].map((t) => einzeilig(t).toLowerCase()));
  const rezepte = [], verworfen = [];
  (Array.isArray(liste) ? liste : []).forEach((roh, i) => {
    const titel = einzeilig(roh?.title ?? '');
    const { rezept, grund } = bewerteKiRezept(roh, profil, i);
    const doppelt = rezept && (bekannt.has(rezept.title.toLowerCase()) || rezepte.some((r) => r.id === rezept.id));
    if (rezept && !doppelt) {
      rezepte.push(rezept);
      bekannt.add(rezept.title.toLowerCase());
    } else {
      verworfen.push({ index: i, titel, grund: grund || 'Gibt es schon' });
    }
  });
  return { rezepte, verworfen };
}

/** Rohes KI-Rezept → Rezept im Datenbank-Schema (wie ladeGrundrezepte, ids deterministisch). */
export function kiRezeptZuRezept(raw) {
  const id = String(raw?.id || kiId(raw?.title));
  const zutaten = Array.isArray(raw?.zutaten) ? raw.zutaten : [];
  const schritte = Array.isArray(raw?.schritte) ? raw.schritte : [];
  return {
    id,
    title: String(raw?.title ?? ''),
    servings: raw?.servings ?? null,
    prepMin: raw?.prepMin ?? null,
    cookMin: raw?.cookMin ?? null,
    totalMin: raw?.totalMin ?? null,
    tags: Array.isArray(raw?.tags) ? [...raw.tags] : [],
    notes: 'KI-Idee – bitte vor dem Kochen prüfen.',
    favorite: false,
    sourceUrl: null,
    sourceSite: 'KI-Idee',
    imageUrl: null,
    herkunft: 'ki',
    mahlzeit: raw?.mahlzeit === 'frueh' ? 'frueh' : 'haupt',
    protein: Array.isArray(raw?.protein) ? [...raw.protein] : [],
    ingredients: parseZeilen(zutaten.join('\n')).map((z, i) => ({ ...z, id: `${id}-z${i}` })),
    steps: schritte.map((text, i) => ({ id: `${id}-s${i}`, group: null, text })),
  };
}
