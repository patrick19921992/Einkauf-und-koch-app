// Planer ohne DOM: wählt aus Rezepten passend zu Vorlieben, Personen, Mahlzeiten, Läden und Budget
// automatisch einen Plan und schätzt die Kosten. Gleicher Startwert (seed) → gleicher Plan. Läuft auch in Node.

import { zutatSchluessel, skaliere, inBasis, parseZahl, parseZeile } from './zutaten.js';
import { postenSchluessel, abteilungVon } from './einkaufsliste.js';
import { kostenFuer, LAEDEN } from './preise.js';
import { heute as heuteSchluessel, plusTage, istSchluessel } from './datum.js';

// ---------------------------------------------------------------- Auswahl-Listen

const einfrieren = (liste) => Object.freeze(liste.map((x) => Object.freeze(x)));

/** Hauptzutaten zur Auswahl („Was esst ihr gern?“). */
export const PROTEINE = einfrieren([['schwein', 'Schwein'], ['rind', 'Rind'], ['gefluegel', 'Geflügel'],
  ['fisch', 'Fisch'], ['vegetarisch', 'Vegetarisch'], ['vegan', 'Vegan']].map(([id, name]) => ({ id, name })));

const MILCH = ['milch', 'sahne', 'butter', 'käse', 'joghurt', 'jogurt', 'quark', 'schmand', 'mozzarella', 'parmesan',
  'crème fraîche', 'creme fraiche', 'crème fraiche', 'mascarpone', 'ricotta', 'feta', 'gouda', 'emmentaler', 'cheddar',
  'kefir', 'molke', 'skyr', 'rahm', 'raclette', 'halloumi', 'camembert', 'brie', 'gorgonzola', 'pecorino', 'burrata',
  'pudding'];
const MILCH_AUSSER = ['kokosmilch', 'kokosnussmilch', 'hafermilch', 'sojamilch', 'mandelmilch', 'reismilch', 'milchreis',
  'erdnussbutter', 'kakaobutter', 'mandelbutter', 'cashewbutter', 'sojasahne', 'hafersahne', 'kokossahne', 'sojajoghurt',
  'kokosjoghurt', 'vegan', 'pflanzlich'];
const EI = ['ei', 'eier', 'eigelb', 'eiweiß', 'eiklar', 'hühnerei', 'wachtelei', 'rührei', 'spiegelei', 'mayonnaise',
  'mayo', 'remoulade', 'aioli', 'spätzle', 'eiernudel', 'eierlikör', 'baiser'];
const FISCH = ['fisch', 'lachs', 'kabeljau', 'forelle', 'hering', 'matjes', 'makrele', 'sardine', 'sardelle', 'anchovis',
  'garnele', 'shrimp', 'krabbe', 'scampi', 'gamba', 'muschel', 'calamar', 'oktopus', 'surimi', 'dorsch', 'pangasius',
  'rotbarsch', 'scholle', 'zander', 'karpfen', 'dorade', 'heilbutt', 'meeresfrüchte', 'worcester', 'kaviar', 'rollmops'];
const FISCH_AUSSER = ['muschelnudel', 'lachsschinken'];

/** Allergene und Unverträgliches („Lieber nicht“): Wörter in den Zutaten-Schlüsseln, `ausser` hebt Treffer auf. */
export const ALLERGENE = einfrieren([
  { id: 'nuesse', name: 'Nüsse', woerter: ['nuss', 'nüsse', 'mandel', 'cashew', 'pistazie', 'macadamia', 'pinienkern',
    'erdnuss', 'marzipan', 'nougat', 'krokant', 'praline'], ausser: ['muskatnuss', 'kokosnuss'] },
  { id: 'laktose', name: 'Laktose', woerter: MILCH, ausser: MILCH_AUSSER },
  { id: 'gluten', name: 'Gluten', woerter: ['mehl', 'weizen', 'dinkel', 'roggen', 'gerste', 'hafer', 'nudel', 'spaghetti',
    'penne', 'fusilli', 'farfalle', 'tagliatelle', 'lasagne', 'makkaroni', 'maccheroni', 'rigatoni', 'tortellini',
    'ravioli', 'gnocchi', 'spätzle', 'schupfnudel', 'maultasche', 'pasta', 'brot', 'brötchen', 'toast', 'baguette',
    'ciabatta', 'wrap', 'tortilla', 'pita', 'naan', 'couscous', 'bulgur', 'grieß', 'paniermehl', 'semmelbrösel',
    'panko', 'teig', 'croissant', 'zwieback', 'knödel', 'keks', 'kuchen', 'sojasauce', 'seitan', 'graupe', 'cracker',
    'müsli', 'bier', 'orzo', 'kritharaki', 'udon', 'ramen', 'mie'],
  ausser: ['reisnudel', 'glasnudel', 'maismehl', 'reismehl', 'kichererbsenmehl', 'mandelmehl', 'kokosmehl', 'buchweizen',
    'maistortilla', 'glutenfrei', 'reispapier', 'johannisbrotkernmehl'] },
  { id: 'ei', name: 'Ei', woerter: EI, ausser: ['vegan', 'pflanzlich'] },
  { id: 'soja', name: 'Soja', woerter: ['soja', 'tofu', 'tempeh', 'edamame', 'miso'], ausser: [] },
  { id: 'fisch', name: 'Fisch', woerter: FISCH, ausser: FISCH_AUSSER },
]);

/** Mahlzeiten; die ids sind die Plan-Slots (planEntries.slot). */
export const MAHLZEITEN = einfrieren([{ id: 'frueh', name: 'Frühstück', art: 'frueh' },
  { id: 'mittag', name: 'Mittagessen', art: 'haupt' }, { id: 'abend', name: 'Abendessen', art: 'haupt' }]);

