// Preis-Logik ohne DOM: geschätzte Kosten je Zutat und Laden, eigene Preise und Summen für die
// Einkaufsliste. Alle Tabellenpreise sind Schätzwerte (js/daten/preise-tabelle.js). Läuft auch in Node.

import { PREISE, LADEN_FAKTOR, KATEGORIE_SCHAETZUNG, PREIS_STAND } from './daten/preise-tabelle.js';
import { zutatSchluessel, inBasis, parseZahl } from './zutaten.js';
import { abteilungVon, postenSchluessel } from './einkaufsliste.js';

export { PREIS_STAND };

/** Die wählbaren Supermärkte. */
export const LAEDEN = Object.freeze([
  ['aldi', 'Aldi'], ['lidl', 'Lidl'], ['penny', 'Penny'], ['netto', 'Netto'], ['kaufland', 'Kaufland'],
  ['rewe', 'Rewe'], ['edeka', 'Edeka'],
].map(([id, name]) => Object.freeze({ id, name })));
const LADEN_IDS = new Set(LAEDEN.map((l) => l.id));

// Gewicht je Behälter-Einheit in g (bzw. ml), wenn der Eintrag nichts anderes sagt
const BEHAELTER_GEWICHT = { Dose: 400, Becher: 200, Glas: 350, Bund: 50, Zehe: 5, Scheibe: 25, Zweig: 2, Stiel: 2,
  Blatt: 1 };
const BEHAELTER_ML = { Tasse: 150 };
// Einheiten, die man nur ganz kauft (Schätzung über die Abteilung: angebrochene zählen voll)
const PACK_EINHEITEN = new Set(['Packung', 'Bund', 'Dose', 'Glas', 'Becher', 'Kopf', 'Knolle', 'Stange', 'Rolle', 'Schale',
  'Flasche', 'Tafel', 'Topf']);
// Form-Endungen, die dasselbe Produkt meinen ('paprikaschote' → 'paprika', 'knoblauchzehe' → 'knoblauch')
const FORM_RE = /^(.{3,}?)(schote|zehe|stange|knolle|filet|würfel)$/;

const rund = (x) => Math.round(x * 1e6) / 1e6;
const cent = (x) => Math.round(x * 100) / 100;
const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- Tabelle

function alsEintrag([schluessel, packPreis, packMenge, einheit, o = {}]) {
  return Object.freeze({
    schluessel: norm(schluessel), packPreis: Number(packPreis) || 0, packMenge: Number(packMenge) || 1,
    einheit: einheit || 'g', stueckGewicht: o.stueckGewicht ?? null, lose: Boolean(o.lose), dichte: o.dichte ?? null,
    vorrat: Boolean(o.vorrat), container: o.container ?? null, laeden: o.laeden ?? null,
  });
}

// Index: Schlüssel (auch ohne Komma und in Einzahl) → Eintrag; die erste Zeile gewinnt
function baueIndex(zeilen) {
  const eintraege = zeilen.filter((z) => Array.isArray(z) && z[0]).map(alsEintrag);
  const index = new Map();
  for (const e of eintraege) if (!index.has(e.schluessel)) index.set(e.schluessel, e);
  for (const e of eintraege) {
    for (const v of [e.schluessel.replace(/, /g, ' '), zutatSchluessel(e.schluessel)]) {
      if (v && !index.has(v)) index.set(v, e);
    }
  }
  return { index, treffer: new Map() };
}

const INDEXE = new WeakMap();
const TABELLEN = new WeakMap();
let standard = null;

// tabelle: nichts (Standard), Zeilen-Array oder { preise, ladenFaktor, kategorie } (für Tests)
function tabelleVon(tabelle) {
  if (tabelle == null) {
    standard ??= { ...indexFuer(PREISE), ladenFaktor: LADEN_FAKTOR, kategorie: KATEGORIE_SCHAETZUNG };
    return standard;
  }
  if (typeof tabelle !== 'object') return tabelleVon(null);
  let t = TABELLEN.get(tabelle);
  if (!t) {
    const q = Array.isArray(tabelle) ? { preise: tabelle } : tabelle;
    t = { ...indexFuer(Array.isArray(q.preise) ? q.preise : PREISE), ladenFaktor: q.ladenFaktor ?? LADEN_FAKTOR,
      kategorie: q.kategorie ?? KATEGORIE_SCHAETZUNG };
    TABELLEN.set(tabelle, t);
  }
  return t;
}

function indexFuer(zeilen) {
  let i = INDEXE.get(zeilen);
  if (!i) INDEXE.set(zeilen, (i = baueIndex(zeilen)));
  return i;
}

