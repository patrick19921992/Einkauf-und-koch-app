// KI-Rezeptideen für „Automatisch planen“: Anfrage an den Import-Dienst (Workers AI, siehe
// proxy/worker.js) und strenge Prüfung jeder Antwort. Läuft im Browser und in Node (Tests);
// nur holeKiRezepte() greift aufs Netz zu. KI-Rezepte sind Ideen – die App sagt das auch so.

import { EINHEITEN, parseZeile, parseZeilen, zutatSchluessel } from './zutaten.js';
import { ALLERGENE, PROTEINE, erkenneProtein, normalisiereProfil, passtZumProfil } from './planer.js';

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
  'proxy-adresse': 'kein-proxy', veraltet: 'ki-fehlt', ki: 'netz', dienst: 'netz', 'nicht-erreichbar': 'netz',
  offline: 'netz', zeit: 'netz', anfrage: 'ungueltig', antwort: 'ungueltig',
};
// Kennung `fehler` des Workers → Grund
const DIENST_GRUENDE = {
  'ki-fehlt': 'ki-fehlt', limit: 'limit', origin: 'origin', methode: 'veraltet', 'ki-format': 'ungueltig', ki: 'ki',
  ungueltig: 'anfrage', 'zu-gross': 'anfrage', 'kein-json': 'anfrage',
};

/**
 * Fehler bei KI-Ideen. code: 'kein-proxy' | 'ki-fehlt' | 'limit' | 'origin' | 'netz' | 'ungueltig';
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
const MAX = { titel: 80, zeile: 120, schritt: 400, zutaten: 30, schritte: 12 };
// Kein Zutatenname: nur eine Einheit ('200 g' → 'g') oder ein Füllwort
const KEIN_NAME = new Set([...Object.entries(EINHEITEN).flatMap(([id, e]) => [id, e.name, e.plural]),
  'gramm', 'kilo', 'liter', 'stk', 'etwas', 'zutaten', 'nach belieben'].map((w) => w.toLowerCase().replace(/\.$/, '')));
const hatNamen = (z) => /\p{L}{2}/u.test(z?.name ?? '') && !KEIN_NAME.has(z.name.toLowerCase().replace(/\.$/, '').trim());

// Wort im Text: kurze Wörter (≤ 3 Zeichen, z. B. 'ei') nur als ganzes Wort, sonst als Teil ('pilz' in 'pilzpfanne')
function enthaeltWort(text, wort) {
  const w = String(wort ?? '').toLowerCase().trim();
  if (!w) return false;
  return w.length > 3 ? text.includes(w) : text.split(/[^\p{L}]+/u).includes(w);
}

// Nennt der Titel etwas aus „Lieber nicht“ oder einem gewählten Allergen („Pilzpfanne“)? → Wort | null
function titelTreffer(titel, p) {
  const gruppen = [...p.ohne.map((w) => ({ woerter: [w], ausser: [] })), ...ALLERGENE.filter((a) => p.allergene.includes(a.id))];
  for (const { woerter, ausser = [] } of gruppen) {
    let t = titel.toLowerCase();
    for (const a of ausser) t = t.split(a).join(' ');          // 'kokosmilch' ist keine Milch
    const wort = woerter.find((w) => enthaeltWort(t, w));
    if (wort) return wort;
  }
  return null;
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

  const erkannt = erkenneProtein({ title, ingredients });
  const behauptet = Array.isArray(roh.protein) ? roh.protein.filter((x) => typeof x === 'string') : [];
  const diaet = bestimmeProtein(behauptet, Array.isArray(erkannt) ? erkannt : []);
  if (!diaet.protein) return nein(diaet.grund);
  const schluessel = ingredients.map((z) => zutatSchluessel(z.name));
  const fleischlos = !diaet.protein.some((id) => FLEISCH.includes(id));
  const versteckt = [...(fleischlos ? NICHT_VEGETARISCH : []), ...(diaet.protein.includes('vegan') ? NICHT_VEGAN : [])];
  if (schluessel.some((k) => versteckt.some((w) => k.includes(w)))) return nein('Versteckte tierische Zutat');

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
  // Vorlieben, „Lieber nicht“ und Allergene wie beim Planen (die Kochzeit prüft erst der Planer)
  const passt = passtZumProfil(kiRezeptZuRezept(rezept), { ...p, kochzeit: 'egal' });
  if (!passt?.ok) return nein(passt?.grund || 'Passt nicht zu den Vorlieben');
  const wort = titelTreffer(title, p);
  if (wort) return nein(`Enthält ${wort}`);
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