/** Standard-Vorlieben (eingefroren – eine veränderbare Kopie liefert normalisiereProfil({})). */
export const STANDARD_PROFIL = Object.freeze({
  protein: Object.freeze(['schwein', 'rind', 'gefluegel', 'fisch', 'vegetarisch', 'vegan']), ohne: Object.freeze([]),
  allergene: Object.freeze([]), kochzeit: 'normal', personen: 2, tage: 7, start: null,
  mahlzeiten: Object.freeze(['abend']), laeden: Object.freeze(['lidl']), budget: null, eigeneRezepte: true,
  kiIdeen: false,
});

const KOCHZEITEN = { schnell: { haupt: 25, frueh: 15 }, normal: { haupt: 45, frueh: 25 }, egal: null };
const PROTEIN_IDS = PROTEINE.map((p) => p.id);
const ALLERGEN_IDS = ALLERGENE.map((a) => a.id);
const SLOT_IDS = MAHLZEITEN.map((m) => m.id);
const LADEN_IDS = LAEDEN.map((l) => l.id);

// ---------------------------------------------------------------- Profil und Zeiten

const ganzzahl = (x, min, max, standard) => {
  const n = Math.round(Number(x));
  return x == null || x === '' || !Number.isFinite(n) ? standard : Math.min(max, Math.max(min, n));
};
// gültige ids in fester Reihenfolge (ohne Doppelte)
const auswahl = (liste, alle) => alle.filter((id) => Array.isArray(liste) && liste.includes(id));

/** Vollständiges, begrenztes Profil (unbekannte ids fallen weg, mindestens ein Protein und eine Mahlzeit). */
export function normalisiereProfil(p = {}) {
  const q = p && typeof p === 'object' ? p : {};
  const protein = auswahl(q.protein, PROTEIN_IDS);
  const mahlzeiten = auswahl(q.mahlzeiten, SLOT_IDS);
  // Läden in der gewählten Reihenfolge (bei Gleichstand gewinnt der erste), höchstens 3
  const laeden = [...new Set(Array.isArray(q.laeden) ? q.laeden : [])].filter((id) => LADEN_IDS.includes(id)).slice(0, 3);
  const ohneRoh = Array.isArray(q.ohne) ? q.ohne : typeof q.ohne === 'string' ? q.ohne.split(',') : [];
  const budget = parseZahl(q.budget);
  return {
    protein: protein.length ? protein : [...STANDARD_PROFIL.protein],
    ohne: [...new Set(ohneRoh.map((w) => zutatSchluessel(String(w ?? '').slice(0, 40))).filter(Boolean))].slice(0, 30),
    allergene: auswahl(q.allergene, ALLERGEN_IDS),
    kochzeit: Object.hasOwn(KOCHZEITEN, q.kochzeit ?? '') ? q.kochzeit : 'normal',
    personen: ganzzahl(q.personen, 1, 12, 2),
    tage: ganzzahl(q.tage, 1, 14, 7),
    start: istSchluessel(q.start) ? q.start : null,
    mahlzeiten: mahlzeiten.length ? mahlzeiten : ['abend'],
    laeden: laeden.length ? laeden : ['lidl'],
    budget: budget != null && budget > 0 ? Math.round(budget * 100) / 100 : null,
    eigeneRezepte: q.eigeneRezepte !== false,
    kiIdeen: q.kiIdeen === true,
  };
}