function suche(k, index) {
  const versuch = (x) => (x ? index.get(x) ?? index.get(x.replace(/, /g, ' ')) ?? index.get(zutatSchluessel(x)) : null);
  let e = versuch(k) ?? (k.startsWith('tk ') ? versuch(`tk-${k.slice(3)}`) : null);
  if (e) return e;
  // Produkt-Zusatz: 'tomate, dose' → 'tomate'; gemahlene/getrocknete Kräuter sind aber keine Frischware
  let basis = k;
  const ki = k.indexOf(', ');
  if (ki > 0) {
    basis = k.slice(0, ki);
    if (/gemahlen|getrocknet/.test(k.slice(ki)) && abteilungVon(basis) === 'obst-gemuese') return null;
    if ((e = versuch(basis))) return e;
  }
  // ohne Beschreibung vorne: 'rote paprikaschote' → 'paprikaschote'
  const woerter = basis.split(' ');
  for (let i = 1; i < woerter.length; i++) if ((e = versuch(woerter.slice(i).join(' ')))) return e;
  // Bindestrich: 'käse-tortellini' → 'tortellini'
  const teile = woerter.at(-1).split('-');
  for (let i = 1; i < teile.length; i++) if ((e = versuch(teile.slice(i).join('-')))) return e;
  const wort = teile.at(-1);
  const m = wort.match(FORM_RE);
  if (m && (e = versuch(m[1]) ?? versuch(m[1].replace(/n$/, '')))) return e;
  // Wortteil hinten (Kopf des Kompositums): 'vollkornbrot' → 'brot', 'basmatireis' → 'reis'
  for (let i = 3; i <= wort.length - 4; i++) if ((e = index.get(wort.slice(i)))) return e;
  return null;
}

function suchePreis(t, k) {
  if (t.treffer.has(k)) return t.treffer.get(k);
  const e = k ? suche(k, t.index) : null;
  if (t.treffer.size > 5000) t.treffer.clear();
  t.treffer.set(k, e);
  return e;
}

/**
 * Tabellen-Eintrag zu einem Schlüssel → { schluessel, packPreis, packMenge, einheit, stueckGewicht, lose, dichte,
 * vorrat, container } oder null. Reihenfolge: genau, ohne Beschreibung vorne, letztes Wort, Wortteil hinten.
 */
export function findePreis(schluessel, { tabelle } = {}) {
  return suchePreis(tabelleVon(tabelle), norm(schluessel));
}

// ---------------------------------------------------------------- Mengen umrechnen

function inGramm(menge, basis, e) {
  const dichte = e.dichte ?? 1;
  if (basis === 'g') return menge;
  if (basis === 'ml') return menge * dichte;
  if (basis === 'TL') return menge * 5 * dichte;
  if (basis === 'Stück') return e.stueckGewicht ? menge * e.stueckGewicht : null;
  if (BEHAELTER_ML[basis]) return menge * BEHAELTER_ML[basis] * dichte;
  return BEHAELTER_GEWICHT[basis] ? menge * BEHAELTER_GEWICHT[basis] : null;
}

function ausGramm(g, e) {
  if (e.einheit === 'g') return g;
  if (e.einheit === 'ml') return g / (e.dichte ?? 1);
  if (e.einheit === 'Stück') return e.stueckGewicht ? g / e.stueckGewicht : null;
  return BEHAELTER_GEWICHT[e.einheit] ? g / BEHAELTER_GEWICHT[e.einheit] : null;
}

function umrechnen(menge, basis, e) {
  if (basis === e.einheit) return menge;
  // 1 Dose = eine Packung des Eintrags ('Dose gehackte Tomaten' = 400 g)
  if (e.container && basis === e.container) return menge * (e.containerMenge ?? e.packMenge);
  const g = inGramm(menge, basis, e);
  return g == null ? null : ausGramm(g, e);
}

/**
 * Menge in der Einheit des Eintrags (Obergrenze bei Spannen) oder null, wenn nichts umrechenbar ist.
 * teile: [{ qty, qty2, unit }] wie aus zusammenfassen (Basis-Einheiten; kg/l/EL werden auch verstanden).
 */
export function mengeInEinheit(teile, eintrag) {
  if (!eintrag) return null;
  let summe = 0;
  let gefunden = false;
  for (const t of teile || []) {
    if (!t) continue;
    const q = parseZahl(t.qty2) ?? parseZahl(t.qty);
    if (q == null || q <= 0) continue;
    const { menge, basis } = inBasis(q, t.unit);
    if (menge == null || basis == null) continue;
    const wert = umrechnen(menge, basis, eintrag);
    if (wert == null || !Number.isFinite(wert)) continue;
    summe += wert;
    gefunden = true;
  }
  return gefunden ? rund(summe) : null;
}