/** '25 Min.', '1 Std. 10 Min.', '' ohne Angabe. */
export function zeitText(min) {
  const m = Math.round(Number(min));
  if (min == null || min === '' || !Number.isFinite(m) || m <= 0) return '';
  if (m < 60) return `${m} Min.`;
  return m % 60 ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${m / 60} Std.`;
}

/** Passt die Gesamtzeit zur Kochzeit ('schnell' ≤ 25, 'normal' ≤ 45 Min.; Frühstück ≤ 15 bzw. ≤ 25)? */
export function kochzeitPasst(min, kochzeit, art = 'haupt') {
  const grenze = KOCHZEITEN[kochzeit]?.[art === 'frueh' ? 'frueh' : 'haupt'];
  const m = Number(min);
  return grenze == null || !(m > 0) || m <= grenze;
}

// ---------------------------------------------------------------- Zutaten erkennen

// kurze Wörter (≤ 3 Buchstaben) nur als ganzes Wort ('ei' ≠ 'reis'), längere auch im Wort ('weizenmehl').
// `ausser` nimmt Teile aus dem Schlüssel heraus ('kokosmilch'); 'vegan'/'pflanzlich' darin heben die Zeile ganz auf.
function treffer(key, woerter, ausser = []) {
  let k = key;
  for (const a of ausser) {
    if (!k.includes(a)) continue;
    if (a === 'vegan' || a === 'pflanzlich') return null;
    k = k.split(a).join(' ');
  }
  const woerterImKey = k.split(/[\s,/-]+/);
  return woerter.find((w) => (w.length > 3 ? k.includes(w) : woerterImKey.includes(w))) ?? null;
}

const istUeberschrift = (z) => z.qty == null && /:\s*$/.test(String(z.raw ?? z.name));
const SCHLUESSEL_CACHE = new WeakMap();

// Schlüssel aller Zutaten (db-Rezept mit ingredients oder Rohformat mit zutaten-Texten), je Rezept-Objekt gemerkt
function zutatenSchluessel(rezept) {
  if (!rezept || typeof rezept !== 'object') return [];
  let keys = SCHLUESSEL_CACHE.get(rezept);
  if (keys) return keys;
  const liste = Array.isArray(rezept.ingredients) ? rezept.ingredients
    : Array.isArray(rezept.zutaten) ? rezept.zutaten : [];
  keys = [];
  for (const z of liste) {
    const zutat = typeof z === 'string' ? parseZeile(z) : z;
    if (!zutat || typeof zutat !== 'object' || !String(zutat.name ?? '').trim() || istUeberschrift(zutat)) continue;
    const k = postenSchluessel(zutat).toLowerCase();
    if (k) keys.push(k);
  }
  SCHLUESSEL_CACHE.set(rezept, keys);
  return keys;
}

const ERSATZ_RE = /vegan|vegetarisch|veggie|pflanzlich|fleischersatz|soja|tofu|seitan|tempeh/;
const KEIN_FLEISCH_RE = /fruchtfleisch|kokosfleisch|fleischtomate|butterschmalz|hirschhornsalz|ochsenherz/g;
// Muster aus Wortlisten: `ueberall` auch mitten im Wort, `anfang` nur am Wortanfang ('reh' ≠ 'rehydriert')
const muster = (ueberall, anfang = []) =>
  new RegExp([...ueberall, ...(anfang.length ? [`(?:^|[\\s-])(?:${anfang.join('|')})`] : [])].join('|'));
const GEFLUEGEL_RE = muster(['hähnchen', 'hühnchen', 'huhn', 'hühner(?!ei)', 'hendl', 'chicken', 'geflügel', 'poularde',
  'kaninchen', 'truthahn'], ['pute', 'ente(?:n|$|[\\s,])', 'gans', 'gänse']);
const RIND_RE = muster(['rind', 'beef', 'kalb', 'tafelspitz', 'rumpsteak', 'hüftsteak', 'entrecote', 'bresaola', 'hammel',
  'hirsch'], ['lamm', 'ochse', 'reh', 'steak', 'gulasch', 'roulade']);
const SCHWEIN_RE = muster(['schwein', 'speck', 'bacon', 'kassler', 'kasseler', 'pancetta', 'guanciale', 'prosciutto',
  'chorizo', 'gelatine', 'eisbein', 'spareribs', 'pork']);
// Wurst, Schinken & Co. sind Schwein, außer Geflügel/Rind steht dabei ('putenschinken', 'rindersalami')
const WURST_RE = muster(['schinken', 'salami', 'wurst', 'würstchen', 'mortadella', 'leberkäse', 'fleischkäse', 'schmalz',
  'cabanossi', 'lyoner', 'zwiebelmett'], ['mett', 'wiener', 'schnitzel', 'kotelett', 'haxe', 'gyros']);
const ANDERES_TIER_RE = muster(['hähnchen', 'hühnchen', 'huhn', 'hühner', 'pute', 'geflügel', 'gans', 'gänse', 'ente',
  'rind', 'kalb', 'lamm', 'hirsch', 'reh']);
// Hack ohne Tierart = gemischt; 'gehackt' (Tomaten) zählt nicht
const HACK_RE = muster(['[a-zäöü]hack(?:fleisch)?(?:$|[\\s,])'],
  ['hack', 'gehacktes', 'frikadelle', 'bulette', 'köttbullar', 'cevapcici']);

// Tierisches in einem Zutaten-Schlüssel
function tiereIn(roh) {
  const key = roh.replace(KEIN_FLEISCH_RE, ' ');
  const t = new Set();
  if (ERSATZ_RE.test(key)) return t;
  if (GEFLUEGEL_RE.test(key)) t.add('gefluegel');
  if (RIND_RE.test(key)) t.add('rind');
  if (SCHWEIN_RE.test(key)) t.add('schwein');
  if (treffer(key, FISCH, FISCH_AUSSER)) t.add('fisch');
  const anderes = ANDERES_TIER_RE.test(key);
  if (WURST_RE.test(key) && !anderes) t.add('schwein');
  if (HACK_RE.test(key) && !anderes && !/schwein/.test(key)) { t.add('rind'); t.add('schwein'); }
  // nur 'Fleisch' ohne Tierart ('Suppenfleisch', 'Fleischbrühe') → Rind
  if (!t.size && /fleisch/.test(key)) t.add('rind');
  return t;
}

/** Proteine eines Rezepts aus seinen Zutaten: z. B. ['rind', 'schwein'] (gemischtes Hack), ['vegetarisch'], ['vegan']. */
export function erkenneProtein(rezept) {
  const tiere = new Set();
  let tierprodukt = false;
  for (const key of zutatenSchluessel(rezept)) {
    for (const x of tiereIn(key)) tiere.add(x);
    tierprodukt ||= Boolean(treffer(key, MILCH, MILCH_AUSSER) || treffer(key, EI, ['vegan']) ||
      treffer(key, ['honig', 'pesto'], ['honigmelone', 'vegan']));
  }
  const fleisch = ['rind', 'schwein', 'gefluegel', 'fisch'].filter((p) => tiere.has(p));
  return fleisch.length ? fleisch : [tierprodukt ? 'vegetarisch' : 'vegan'];
}

const FRUEH_RE = /frühstück|fruehstueck|breakfast|müsli|porridge|overnight|granola|haferbrei/i;
const KEIN_GERICHT_RE = muster(['torten?(?![a-zäöü])', 'plätzchen', 'kekse', 'cookies', 'muffins?(?![a-zäöü])', 'brownie',
  'dessert', 'nachtisch', 'cocktail', 'likör', 'marmelade', 'konfitüre', 'sirup', 'smoothie', 'getränk', 'punsch']);
const KEIN_GERICHT_TAGS = new Set(['dessert', 'nachtisch', 'kuchen', 'torte', 'gebäck', 'plätzchen', 'kekse', 'getränk',
  'getränke', 'drink', 'drinks', 'cocktail']);

// Gramm Zucker (für Kuchen-Erkennung bei eigenen Rezepten ohne Mahlzeit-Angabe)
function zuckerGramm(r) {
  let g = 0;
  for (const z of Array.isArray(r.ingredients) ? r.ingredients : []) {
    const k = zutatSchluessel(z?.name);
    if (!/zucker$/.test(k) || /vanill/.test(k)) continue;
    const { menge, basis } = inBasis(parseZahl(z.qty2) ?? parseZahl(z.qty), z.unit);
    if (menge != null) g += basis === 'TL' ? menge * 4 : basis === 'g' || basis === 'ml' ? menge : 0;
  }
  return g;
}

/**
 * { mahlzeit, protein, totalMin }: Angaben des Rezepts, sonst erkannt (mahlzeit 'haupt' bzw. 'frueh' an Titel/Tags;
 * Kuchen, Desserts und Getränke → null = nicht planbar; Zeit = totalMin ?? prep + cook ?? 30).
 */
export function rezeptMeta(rezept) {
  const r = rezept && typeof rezept === 'object' ? rezept : {};
  const tags = Array.isArray(r.tags) ? r.tags.map((t) => String(t).toLowerCase()) : [];
  let mahlzeit = r.mahlzeit === 'haupt' || r.mahlzeit === 'frueh' ? r.mahlzeit : null;
  if (!mahlzeit) {
    // nur das Gericht selbst zählt, nicht die Beilage ('Pfannkuchen mit Ahornsirup')
    const titel = String(r.title ?? '').toLowerCase().split(/ (?:mit|und|an|auf|in|dazu) /)[0];
    const kein = KEIN_GERICHT_RE.test(titel) || tags.some((t) => KEIN_GERICHT_TAGS.has(t)) || zuckerGramm(r) >= 100;
    mahlzeit = kein ? null : FRUEH_RE.test([titel, ...tags].join(' ')) ? 'frueh' : 'haupt';
  }
  const eigene = Array.isArray(r.protein) ? r.protein.filter((id) => PROTEIN_IDS.includes(id)) : [];
  const zahl = (x) => (Number(x) > 0 ? Number(x) : null);
  const summe = (zahl(r.prepMin) ?? 0) + (zahl(r.cookMin) ?? 0);
  return { mahlzeit, protein: eigene.length ? [...new Set(eigene)] : erkenneProtein(r),
    totalMin: zahl(r.totalMin) ?? (summe > 0 ? summe : 30) };
}

// 'Pilze' meint auch Champignons; Allergen-Namen im Freitext ('gluten') zählen wie die Auswahl
const OHNE_SYNONYME = {
  pilz: ['pilz', 'champignon', 'pfifferling', 'shiitake', 'seitling', 'morchel', 'enoki'],
  scharf: ['chili', 'peperoni', 'jalapeño', 'jalapeno', 'cayenne', 'sambal', 'sriracha', 'tabasco', 'harissa'],
  zwiebel: ['zwiebel', 'schalotte'],
  meeresfrüchte: ['garnele', 'shrimp', 'krabbe', 'scampi', 'gamba', 'muschel', 'calamar', 'tintenfisch', 'oktopus'],
};
function ohneWoerter(wort) {
  const a = ALLERGENE.find((x) => x.id === wort || x.name.toLowerCase() === wort);
  return a ? [a.woerter, a.ausser] : [OHNE_SYNONYME[wort] ?? [wort], []];
}

function pruefe(rezept, p, meta) {
  for (const pr of meta.protein) {
    const ok = pr === 'vegan' ? p.protein.includes('vegan') || p.protein.includes('vegetarisch') : p.protein.includes(pr);
    if (!ok) return { ok: false, grund: `Nicht gewählt: ${PROTEINE.find((x) => x.id === pr)?.name ?? pr}` };
  }
  const keys = zutatenSchluessel(rezept);
  for (const id of p.allergene) {
    const a = ALLERGENE.find((x) => x.id === id);
    if (keys.some((k) => treffer(k, a.woerter, a.ausser))) return { ok: false, grund: `Enthält ${a.name}` };
  }
  for (const wort of p.ohne) {
    const [woerter, ausser] = ohneWoerter(wort);
    if (keys.some((k) => treffer(k, woerter, ausser))) return { ok: false, grund: `Enthält ${wort}` };
  }
  if (!kochzeitPasst(meta.totalMin, p.kochzeit, meta.mahlzeit)) {
    return { ok: false, grund: `Dauert ${zeitText(meta.totalMin)}` };
  }
  return { ok: true, grund: null };
}

/**
 * Passt das Rezept zum Profil? → { ok, grund }. Ein veganes Rezept passt auch zu 'vegetarisch'; keine Zutat darf ein
 * Wort aus `ohne` oder einer gewählten Allergen-Gruppe enthalten; die Zeit muss zur Kochzeit passen.
 */
export function passtZumProfil(rezept, profil) {
  return pruefe(rezept, normalisiereProfil(profil), rezeptMeta(rezept));
}

// ---------------------------------------------------------------- Kosten im Warenkorb

const POSTEN_CACHE = new WeakMap();

// Zutaten eines Rezepts, unskaliert: [[key, { Basis-Einheit: Menge (Obergrenze) }, vage]]
function rezeptPosten(r) {
  let liste = POSTEN_CACHE.get(r);
  if (liste) return liste;
  const nach = new Map();
  for (const z of Array.isArray(r.ingredients) ? r.ingredients : []) {
    if (!z || typeof z !== 'object' || !String(z.name ?? '').trim() || istUeberschrift(z)) continue;
    const key = postenSchluessel(z);
    if (!key) continue;
    if (!nach.has(key)) nach.set(key, [key, {}, false]);
    const e = nach.get(key);
    const { menge, basis } = inBasis(parseZahl(z.qty2) ?? parseZahl(z.qty), z.unit);
    if (z.vague || menge == null || basis == null) e[2] = true;
    else e[1][basis] = (e[1][basis] || 0) + menge;
  }
  liste = [...nach.values()];
  POSTEN_CACHE.set(r, liste);
  return liste;
}

// Sättigungsbeilage: Tags, sonst größere Mengen Nudeln/Reis/Kartoffeln
const BEILAGEN = [['pasta', muster(['nudel', 'spaghetti', 'penne', 'fusilli', 'farfalle', 'tagliatelle', 'lasagne',
  'makkaroni', 'rigatoni', 'tortellini', 'gnocchi', 'spätzle'])], ['reis', /reis(?!e)|risotto/], ['kartoffeln', /kartoffel/]];
function beilageVon(r, posten) {
  const tags = Array.isArray(r.tags) ? r.tags : [];
  const b = BEILAGEN.find(([id]) => tags.includes(id));
  if (b) return b[0];
  const t = BEILAGEN.find(([, re]) => posten.some(([k, m]) => re.test(k) && (m.g >= 150 || m['Stück'] >= 3)));
  return t ? t[0] : null;
}

// Rechen-Kontext: Läden, Preise, Vorrat; je Zutat (Index) Schlüssel, Basis-Einheiten und gemerkte Kosten
function rechenKontext(laeden, { eigenePreise = {}, vorrat = [], tabelle } = {}) {
  const v = new Set((Array.isArray(vorrat) ? vorrat : []).filter((k) => typeof k === 'string' && k.trim())
    .map((k) => k.trim().toLowerCase()));
  return { laeden, eigenePreise: eigenePreise || {}, vorrat: v, tabelle, index: new Map(), keys: [], basen: [],
    memo: [] };
}

function zutatIndex(ctx, key) {
  let i = ctx.index.get(key);
  if (i === undefined) {
    i = ctx.keys.length;
    ctx.index.set(key, i);
    ctx.keys.push(key);
    ctx.basen.push([]);
    ctx.memo.push(new Map());
  }
  return i;
}

const KEIN_BETRAG = Object.freeze({ betrag: 0, laden: null });

// Kosten der Zutat idx mit den Mengen alt + vz · plus (je Basis-Einheit), gemerkt → { betrag, laden, … }
function kostenVon(ctx, idx, alt, plus, vz, vage) {
  const basen = ctx.basen[idx];
  let sig = vage ? 1 : 0;
  let werte = null;
  if (basen.length === 1) { // häufigster Fall ohne Zwischen-Array
    const x = Math.max(0, (alt ? alt[0] : 0) + (plus ? vz * plus[0] : 0));
    if (x <= 1e-9 && !vage) return KEIN_BETRAG;
    sig += Math.round(x * 1000) * 2;
    werte = x;
  } else {
    werte = basen.map((_, b) => Math.max(0, (alt ? alt[b] : 0) + (plus ? vz * plus[b] : 0)));
    if (!vage && werte.every((x) => x <= 1e-9)) return KEIN_BETRAG;
    sig = `${werte.map((x) => Math.round(x * 1000)).join('|')}|${sig}`;
  }
  const memo = ctx.memo[idx];
  let k = memo.get(sig);
  if (k === undefined) {
    const teile = [];
    basen.forEach((unit, b) => {
      const x = typeof werte === 'number' ? werte : werte[b];
      if (x > 1e-9) teile.push({ qty: x, qty2: null, unit });
    });
    const key = ctx.keys[idx];
    k = kostenFuer(key, teile, ctx.laeden, { eigenePreise: ctx.eigenePreise, tabelle: ctx.tabelle, vorrat: ctx.vorrat,
      abteilung: abteilungVon(key, {}, teile.map((t) => t.unit)) });
    if (memo.size > 5000) memo.clear();
    memo.set(sig, k);
  }
  return k;
}

// Warenkorb: Mengen je Zutat über alle gewählten Gerichte, Kosten in ganzen Packungen.
// `stand` zählt Änderungen, `geaendert[idx]` merkt den Stand der letzten Änderung einer Zutat.
class Korb {
  constructor(ctx) {
    Object.assign(this, { ctx, mengen: [], vage: [], betrag: [], laden: [], geaendert: [], gesamt: 0, stand: 0 });
  }

  /** Kostenänderung, wenn das Gericht hinzukäme (vz = 1) bzw. wegfiele (vz = -1). */
  delta(info, vz = 1) {
    let d = 0;
    for (const [idx, plus, vage] of info.posten) {
      const v = (this.vage[idx] || 0) + (vage ? vz : 0);
      d += kostenVon(this.ctx, idx, this.mengen[idx], plus, vz, v > 0).betrag - (this.betrag[idx] || 0);
    }
    return d;
  }

  aendere(info, vz = 1) {
    this.stand += 1;
    for (const [idx, plus, vage] of info.posten) {
      const alt = this.mengen[idx];
      this.mengen[idx] = plus.map((x, b) => Math.max(0, (alt ? alt[b] : 0) + vz * x));
      this.vage[idx] = Math.max(0, (this.vage[idx] || 0) + (vage ? vz : 0));
      const k = kostenVon(this.ctx, idx, this.mengen[idx], null, 1, this.vage[idx] > 0);
      this.gesamt += k.betrag - (this.betrag[idx] || 0);
      this.betrag[idx] = k.betrag;
      this.laden[idx] = k.laden;
      this.geaendert[idx] = this.stand;
    }
  }
}

// ---------------------------------------------------------------- Planen

// Zufall mit Startwert (mulberry32 über einen FNV-Hash): fest für (seed, Platz, Rezept), in [-0.35, 0.35]
function mulberry32(a) {
  let t = (a + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function zufall(seed, platz, id) {
  let h = 2166136261;
  const text = `${seed}|${platz}|${id}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (mulberry32(h >>> 0) * 2 - 1) * 0.35;
}