// ---------------------------------------------------------------- Kosten

// Ganze Packungen (lose Ware anteilig); ohne umrechenbare Menge eine kleinste Packung
function packKosten(e, teile, preis) {
  const menge = mengeInEinheit(teile, e);
  if (menge == null) return { betrag: preis, packungen: 1 };
  const anteil = menge / e.packMenge;
  const packungen = e.lose ? rund(anteil) : Math.max(1, Math.ceil(anteil - 1e-9));
  return { betrag: packungen * preis, packungen };
}

// Eigener Preis { preis, menge, einheit } → Eintrag; Stückgewicht, Dichte und Dose aus der Tabelle
function eigenerEintrag(rec, eintrag) {
  if (!rec || typeof rec !== 'object') return null;
  const preis = parseZahl(rec.preis);
  const { menge, basis } = inBasis(parseZahl(rec.menge) ?? 1, rec.einheit || 'Stück');
  if (preis == null || preis < 0 || !(menge > 0) || basis == null) return null;
  const gleich = eintrag && eintrag.einheit === basis;
  return { packPreis: preis, packMenge: menge, einheit: basis, stueckGewicht: eintrag?.stueckGewicht ?? null,
    dichte: eintrag?.dichte ?? null, lose: Boolean(eintrag?.lose), container: gleich ? eintrag.container : null,
    containerMenge: gleich ? eintrag.packMenge : null };
}

// Schätzung über die Abteilung: € je kg/l bzw. Stück, sonst pauschal eine kleine Packung
function kategorieKosten(k, teile) {
  if (!k) return null;
  let betrag = 0;
  let gefunden = false;
  for (const t of teile || []) {
    const q = parseZahl(t?.qty2) ?? parseZahl(t?.qty);
    if (q == null || q <= 0) continue;
    const { menge, basis } = inBasis(q, t.unit);
    if (menge == null || basis == null) continue;
    let wert = null;
    if (basis === 'Stück') wert = k.proStueck ? menge * k.proStueck : k.proKg ? menge * 0.1 * k.proKg : null;
    else if (PACK_EINHEITEN.has(basis)) wert = k.pauschal ? Math.ceil(menge - 1e-9) * k.pauschal : null;
    else {
      const g = inGramm(menge, basis, { einheit: 'g' });
      wert = g != null && k.proKg ? (g / 1000) * k.proKg : null;
    }
    if (wert != null) { betrag += wert; gefunden = true; }
  }
  if (!gefunden) betrag = k.pauschal ?? k.proStueck ?? (k.proKg ? k.proKg / 4 : null);
  return betrag == null ? null : { betrag, packungen: null };
}

function ladenListe(laeden, t) {
  const liste = (Array.isArray(laeden) ? laeden : laeden ? [laeden] : [])
    .filter((id, i, a) => (LADEN_IDS.has(id) || Object.hasOwn(t.ladenFaktor, id)) && a.indexOf(id) === i);
  return liste.length ? liste : ['lidl'];
}

function imVorrat(vorrat, key) {
  if (!vorrat) return false;
  return vorrat instanceof Set ? vorrat.has(key) : Array.isArray(vorrat) && vorrat.includes(key);
}

const ergebnis = (betrag, laden, quelle, geschaetzt, packungen) =>
  ({ betrag: cent(betrag), laden, quelle, geschaetzt, packungen });

function kostenIntern(key, teile, ids, t, eigen, abteilung, vorrat) {
  if (vorrat) return ergebnis(0, null, 'vorrat', false, 0);
  const eintrag = key ? suchePreis(t, key) : null;
  const kategorie = eintrag ? null : kategorieKosten(abteilung ? t.kategorie[abteilung] : null, teile);
  let best = null;
  for (const laden of ids) {
    let k = null;
    const pseudo = eigen && typeof eigen === 'object'
      ? eigenerEintrag(eigen[laden], eintrag) ?? eigenerEintrag(eigen.alle, eintrag) : null;
    if (pseudo) k = { ...packKosten(pseudo, teile, pseudo.packPreis), quelle: 'eigen', geschaetzt: false };
    else if (eintrag && !eintrag.vorrat) {
      const bekannt = eintrag.laeden ? parseZahl(eintrag.laeden[laden]) : null;
      const preis = bekannt ?? eintrag.packPreis * (t.ladenFaktor[laden] ?? 1);
      k = { ...packKosten(eintrag, teile, preis), quelle: 'tabelle', geschaetzt: true };
    } else if (kategorie) {
      k = { betrag: kategorie.betrag * (t.ladenFaktor[laden] ?? 1), packungen: null, quelle: 'kategorie', geschaetzt: true };
    }
    if (k && (!best || k.betrag < best.betrag - 1e-9)) best = { ...k, laden };
  }
  if (best) return ergebnis(best.betrag, best.laden, best.quelle, best.geschaetzt, best.packungen);
  if (eintrag?.vorrat) return ergebnis(0, null, 'vorrat', false, 0);
  return ergebnis(0, null, 'unbekannt', true, null);
}

/**
 * Kosten einer Zutat im günstigsten der `laeden` (Gleichstand → der erste) →
 * { betrag, laden, quelle: 'eigen'|'tabelle'|'kategorie'|'vorrat'|'unbekannt', geschaetzt, packungen }.
 * Eigene Preise (eigenePreise[schluessel][ladenId|'alle'] = { preis, menge, einheit }) gehen vor; Tabellenpreise
 * in ganzen Packungen (lose Ware anteilig), ohne Menge eine kleinste Packung. `vorrat`: Schlüssel, die nichts kosten.
 */
export function kostenFuer(schluessel, teile, laeden, { eigenePreise = {}, abteilung = null, tabelle, vorrat = null } = {}) {
  const t = tabelleVon(tabelle);
  const key = norm(schluessel);
  return kostenIntern(key, teile, ladenListe(laeden, t), t, eigenePreise?.[key] ?? null, abteilung, imVorrat(vorrat, key));
}

/**
 * Kosten der Zeilen einer Einkaufsliste (aus einkaufsliste.berechneListe; auch die Liste selbst) →
 * { gesamt, proLaden: { id: € }, proZeile: Map(mergeKey → { betrag, laden, geschaetzt, quelle }) }.
 * Teilweise Abgehaktes zählt mit dem Rest; erledigte, versteckte und Vorrat-Zeilen zählen nicht.
 */
export function kostenFuerZeilen(zeilen, laeden, { eigenePreise = {}, tabelle, vorrat = null } = {}) {
  const t = tabelleVon(tabelle);
  const ids = ladenListe(laeden, t);
  const liste = Array.isArray(zeilen) ? zeilen
    : Array.isArray(zeilen?.abteilungen) ? zeilen.abteilungen.flatMap((a) => a.zeilen || []) : [];
  const proLaden = Object.fromEntries(ids.map((id) => [id, 0]));
  const proZeile = new Map();
  let gesamt = 0;
  for (const z of liste) {
    if (!z || z.erledigt || z.imVorrat || z.versteckt) continue;
    const teile = Array.isArray(z.rest) ? z.rest : Array.isArray(z.teile) ? z.teile : [];
    const key = norm(z.manuell ? postenSchluessel(z.manuell) || zutatSchluessel(z.name) : z.mergeKey ?? z.name);
    const eigen = eigenePreise?.[z.mergeKey] ?? eigenePreise?.[key] ?? null;
    // alles schon abgehakt (Rest leer, aber Mengen vorhanden) → nichts mehr zu kaufen
    const k = teile.length === 0 && z.teile?.length > 0 ? ergebnis(0, null, 'tabelle', true, 0)
      : kostenIntern(key, teile, ids, t, eigen, z.abteilung ?? null, imVorrat(vorrat, key));
    proZeile.set(z.mergeKey, { betrag: k.betrag, laden: k.laden, geschaetzt: k.geschaetzt, quelle: k.quelle });
    gesamt += k.betrag;
    if (k.laden && Object.hasOwn(proLaden, k.laden)) proLaden[k.laden] += k.betrag;
  }
  for (const id of ids) proLaden[id] = cent(proLaden[id]);
  return { gesamt: cent(gesamt), proLaden, proZeile };
}

// ---------------------------------------------------------------- Anzeige

const EURO = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GANZ = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** '12,34 €' (leer bei ungültigem Betrag). */
export function formatEuro(betrag) {
  const x = Number(betrag);
  return betrag == null || betrag === '' || !Number.isFinite(x) ? '' : `${EURO.format(x)} €`;
}

/** '≈ 12 €' (unter 10 € mit Cent: '≈ 3,20 €'). */
export function formatEuroGerundet(betrag) {
  const x = Number(betrag);
  if (betrag == null || betrag === '' || !Number.isFinite(x)) return '';
  return Math.abs(x) < 10 ? `≈ ${formatEuro(x)}` : `≈ ${GANZ.format(Math.round(x))} €`;
}