const WIEDERHOLUNG = { frueh: 1.5, haupt: 6 };
const FRUEH_PAUSE = 2; // Tage, bevor dasselbe Frühstück wiederkommt
const cent = (x) => Math.round(x * 100) / 100;
const euroText = (x) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(x)} €`;

function alsListe(rezepte) {
  const liste = rezepte instanceof Map ? [...rezepte.values()] : Array.isArray(rezepte) ? rezepte : [];
  const nachId = new Map(); // gleiche id (z. B. gespeicherte Kopie eines Grundrezepts): die spätere gewinnt
  for (const r of liste) if (r && typeof r === 'object' && r.id != null && !r.deleted) nachId.set(r.id, r);
  return [...nachId.values()];
}

// Kandidaten je Art: Mengen auf `personen` skaliert, Posten als [Zutat-Index, Mengen je Basis-Einheit, vage]
function kandidaten(rezepte, p, ctx) {
  const nach = { frueh: [], haupt: [] };
  const roh = [];
  for (const r of alsListe(rezepte)) {
    if (!p.eigeneRezepte && r.herkunft !== 'grund' && r.herkunft !== 'ki') continue;
    const meta = rezeptMeta(r);
    if (!meta.mahlzeit || !pruefe(r, p, meta).ok) continue;
    const posten = rezeptPosten(r);
    if (posten.filter(([, m]) => Object.keys(m).length).length < 2) continue; // ohne Mengen nichts einzukaufen
    for (const [key, m] of posten) {
      const basen = ctx.basen[zutatIndex(ctx, key)];
      for (const b of Object.keys(m)) if (!basen.includes(b)) basen.push(b);
    }
    roh.push([r, meta, posten]);
  }
  for (const [r, meta, posten] of roh) {
    const faktor = p.personen / (Number(r.servings) > 0 ? Number(r.servings) : 1);
    nach[meta.mahlzeit].push({ id: r.id, titel: String(r.title || 'Rezept'), minuten: meta.totalMin, art: meta.mahlzeit,
      posten: posten.map(([key, m, vage]) => {
        const idx = ctx.index.get(key);
        return [idx, ctx.basen[idx].map((b) => (m[b] || 0) * faktor), vage];
      }),
      protein: meta.protein[0] === 'vegan' ? 'vegetarisch' : meta.protein[0], beilage: beilageVon(r, posten),
      favorit: r.favorite === true });
  }
  return nach;
}

function slotsVon(start, tage, mahlzeiten) {
  const slots = [];
  for (let tag = 0; tag < tage; tag++) {
    for (const m of MAHLZEITEN) {
      if (mahlzeiten.includes(m.id)) slots.push({ datum: plusTage(start, tag), slot: m.id, art: m.art, tag });
    }
  }
  return slots;
}

// „Keine schnellen vegetarischen Frühstücke“, „Keine passenden Hauptgerichte mit Fisch ohne Gluten“
function grundOhneKandidat(art, p) {
  const w = ['Keine'];
  if (p.kochzeit === 'schnell') w.push('schnellen');
  if (p.protein.every((x) => x === 'vegan')) w.push('veganen');
  else if (p.protein.every((x) => x === 'vegan' || x === 'vegetarisch')) w.push('vegetarischen');
  else if (w.length === 1) w.push('passenden');
  w.push(art === 'frueh' ? 'Frühstücke' : 'Hauptgerichte');
  if (!p.protein.some((x) => x === 'vegan' || x === 'vegetarisch')) {
    w.push('mit', p.protein.map((x) => PROTEINE.find((y) => y.id === x).name).join(', '));
  }
  const ohne = [...p.allergene.map((id) => ALLERGENE.find((a) => a.id === id).name), ...p.ohne];
  if (ohne.length) w.push('ohne', ohne.slice(0, 3).join(', '));
  return w.join(' ');
}

// Plan-Zustand während der Suche: Plätze, gewählte Kandidaten, Warenkorb
class Suche {
  constructor(slots, nach, ctx, seed) {
    Object.assign(this, { slots, nach, ctx, seed, gewaehlt: new Array(slots.length).fill(null), korb: new Korb(ctx),
      gemerkt: new Map() });
    // typische Kosten eines Gerichts je Art (Median allein gekauft) als Maßstab für die Kosten
    this.typisch = {};
    for (const art of ['frueh', 'haupt']) {
      const werte = nach[art].map((c) => this.korb.delta(c)).sort((x, y) => x - y);
      this.typisch[art] = Math.max(0.5, werte.length ? werte[Math.floor(werte.length / 2)] : 1);
    }
  }

  // Mehrkosten von c zum jetzigen Warenkorb; gemerkt, bis sich eine seiner Zutaten ändert
  kosten(c) {
    const m = this.gemerkt.get(c);
    if (m) {
      let gueltig = true;
      for (const [idx] of c.posten) if ((this.korb.geaendert[idx] ?? -1) > m.stand) { gueltig = false; break; }
      if (gueltig) return m.wert;
    }
    const wert = this.korb.delta(c);
    this.gemerkt.set(c, { wert, stand: this.korb.stand });
    return wert;
  }

  // vorheriges/nächstes Hauptgericht
  nachbar(i, schritt) {
    for (let j = i + schritt; j >= 0 && j < this.slots.length; j += schritt) {
      if (this.slots[j].art === 'haupt' && this.gewaehlt[j]) return this.gewaehlt[j];
    }
    return null;
  }

  // gleiche Hauptzutat / Beilage wie die Nachbarn
  strafe(c, i, beideSeiten = false) {
    let s = 0;
    for (const n of [this.nachbar(i, -1), beideSeiten ? this.nachbar(i, 1) : null]) {
      if (n && n.protein === c.protein) s += 1.2;
      if (n && c.beilage && n.beilage === c.beilage) s += 0.8;
    }
    return s;
  }

  // wie oft c schon woanders im Plan steht; Hauptgerichte nicht doppelt, Frühstück erst nach FRUEH_PAUSE Tagen
  anzahl(c, i) {
    let n = 0;
    for (let j = 0; j < this.gewaehlt.length; j++) if (j !== i && this.gewaehlt[j] === c) n += 1;
    return n;
  }
  erlaubt(c, i) {
    for (let j = 0; j < this.gewaehlt.length; j++) {
      if (j === i || this.gewaehlt[j] !== c) continue;
      if (c.art === 'haupt' || Math.abs(this.slots[j].tag - this.slots[i].tag) < FRUEH_PAUSE) return false;
    }
    return true;
  }

  // Abwechslung über die Woche: gleiche Hauptzutat in den 5 Hauptgerichten vor dem direkt davor (das zählt in strafe)
  haeufung(c, i) {
    let n = 0;
    let gesehen = 0;
    for (let j = i - 1; j >= 0 && gesehen < 6; j--) {
      const g = this.gewaehlt[j];
      if (this.slots[j].art !== 'haupt' || !g) continue;
      if (gesehen++ > 0 && g.protein === c.protein) n += 1;
    }
    return n;
  }

  bewerte(c, i) {
    let wert = -this.kosten(c) / this.typisch[c.art] - WIEDERHOLUNG[c.art] * this.anzahl(c, i);
    if (c.art === 'haupt') wert -= this.strafe(c, i) + 0.5 * this.haeufung(c, i);
    return wert + (c.favorit ? 0.6 : 0) + zufall(this.seed, i, c.id);
  }

  // bestes Rezept für Platz i aus `pool` (null, wenn keins da ist)
  waehle(i, pool) {
    let liste = pool.filter((c) => this.erlaubt(c, i));
    if (!liste.length) liste = pool.filter((c) => c !== this.nachbar(i, -1) && c !== this.gewaehlt[i - 1]);
    if (!liste.length) liste = pool;
    let best = null;
    let bestWert = -Infinity;
    for (const c of liste) {
      const w = this.bewerte(c, i);
      if (w > bestWert + 1e-12) [best, bestWert] = [c, w];
    }
    return best;
  }

  setze(i, c) {
    if (this.gewaehlt[i]) this.korb.aendere(this.gewaehlt[i], -1);
    this.gewaehlt[i] = c;
    if (c) this.korb.aendere(c);
  }

  // Günstiger tauschen, bis das Budget passt oder nichts mehr hilft (höchstens 60 Runden): zuerst der Platz mit
  // dem größten Kostenanteil; die Vielfalt darf dabei nicht deutlich leiden
  spare(budget) {
    for (let runde = 0; runde < 60 && this.korb.gesamt > budget + 0.005; runde++) {
      const reihe = this.gewaehlt.map((c, i) => ({ i, anteil: c ? -this.korb.delta(c, -1) : -Infinity }))
        .filter((x) => this.gewaehlt[x.i]).sort((x, y) => y.anteil - x.anteil || x.i - y.i);
      let getauscht = false;
      for (const { i } of reihe) {
        const alt = this.gewaehlt[i];
        const grenze = Math.max(this.strafe(alt, i, true), 2.0);
        const vorher = this.korb.gesamt;
        this.setze(i, null);
        let best = alt;
        let bestKosten = vorher - this.korb.gesamt - 0.01; // so viel spart das Weglassen
        for (const c of this.nach[alt.art]) {
          if (c === alt || !this.erlaubt(c, i) || (c.art === 'haupt' && this.strafe(c, i, true) > grenze)) continue;
          const k = this.kosten(c);
          if (k < bestKosten - 1e-9) [best, bestKosten] = [c, k];
        }
        this.setze(i, best);
        if (best !== alt) { getauscht = true; break; }
      }
      if (!getauscht) break;
    }
  }

  // Einträge mit Grenzkosten in Plan-Reihenfolge, Summen je Laden
  ergebnis(p, fremd = []) {
    const korb = new Korb(this.ctx);
    const eintraege = [];
    this.slots.forEach((s, i) => {
      const c = this.gewaehlt[i];
      if (!c) return;
      const kosten = korb.delta(c);
      korb.aendere(c);
      eintraege.push({ datum: s.datum, slot: s.slot, rezeptId: c.id, titel: c.titel, portionen: p.personen,
        minuten: c.minuten, kosten: cent(kosten) });
    });
    const proLaden = Object.fromEntries(p.laeden.map((id) => [id, 0]));
    korb.laden.forEach((l, idx) => { if (l && Object.hasOwn(proLaden, l)) proLaden[l] += korb.betrag[idx]; });
    let gesamt = korb.gesamt;
    for (const e of fremd) {
      gesamt += Number(e.kosten) || 0;
      eintraege.push(e);
    }
    const reihe = (e) => `${e.datum}|${SLOT_IDS.indexOf(e.slot)}`;
    eintraege.sort((x, y) => (reihe(x) < reihe(y) ? -1 : reihe(x) > reihe(y) ? 1 : 0));
    for (const id of Object.keys(proLaden)) proLaden[id] = cent(proLaden[id]);
    gesamt = cent(gesamt);
    return { eintraege, kosten: { gesamt, proLaden, geschaetzt: true }, budget: p.budget,
      imBudget: p.budget == null ? null : gesamt <= p.budget + 0.005,
      ueberBudget: p.budget == null ? 0 : cent(Math.max(0, gesamt - p.budget)) };
  }
}

/**
 * Plan erstellen → { start, ende, tage, personen, laeden, seed, eintraege: [{ datum, slot, rezeptId, titel, portionen,
 * minuten, kosten }], kosten: { gesamt, proLaden, geschaetzt }, budget, imBudget, ueberBudget, fehlend, hinweise,
 * profil, getauscht }. `vorrat`: Schlüssel, die schon da sind (kosten nichts). Gleicher seed → gleicher Plan.
 */
export function plane({ rezepte = [], profil = {}, eigenePreise = {}, vorrat = [], seed = 1, heute = heuteSchluessel(),
  tabelle } = {}) {
  const p = normalisiereProfil(profil);
  const s0 = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 1;
  const start = p.start ?? (istSchluessel(heute) ? heute : heuteSchluessel());
  const slots = slotsVon(start, p.tage, p.mahlzeiten);
  const ctx = rechenKontext(p.laeden, { eigenePreise, vorrat, tabelle });
  const nach = kandidaten(rezepte, p, ctx);
  const suche = new Suche(slots, nach, ctx, s0);
  const fehlend = [];
  slots.forEach((s, i) => {
    const c = suche.waehle(i, nach[s.art]);
    if (c) suche.setze(i, c);
    else fehlend.push({ datum: s.datum, slot: s.slot, grund: grundOhneKandidat(s.art, p) });
  });
  if (p.budget != null) suche.spare(p.budget);
  const ergebnis = suche.ergebnis(p);
  const hinweise = [];
  const hauptPlaetze = slots.filter((s) => s.art === 'haupt').length;
  if (nach.haupt.length && nach.haupt.length < hauptPlaetze) {
    hinweise.push(`Nur ${nach.haupt.length} passende Hauptgerichte für ${hauptPlaetze} Mahlzeiten – ` +
      'einige kommen doppelt vor.');
  }
  if (ergebnis.imBudget === false) {
    hinweise.push(`Mit diesen Vorlieben sind ≈ ${Math.ceil(ergebnis.kosten.gesamt)} € das Minimum ` +
      `(Budget: ${euroText(p.budget)}).`);
  }
  return { start, ende: plusTage(start, p.tage - 1), tage: p.tage, personen: p.personen, laeden: [...p.laeden], seed: s0,
    ...ergebnis, fehlend, hinweise, profil: p, getauscht: [] };
}

/**
 * Tauscht das Gericht von Eintrag `index` gegen das nächstbeste andere (nicht schon im Plan, passend zum Profil, noch
 * nicht weggetauscht) → neuer Plan mit neu berechneten Kosten; ohne Alternative der unveränderte Plan.
 * kontext: { rezepte, profil, eigenePreise, vorrat, tabelle } wie bei plane().
 */
export function tausche(plan, index, { rezepte = [], profil, eigenePreise = {}, vorrat = [], tabelle } = {}) {
  const alt = plan?.eintraege?.[index];
  if (!alt || !istSchluessel(plan.start)) return plan;
  const basis = { ...(plan.profil || {}), ...(profil || {}) };
  const p = normalisiereProfil({ ...basis, personen: plan.personen, laeden: plan.laeden, tage: plan.tage,
    start: plan.start });
  // Plätze wie im Plan (auch Mahlzeiten, die nur in Einträgen vorkommen)
  const mahlzeiten = SLOT_IDS.filter((id) => p.mahlzeiten.includes(id) || plan.eintraege.some((e) => e.slot === id));
  const slots = slotsVon(plan.start, p.tage, mahlzeiten);
  const ctx = rechenKontext(p.laeden, { eigenePreise, vorrat, tabelle });
  const nach = kandidaten(rezepte, p, ctx);
  const suche = new Suche(slots, nach, ctx, plan.seed ?? 1);
  const alle = new Map([...nach.frueh, ...nach.haupt].map((c) => [c.id, c]));
  const platz = (e) => slots.findIndex((s) => s.datum === e.datum && s.slot === e.slot);
  const i = platz(alt);
  if (i < 0) return plan;
  const fremd = []; // Einträge ohne passendes Rezept im Kontext: bleiben mit ihren Kosten stehen
  for (const e of plan.eintraege) {
    if (e === alt) continue;
    if (platz(e) >= 0 && alle.has(e.rezeptId)) suche.setze(platz(e), alle.get(e.rezeptId));
    else fremd.push(e);
  }
  const imPlan = new Set(plan.eintraege.map((e) => e.rezeptId));
  const pool = nach[slots[i].art].filter((c) => c.id !== alt.rezeptId &&
    (slots[i].art === 'frueh' ? suche.erlaubt(c, i) : !imPlan.has(c.id)));
  let weg = new Set([...(plan.getauscht || []), alt.rezeptId]);
  let frei = pool.filter((c) => !weg.has(c.id));
  if (!frei.length) [frei, weg] = [pool, new Set([alt.rezeptId])]; // alle schon einmal gezeigt → von vorn
  if (!frei.length) return plan;
  suche.setze(i, suche.waehle(i, frei));
  return { ...plan, ...suche.ergebnis(p, fremd), getauscht: [...weg].slice(-200) };
}

/**
 * Kosten von Plan-Einträgen ({ rezeptId, portionen } oder planEntries { recipeId, servings }) über alle Zutaten
 * zusammen → { gesamt, proLaden, zeilen: [{ key, name, teile, abteilung, betrag, laden, quelle, geschaetzt,
 * packungen }] }.
 */
export function kostenDesPlans(eintraege, rezepteMap, profil, { eigenePreise = {}, vorrat = [], tabelle } = {}) {
  const p = normalisiereProfil(profil);
  const map = new Map(alsListe(rezepteMap instanceof Map || Array.isArray(rezepteMap) ? rezepteMap
    : Object.values(rezepteMap || {})).map((r) => [r.id, r]));
  const ctx = rechenKontext(p.laeden, { eigenePreise, vorrat, tabelle });
  const nach = new Map(); // key → { name, mengen, vage }
  for (const e of eintraege || []) {
    const r = map.get(e?.rezeptId ?? e?.recipeId);
    if (!r) continue;
    const portionen = Number(e.portionen ?? e.servings) > 0 ? Number(e.portionen ?? e.servings) : p.personen;
    const faktor = portionen / (Number(r.servings) > 0 ? Number(r.servings) : 1);
    for (const z of Array.isArray(r.ingredients) ? r.ingredients : []) {
      if (!z || !String(z.name ?? '').trim() || istUeberschrift(z)) continue;
      const key = postenSchluessel(z);
      if (!key) continue;
      if (!nach.has(key)) nach.set(key, { name: String(z.name).trim(), mengen: {}, vage: false });
      const g = nach.get(key);
      const s = skaliere(z, faktor);
      const { menge, basis } = inBasis(parseZahl(s.qty2) ?? parseZahl(s.qty), z.unit);
      if (z.vague || menge == null || basis == null) g.vage = true;
      else g.mengen[basis] = (g.mengen[basis] || 0) + menge;
    }
  }
  const zeilen = [];
  const proLaden = Object.fromEntries(p.laeden.map((id) => [id, 0]));
  let gesamt = 0;
  for (const [key, g] of nach) {
    const teile = Object.entries(g.mengen).map(([unit, qty]) => ({ qty: Math.round(qty * 1e6) / 1e6, qty2: null, unit }));
    const abteilung = abteilungVon(key, {}, teile.map((t) => t.unit));
    const k = kostenFuer(key, teile, p.laeden, { eigenePreise: ctx.eigenePreise, abteilung, tabelle,
      vorrat: ctx.vorrat });
    zeilen.push({ key, name: g.name, teile, abteilung, ...k });
    gesamt += k.betrag;
    if (k.laden && Object.hasOwn(proLaden, k.laden)) proLaden[k.laden] += k.betrag;
  }
  for (const id of Object.keys(proLaden)) proLaden[id] = cent(proLaden[id]);
  return { gesamt: cent(gesamt), proLaden, zeilen };
}
