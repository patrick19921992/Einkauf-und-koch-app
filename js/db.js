// Speicher-Schicht über IndexedDB. Alle Daten bleiben auf diesem Gerät.
//
// Jeder Datensatz der synchronisierbaren Speicher hat:
//   id (UUID), createdAt, updatedAt (Millisekunden), deleted (Lösch-Markierung).
// Gelöscht wird nur durch Markieren. So funktionieren Sicherungs-Import und eine
// spätere Familien-Synchronisierung nach derselben Regel: pro id gewinnt das neuere updatedAt.

import { alsSchluessel, istSchluessel } from './datum.js';

const DB_NAME = 'einkauf-und-koch-app';
const DB_VERSION = 1;
const KANAL_NAME = 'ekapp-daten';
const APP_KENNUNG = 'einkauf-und-koch-app';
const SCHEMA_VERSION = 1;
const TAG_MS = 86400000;

/** Alle Speicher (Object Stores). */
export const STORES = ['recipes', 'planEntries', 'shoppingItems', 'trips', 'aliases', 'settings', 'timers'];

/** Speicher, die in die Sicherung kommen und später synchronisiert werden können. */
export const SYNC_STORES = ['recipes', 'planEntries', 'shoppingItems', 'trips', 'aliases'];

/** Speicher, deren Einträge hart gelöscht werden (nur auf diesem Gerät). */
const HART_LOESCHEN = new Set(['timers', 'settings']);

const HAUSHALT_STANDARD = {
  wochenstart: 1,                 // 1 = Montag, 0 = Sonntag, 6 = Samstag
  standardPortionen: 4,
  mahlzeiten: ['abend'],          // Auswahl aus 'frueh', 'mittag', 'abend', 'snack'
  abteilungsReihenfolge: null,    // null = Standard-Reihenfolge aus einkaufsliste.js
  vorrat: ['salz', 'pfeffer', 'wasser'],
  planerProfil: null,             // Vorlieben aus „Automatisch planen“ (siehe planer.normalisiereProfil)
  eigenePreise: {},               // mergeKey → { ladenId | 'alle': { preis, menge, einheit, stand } }
};

const GERAET_STANDARD = {
  geraetId: null,
  proxyUrl: '',
  ttsStimme: '',
  ttsTempo: 1,
  autoVorlesen: false,
  letzteSicherung: null,          // Millisekunden oder null
};

/** Standardwerte aller Einstellungen (Haushalt + Gerät), auch innen unveränderlich. */
export const STANDARD_EINSTELLUNGEN = Object.freeze(Object.fromEntries(Object.entries({ ...HAUSHALT_STANDARD, ...GERAET_STANDARD })
  .map(([k, v]) => [k, v && typeof v === 'object' ? Object.freeze(Array.isArray(v) ? [...v] : { ...v }) : v])));

const HAUSHALT_SCHLUESSEL = Object.keys(HAUSHALT_STANDARD);
const GERAET_SCHLUESSEL = Object.keys(GERAET_STANDARD);

let dbVersprechen = null;
const beobachter = new Set();
let kanal = null;
const TAB_ID = Math.random().toString(36).slice(2);

// ---------------------------------------------------------------- Hilfen

/** Neue eindeutige ID (UUID v4). */
export function neueId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function anfrage(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function pruefeStore(store) {
  if (!STORES.includes(store)) throw new Error(`Unbekannter Speicher: ${store}`);
}

function oeffne() {
  if (dbVersprechen) return dbVersprechen;
  dbVersprechen = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Dieser Browser kann keine Daten speichern (IndexedDB fehlt).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const anlegen = (name, indizes = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const os = db.createObjectStore(name, { keyPath: 'id' });
        for (const feld of indizes) os.createIndex(feld, feld);
      };
      anlegen('recipes', ['updatedAt']);
      anlegen('planEntries', ['date', 'recipeId']);
      anlegen('shoppingItems', ['kind', 'tripId']);
      anlegen('trips', ['closedAt']);
      anlegen('aliases');
      anlegen('settings');
      anlegen('timers');
    };
    // Blockiert ein alter Tab das Öffnen: kurz warten (er schließt meist von selbst), dann abbrechen
    let blockiert = null;
    req.onblocked = () => {
      blockiert ??= setTimeout(() => {
        blockiert = 'aus';
        reject(new Error('Die App ist noch in einem anderen Tab geöffnet. Bitte dort schließen und neu laden.'));
      }, 5000);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blockiert === 'aus') return db.close(); // zu spät geöffnet: Verbindung nicht liegen lassen
      clearTimeout(blockiert);
      db.onversionchange = () => {
        db.close();
        dbVersprechen = null;
      };
      db.onclose = () => {
        dbVersprechen = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbVersprechen.catch(() => {
    dbVersprechen = null;
  });
  return dbVersprechen;
}

async function transaktion(stores, modus, arbeit, nochmal = true) {
  const db = await oeffne();
  let tx;
  try {
    tx = db.transaction(stores, modus);
  } catch (e) {
    // Verbindung wurde vom Browser geschlossen (z. B. lange im Hintergrund): einmal neu öffnen
    if (nochmal && e?.name === 'InvalidStateError') {
      dbVersprechen = null;
      return transaktion(stores, modus, arbeit, false);
    }
    throw e;
  }
  return new Promise((resolve, reject) => {
    let ergebnis;
    tx.oncomplete = () => resolve(ergebnis);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen.'));
    const abbrechen = (e) => {
      try {
        tx.abort();
      } catch {
        // Transaktion war schon beendet
      }
      reject(e);
    };
    let r;
    try {
      // synchron aufrufen, damit alle Anfragen in der aktiven Transaktion landen
      r = arbeit(tx);
    } catch (e) {
      abbrechen(e);
      return;
    }
    Promise.resolve(r).then((wert) => {
      ergebnis = wert;
    }, abbrechen);
  });
}

function meldeAenderung(store, ids = []) {
  const nachricht = { store, ids, quelle: TAB_ID };
  for (const cb of beobachter) {
    try {
      cb(nachricht);
    } catch (e) {
      console.error(e);
    }
  }
  try {
    if (!kanal && globalThis.BroadcastChannel) kanal = new BroadcastChannel(KANAL_NAME);
    kanal?.postMessage(nachricht);
  } catch {
    // ohne BroadcastChannel nur dieser Tab
  }
}

/**
 * Meldet jede Änderung an Daten (auch aus anderen Tabs).
 * callback({ store, ids }) – gibt eine Funktion zum Abmelden zurück.
 */
export function beobachte(callback) {
  beobachter.add(callback);
  let empfang = null;
  if (globalThis.BroadcastChannel) {
    empfang = new BroadcastChannel(KANAL_NAME);
    empfang.onmessage = (ev) => {
      // eigene Nachrichten kommen schon direkt an
      if (ev.data?.quelle !== TAB_ID) callback(ev.data);
    };
  }
  return () => {
    beobachter.delete(callback);
    empfang?.close();
  };
}

function vorbereiten(store, datensatz, jetzt) {
  const d = { ...datensatz };
  if (!d.id) d.id = neueId();
  if (!d.createdAt) d.createdAt = jetzt;
  d.updatedAt = jetzt;
  if (!HART_LOESCHEN.has(store)) d.deleted = d.deleted === true;
  return d;
}

// ---------------------------------------------------------------- Lesen

/** Einen Datensatz holen. Gelöschte nur mit { mitGeloeschten: true }. */
export async function hole(store, id, { mitGeloeschten = false } = {}) {
  pruefeStore(store);
  if (id == null || id === '') return undefined;
  const d = await transaktion([store], 'readonly', (tx) => anfrage(tx.objectStore(store).get(id)));
  if (!d || (d.deleted && !mitGeloeschten)) return undefined;
  return d;
}

/** Alle Datensätze eines Speichers. Gelöschte nur mit { mitGeloeschten: true }. */
export async function alle(store, { mitGeloeschten = false } = {}) {
  pruefeStore(store);
  const liste = await transaktion([store], 'readonly', (tx) => anfrage(tx.objectStore(store).getAll()));
  return mitGeloeschten ? liste : liste.filter((d) => !d.deleted);
}

/** Anzahl nicht gelöschter Datensätze. */
export async function anzahl(store) {
  return (await alle(store)).length;
}

// ---------------------------------------------------------------- Schreiben

/** Speichert (neu oder überschreibend). Setzt id, createdAt, updatedAt, deleted. */
export async function speichere(store, datensatz) {
  pruefeStore(store);
  const d = vorbereiten(store, datensatz, Date.now());
  await transaktion([store], 'readwrite', (tx) => anfrage(tx.objectStore(store).put(d)));
  meldeAenderung(store, [d.id]);
  return d;
}

/** Speichert mehrere Datensätze in einer Transaktion. */
export async function speichereViele(store, datensaetze) {
  pruefeStore(store);
  const jetzt = Date.now();
  const liste = datensaetze.map((d) => vorbereiten(store, d, jetzt));
  if (!liste.length) return [];
  await transaktion([store], 'readwrite', async (tx) => {
    const os = tx.objectStore(store);
    await Promise.all(liste.map((d) => anfrage(os.put(d))));
  });
  meldeAenderung(store, liste.map((d) => d.id));
  return liste;
}

/** Löscht per Markierung (deleted = true). timers/settings werden hart gelöscht. */
export async function loesche(store, id) {
  pruefeStore(store);
  if (HART_LOESCHEN.has(store)) return entferne(store, id);
  const d = await hole(store, id, { mitGeloeschten: true });
  if (!d) return;
  await speichere(store, { ...d, deleted: true });
}

/** Hebt eine Lösch-Markierung wieder auf (für „Rückgängig“). */
export async function wiederherstellen(store, id) {
  const d = await hole(store, id, { mitGeloeschten: true });
  if (!d) return undefined;
  return speichere(store, { ...d, deleted: false });
}

/** Entfernt einen Datensatz endgültig. */
export async function entferne(store, id) {
  pruefeStore(store);
  await transaktion([store], 'readwrite', (tx) => anfrage(tx.objectStore(store).delete(id)));
  meldeAenderung(store, [id]);
}

/** Entfernt Lösch-Markierungen, die älter als `tage` sind. Gibt die Anzahl zurück. */
export async function bereinige(tage = 90) {
  const grenze = Date.now() - tage * TAG_MS;
  let anzahlEntfernt = 0;
  for (const store of SYNC_STORES) {
    const alt = (await alle(store, { mitGeloeschten: true })).filter((d) => d.deleted && d.updatedAt < grenze);
    if (!alt.length) continue;
    await transaktion([store], 'readwrite', async (tx) => {
      const os = tx.objectStore(store);
      await Promise.all(alt.map((d) => anfrage(os.delete(d.id))));
    });
    anzahlEntfernt += alt.length;
  }
  return anzahlEntfernt;
}

// ---------------------------------------------------------------- Einstellungen

const MAHLZEITEN = ['frueh', 'mittag', 'abend', 'snack'];
const istTextListe = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

// Prüft einen gespeicherten Wert (z. B. aus einer fremden oder alten Sicherung); ungültig → Standard
const PRUEFUNG = {
  wochenstart: (v) => [0, 1, 6].includes(v),
  standardPortionen: (v) => Number.isFinite(v) && v >= 1 && v <= 99,
  mahlzeiten: (v) => istTextListe(v) && v.length > 0 && v.every((m) => MAHLZEITEN.includes(m)),
  abteilungsReihenfolge: (v) => v === null || istTextListe(v),
  vorrat: istTextListe,
  planerProfil: (v) => v === null || istObjekt(v),
  eigenePreise: istObjekt,
  geraetId: (v) => v === null || typeof v === 'string',
  proxyUrl: (v) => typeof v === 'string',
  ttsStimme: (v) => typeof v === 'string',
  ttsTempo: (v) => Number.isFinite(v) && v >= 0.5 && v <= 2,
  autoVorlesen: (v) => typeof v === 'boolean',
  letzteSicherung: (v) => v === null || Number.isFinite(v),
};

// Einstellungen werden nacheinander geschrieben, damit gleichzeitige Änderungen sich nicht überschreiben
let einstellungsKette = Promise.resolve();
function nacheinander(arbeit) {
  const r = einstellungsKette.then(arbeit);
  einstellungsKette = r.catch(() => {});
  return r;
}

// Planer-Profil: nur einfache Werte und kurze Listen (die genaue Prüfung macht planer.normalisiereProfil)
function bereinigeProfil(v) {
  if (v === null) return null;
  const p = {};
  for (const [k, w] of Object.entries(v)) {
    if (VERBOTEN.has(k) || k.length > 40) continue;
    if (w === null || typeof w === 'boolean' || Number.isFinite(w)) p[k] = w;
    else if (typeof w === 'string') p[k] = w.slice(0, 200);
    else if (Array.isArray(w)) p[k] = w.filter((x) => typeof x === 'string' || Number.isFinite(x)).slice(0, 50).map((x) => (typeof x === 'string' ? x.slice(0, 80) : x));
  }
  return p;
}

const MAX_EIGENE_PREISE = 2000;

// Eigene Preise: { mergeKey: { ladenId|'alle': { preis ≥ 0, menge > 0, einheit, stand|null } } }, Kaputtes fällt weg
function bereinigePreise(v) {
  const ergebnis = {};
  let anzahlSchluessel = 0;
  for (const [key, laeden] of Object.entries(v)) {
    if (anzahlSchluessel >= MAX_EIGENE_PREISE) break;
    if (!istId(key) || key.length > 200 || !istObjekt(laeden)) continue;
    const eintraege = {};
    for (const [laden, p] of Object.entries(laeden)) {
      if (!istId(laden) || laden.length > 40 || !istObjekt(p)) continue;
      const preis = zahlOderNull(p.preis);
      // ohne Menge/Einheit gilt der Preis für 1 Stück (wie in preise.js)
      const menge = zahlOderNull(p.menge) ?? 1;
      const einheit = alsText(p.einheit).trim() || 'Stück';
      if (preis == null || preis < 0 || preis > 10000 || !(menge > 0) || !einheit || einheit.length > 20) continue;
      eintraege[laden] = { preis, menge, einheit, stand: istTag(p.stand) ? p.stand : null };
    }
    if (Object.keys(eintraege).length) {
      ergebnis[key] = eintraege;
      anzahlSchluessel += 1;
    }
  }
  return ergebnis;
}

// Einstellungen mit verschachtelten Werten werden beim Lesen und Einlesen tief bereinigt (und kopiert)
const BEREINIGE_EINSTELLUNG = { planerProfil: bereinigeProfil, eigenePreise: bereinigePreise };

/** Gültiger Wert einer Einstellung oder undefined. Zahlen aus Formularfeldern kommen manchmal als Text. */
function gueltig(k, v) {
  if (typeof v === 'string' && typeof STANDARD_EINSTELLUNGEN[k] === 'number' && v.trim()) v = Number(v);
  if (v === undefined || !PRUEFUNG[k](v)) return undefined;
  if (Object.hasOwn(BEREINIGE_EINSTELLUNG, k)) return BEREINIGE_EINSTELLUNG[k](v);
  return Array.isArray(v) ? [...v] : v;
}

// Standardwert als eigene Kopie (Listen und Objekte darf der Aufrufer verändern)
const standardWert = (k) => {
  const v = STANDARD_EINSTELLUNGEN[k];
  return Array.isArray(v) ? [...v] : istObjekt(v) ? { ...v } : v;
};

function zusammenfuehren(haushalt, geraet) {
  const e = {};
  for (const k of HAUSHALT_SCHLUESSEL) e[k] = gueltig(k, haushalt?.[k]) ?? standardWert(k);
  for (const k of GERAET_SCHLUESSEL) e[k] = gueltig(k, geraet?.[k]) ?? standardWert(k);
  return e;
}

/** Alle Einstellungen zusammengeführt (Haushalt + Gerät, mit Standardwerten). */
export async function holeEinstellungen() {
  const [haushalt, geraet] = await Promise.all([hole('settings', 'haushalt'), hole('settings', 'geraet')]);
  const e = zusammenfuehren(haushalt, geraet);
  if (!e.geraetId) {
    // Geräte-Kennung einmalig anlegen (nacheinander, damit parallele Aufrufe dieselbe bekommen)
    e.geraetId = await nacheinander(async () => {
      const g = await hole('settings', 'geraet');
      if (g?.geraetId) return g.geraetId;
      const id = neueId();
      await speichere('settings', { ...(g || {}), id: 'geraet', geraetId: id });
      return id;
    });
  }
  return e;
}

/** Speichert einen Teil der Einstellungen. Unbekannte Schlüssel werden ignoriert. */
export async function speichereEinstellungen(teil) {
  await nacheinander(() => schreibeEinstellungen(teil));
  return holeEinstellungen();
}

async function schreibeEinstellungen(teil) {
  const [haushalt, geraet] = await Promise.all([hole('settings', 'haushalt'), hole('settings', 'geraet')]);
  const h = { ...(haushalt || {}), id: 'haushalt' };
  const g = { ...(geraet || {}), id: 'geraet' };
  // Zeitstempel pro Haushalts-Einstellung: beim Einlesen gewinnt so jede Einstellung für sich
  const zeiten = einstellungsZeiten(haushalt);
  const jetzt = Date.now();
  let hGeaendert = false;
  let gGeaendert = false;
  for (const [k, v] of Object.entries(teil || {})) {
    if (HAUSHALT_SCHLUESSEL.includes(k)) {
      h[k] = v;
      zeiten[k] = jetzt;
      hGeaendert = true;
    } else if (GERAET_SCHLUESSEL.includes(k) && k !== 'geraetId') {
      g[k] = v;
      gGeaendert = true;
    }
  }
  if (hGeaendert) await speichere('settings', { ...h, geaendert: zeiten });
  if (gGeaendert) await speichere('settings', g);
}

/**
 * Änderungszeit je Haushalts-Einstellung { vorrat: ms, … }. Ältere Datensätze ohne `geaendert`:
 * jede gespeicherte Einstellung zählt mit dem updatedAt des Datensatzes.
 */
function einstellungsZeiten(h) {
  const zeiten = {};
  if (!istObjekt(h)) return zeiten;
  const g = istObjekt(h.geaendert) ? h.geaendert : null;
  for (const k of HAUSHALT_SCHLUESSEL) {
    const t = g ? g[k] : h[k] !== undefined ? h.updatedAt : undefined;
    if (Number.isFinite(t) && t >= 0) zeiten[k] = t;
  }
  return zeiten;
}

const gleicherWert = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Führt Haushalts-Einstellungen aus einer Sicherung Einstellung für Einstellung zusammen:
 * pro Einstellung gewinnt der neuere Stand, ungültige Werte zählen nicht. Rein.
 * Ergebnis: { datensatz (neuer Haushalts-Datensatz oder null = nichts zu tun), uebernommen: [Schlüssel] }
 */
export function fuehreEinstellungenZusammen(vorhanden, eingehend, grenze = Date.now()) {
  const ergebnis = { datensatz: null, uebernommen: [] };
  if (!istObjekt(eingehend)) return ergebnis;
  const lokal = istObjekt(vorhanden) ? vorhanden : null;
  const zeitenLokal = einstellungsZeiten(lokal);
  const zeitenNeu = einstellungsZeiten(eingehend);
  const h = { ...(lokal || {}), id: 'haushalt' };
  const zeiten = { ...zeitenLokal };
  let neuer = false;
  for (const k of HAUSHALT_SCHLUESSEL) {
    const wert = gueltig(k, eingehend[k]);
    const zeit = Math.min(zeitenNeu[k] ?? 0, grenze);
    if (wert === undefined || !(zeit > (zeitenLokal[k] ?? 0))) continue;
    neuer = true;
    zeiten[k] = zeit;
    if (!gleicherWert(wert, gueltig(k, h[k]) ?? STANDARD_EINSTELLUNGEN[k])) ergebnis.uebernommen.push(k);
    h[k] = wert;
  }
  if (!neuer) return ergebnis;
  h.geaendert = zeiten;
  h.createdAt = lokal?.createdAt || zeitstempel(eingehend.createdAt, grenze) || grenze;
  h.updatedAt = Math.max(zeitstempel(lokal?.updatedAt, Infinity), ...Object.values(zeiten));
  ergebnis.datensatz = h;
  return ergebnis;
}

// ---------------------------------------------------------------- Sicherung

/** Dateiname für eine Sicherung, z. B. 'rezepte-backup-2026-10-15.json'. */
export function backupDateiname(datum = new Date()) {
  return `rezepte-backup-${alsSchluessel(datum)}.json`;
}

/** Erstellt das Sicherungs-Objekt (inklusive Lösch-Markierungen, ohne Gerätedaten). */
export async function exportiere() {
  const daten = {};
  for (const store of SYNC_STORES) daten[store] = await alle(store, { mitGeloeschten: true });
  const haushalt = await hole('settings', 'haushalt');
  daten.einstellungen = haushalt || null;
  return {
    app: APP_KENNUNG,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    daten,
  };
}

// ---------------------------------------------------------------- Sicherung prüfen (rein)

const VERBOTEN = new Set(['__proto__', 'constructor', 'prototype']);
const BASIS_FELDER = new Set(['id', 'createdAt', 'updatedAt', 'deleted']);

function istObjekt(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
const istId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 1000 && !VERBOTEN.has(v);
const istTag = (v) => typeof v === 'string' && istSchluessel(v);
const liste = (v) => (Array.isArray(v) ? v : []);

function alsText(v, ersatz = '') {
  if (typeof v === 'string') return v;
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : ersatz;
}

function textOderNull(v) {
  const t = alsText(v, null);
  return t && t.trim() ? t : null;
}

function zahlOderNull(v) {
  const n = typeof v === 'string' && v.trim() ? Number(v.trim().replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function positivOderNull(v) {
  const n = zahlOderNull(v);
  return n > 0 ? n : null;
}

/** Zeitstempel ≥ 0, höchstens `grenze` (ungültig → 0). */
function zeitstempel(v, grenze) {
  const n = zahlOderNull(v);
  return n > 0 ? Math.min(n, grenze) : 0;
}

// Unbekannte Felder (z. B. aus einer neueren Version) bleiben nur als einfache Werte erhalten
function zusatzFelder(d, bekannt) {
  const z = {};
  for (const [k, v] of Object.entries(d)) {
    if (k in bekannt || BASIS_FELDER.has(k) || VERBOTEN.has(k)) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || Number.isFinite(v)) z[k] = v;
  }
  return z;
}

function bereinigeZutat(z) {
  if (!istObjekt(z)) return null;
  const name = alsText(z.name).trim() ? alsText(z.name) : alsText(z.raw);
  if (!name.trim()) return null;
  const felder = {
    id: istId(z.id) ? z.id : neueId(), group: textOderNull(z.group), raw: alsText(z.raw).trim() ? alsText(z.raw) : name,
    qty: zahlOderNull(z.qty), qty2: zahlOderNull(z.qty2), unit: textOderNull(z.unit), size: textOderNull(z.size),
    name, note: textOderNull(z.note), vague: z.vague === true,
  };
  return { ...zusatzFelder(z, felder), ...felder };
}

function bereinigeSchritt(s) {
  const o = typeof s === 'string' ? { text: s } : s;
  if (!istObjekt(o) || !alsText(o.text).trim()) return null;
  const felder = { id: istId(o.id) ? o.id : neueId(), group: textOderNull(o.group), text: alsText(o.text) };
  return { ...zusatzFelder(o, felder), ...felder };
}

// Abgehakte Mengen { Einheit: Zahl }
function mengenOderNull(v) {
  if (!istObjekt(v)) return null;
  const m = {};
  for (const [k, n] of Object.entries(v)) if (!VERBOTEN.has(k) && Number.isFinite(n)) m[k] = n;
  return m;
}

function tagListe(v) {
  const roh = typeof v === 'string' ? v.split(',') : liste(v);
  return [...new Set(roh.map((t) => alsText(t).trim()).filter(Boolean))];
}

// Pro Speicher: gültige Felder oder null (Datensatz nicht zu retten)
const BEREINIGUNG = {
  recipes: (d) => ({
    title: alsText(d.title).trim() ? alsText(d.title) : 'Ohne Titel',
    sourceUrl: alsText(d.sourceUrl), sourceSite: alsText(d.sourceSite), imageUrl: alsText(d.imageUrl), notes: alsText(d.notes),
    servings: positivOderNull(d.servings), prepMin: positivOderNull(d.prepMin), cookMin: positivOderNull(d.cookMin),
    totalMin: positivOderNull(d.totalMin), tags: tagListe(d.tags), favorite: d.favorite === true,
    ingredients: liste(d.ingredients).map(bereinigeZutat).filter(Boolean),
    steps: (typeof d.steps === 'string' ? d.steps.split(/\r?\n/) : liste(d.steps)).map(bereinigeSchritt).filter(Boolean),
    // Hauptzutaten aus der Grundsammlung bzw. von der KI ('gefluegel', 'vegan', …), sonst erkennt der Planer sie selbst
    ...(istTextListe(d.protein) && d.protein.length ? { protein: [...new Set(d.protein)].filter((p) => /^[a-z]{2,20}$/.test(p)).slice(0, 6) } : {}),
  }),
  planEntries: (d) => (istTag(d.date) ? {
    date: d.date, slot: MAHLZEITEN.includes(d.slot) ? d.slot : 'abend', recipeId: istId(d.recipeId) ? d.recipeId : null,
    title: alsText(d.title), servings: positivOderNull(d.servings), note: alsText(d.note), cooked: d.cooked === true,
    tripId: istId(d.tripId) ? d.tripId : null,
  } : null),
  trips: (d) => {
    if (!istTag(d.from) || !istTag(d.to)) return null;
    const [from, to] = d.from <= d.to ? [d.from, d.to] : [d.to, d.from];
    return { from, to, closedAt: zahlOderNull(d.closedAt) };
  },
  shoppingItems: (d) => {
    if (d.kind === 'state') {
      return istId(d.tripId) && istId(d.mergeKey) ? {
        kind: 'state', tripId: d.tripId, mergeKey: d.mergeKey, abgehakt: mengenOderNull(d.abgehakt),
        erledigt: d.erledigt === true, versteckt: d.versteckt === true,
      } : null;
    }
    if (d.kind !== 'manual' || !alsText(d.name).trim()) return null;
    return {
      kind: 'manual', name: alsText(d.name), qty: zahlOderNull(d.qty), qty2: zahlOderNull(d.qty2), unit: textOderNull(d.unit),
      note: textOderNull(d.note), section: textOderNull(d.section), checked: d.checked === true,
    };
  },
  aliases: (d) => ({ kanonisch: textOderNull(d.kanonisch), section: textOderNull(d.section) }),
};

/**
 * Prüft und repariert einen Datensatz aus einer Sicherung, bevor er gespeichert wird. Rein.
 * Falsche Feld-Typen werden ersetzt (z. B. tags 'Pasta' → ['Pasta'], kaputte Zutaten fallen weg),
 * Zeitstempel nach `grenze` werden auf `grenze` gekürzt. Nicht zu retten (z. B. Runde ohne Datum) → null.
 */
export function bereinigeDatensatz(store, d, grenze = Date.now()) {
  const regel = Object.hasOwn(BEREINIGUNG, store) ? BEREINIGUNG[store] : null;
  if (!regel || !istObjekt(d) || !istId(d.id)) return null;
  const felder = regel(d);
  if (!felder) return null;
  const updatedAt = zeitstempel(d.updatedAt, grenze);
  return {
    id: d.id, ...zusatzFelder(d, felder), ...felder,
    createdAt: zeitstempel(d.createdAt, grenze) || updatedAt, updatedAt, deleted: d.deleted === true,
  };
}

/**
 * Entscheidet für einen eingehenden Datensatz, was das Einlesen bewirkt. Rein. Pro id gewinnt das neuere updatedAt:
 * 'neu' (auch: lokal gelöschter Eintrag kommt zurück) | 'aktualisiert' | 'geloescht' (neuere Lösch-Markierung
 * entfernt einen vorhandenen Eintrag) | 'markierung' (nur eine Lösch-Markierung, sichtbar ändert sich nichts)
 * | 'uebersprungen' (lokal gleich alt oder neuer).
 */
export function importEntscheidung(vorhanden, eingehend) {
  const loeschung = eingehend.deleted === true;
  if (!vorhanden) return loeschung ? 'markierung' : 'neu';
  if ((eingehend.updatedAt || 0) <= (vorhanden.updatedAt || 0)) return 'uebersprungen';
  if (vorhanden.deleted) return loeschung ? 'markierung' : 'neu';
  return loeschung ? 'geloescht' : 'aktualisiert';
}

// ---------------------------------------------------------------- Sicherung einlesen

const ZAEHLER_NAME = { neu: 'neu', aktualisiert: 'aktualisiert', geloescht: 'geloescht', markierung: 'markierungen', uebersprungen: 'uebersprungen' };
const neueZaehler = () => ({ neu: 0, aktualisiert: 0, geloescht: 0, uebersprungen: 0, markierungen: 0, ungueltig: 0 });

function leseSicherung(sicherung) {
  let s = sicherung;
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      throw new Error('Die Datei ist keine gültige Sicherung (kein JSON).');
    }
  }
  if (!istObjekt(s) || s.app !== APP_KENNUNG || !istObjekt(s.daten)) {
    throw new Error('Die Datei ist keine Sicherung dieser App.');
  }
  if ((s.schemaVersion || 0) > SCHEMA_VERSION) {
    throw new Error('Die Sicherung stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.');
  }
  return s;
}

// Berechnet (nur lesend), was das Einlesen ändern würde
async function planeImport(sicherung, { loeschen = false } = {}) {
  const s = leseSicherung(sicherung);
  const jetzt = Date.now();
  const exportiert = Date.parse(s.exportedAt);
  // Kein Eintrag ist neuer als die Sicherung selbst: Zeitstempel aus der Zukunft gewinnen sonst für immer
  const grenze = Number.isFinite(exportiert) ? Math.min(exportiert, jetzt) : jetzt;
  const ergebnis = {
    ...neueZaehler(), einstellungen: 0, rezepte: neueZaehler(), geloeschteRezepte: [],
    exportiertAm: Number.isFinite(exportiert) ? exportiert : null,
  };
  const schreiben = [];
  for (const store of SYNC_STORES) {
    const roh = liste(s.daten[store]);
    if (!roh.length) continue;
    // pro id zählt nur der neueste Stand aus der Datei
    const eingehend = new Map();
    for (const r of roh) {
      const d = bereinigeDatensatz(store, r, grenze);
      if (!d) {
        ergebnis.ungueltig += 1;
        if (store === 'recipes') ergebnis.rezepte.ungueltig += 1;
        continue;
      }
      const bisher = eingehend.get(d.id);
      if (!bisher || d.updatedAt > bisher.updatedAt) eingehend.set(d.id, d);
    }
    const vorhanden = new Map((await alle(store, { mitGeloeschten: true })).map((d) => [d.id, d]));
    const uebernehmen = [];
    for (const d of eingehend.values()) {
      const alt = vorhanden.get(d.id);
      let e = importEntscheidung(alt, d);
      if (e === 'geloescht' && !loeschen) e = 'uebersprungen';
      ergebnis[ZAEHLER_NAME[e]] += 1;
      if (store === 'recipes') {
        ergebnis.rezepte[ZAEHLER_NAME[e]] += 1;
        if (e === 'geloescht') ergebnis.geloeschteRezepte.push(alsText(alt.title).trim() || 'Ohne Titel');
      }
      if (e !== 'uebersprungen') uebernehmen.push(d);
    }
    if (uebernehmen.length) schreiben.push({ store, uebernehmen });
  }
  return { s, grenze, ergebnis, schreiben };
}

/**
 * Was würde das Einlesen ändern? Liest nur. Ergebnis wie bei importiere(); `geloescht` und
 * geloeschteRezepte (Titel) nennen, was die Lösch-Markierungen der Sicherung hier entfernen würden
 * – das passiert nur mit importiere(…, { loeschen: true }).
 */
export async function importVorschau(sicherung) {
  const { s, grenze, ergebnis } = await planeImport(sicherung, { loeschen: true });
  const haushalt = await hole('settings', 'haushalt');
  ergebnis.einstellungen = fuehreEinstellungenZusammen(haushalt, s.daten.einstellungen, grenze).uebernommen.length;
  return ergebnis;
}

/**
 * Liest eine Sicherung ein. Pro id gewinnt das neuere updatedAt. Vorhandenes wird dabei nur gelöscht,
 * wenn ausdrücklich { loeschen: true } (vorher mit importVorschau() zeigen, was verschwindet);
 * sonst zählen solche Lösch-Markierungen als übersprungen. Jeder Datensatz wird vorher geprüft und
 * repariert, Unbrauchbares übersprungen (ungueltig). Haushalts-Einstellungen: pro Einstellung gewinnt
 * der neuere Stand. `sicherung` darf ein Objekt oder JSON-Text sein.
 * Ergebnis: { neu, aktualisiert, geloescht, uebersprungen, markierungen, ungueltig,
 *             einstellungen (Anzahl übernommener Einstellungen), rezepte: { neu, … } (nur Rezepte),
 *             geloeschteRezepte: [Titel], exportiertAm: ms|null }
 */
export async function importiere(sicherung, optionen = {}) {
  const { s, grenze, ergebnis, schreiben } = await planeImport(sicherung, optionen);
  for (const { store, uebernehmen } of schreiben) {
    // Zeitstempel der Sicherung bleiben erhalten (kein vorbereiten()).
    await transaktion([store], 'readwrite', async (tx) => {
      const os = tx.objectStore(store);
      await Promise.all(uebernehmen.map((d) => anfrage(os.put(d))));
    });
    meldeAenderung(store, uebernehmen.map((d) => d.id));
  }
  if (istObjekt(s.daten.einstellungen)) {
    await nacheinander(async () => {
      const { datensatz, uebernommen } = fuehreEinstellungenZusammen(await hole('settings', 'haushalt'), s.daten.einstellungen, grenze);
      ergebnis.einstellungen = uebernommen.length;
      if (!datensatz) return;
      await transaktion(['settings'], 'readwrite', (tx) => anfrage(tx.objectStore('settings').put(datensatz)));
      meldeAenderung('settings', ['haushalt']);
    });
  }
  return ergebnis;
}

// ---------------------------------------------------------------- Speicherstatus

/** { persistent: boolean|null, belegt: Bytes|null, verfuegbar: Bytes|null } */
export async function speicherStatus() {
  const st = globalThis.navigator?.storage;
  let persistent = null;
  let belegt = null;
  let verfuegbar = null;
  try {
    if (st?.persisted) persistent = await st.persisted();
  } catch {
    persistent = null;
  }
  try {
    if (st?.estimate) {
      const s = await st.estimate();
      belegt = s.usage ?? null;
      verfuegbar = s.quota ?? null;
    }
  } catch {
    // Schätzung nicht verfügbar
  }
  return { persistent, belegt, verfuegbar };
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen. true/false/null (nicht unterstützt). */
export async function bitteUmDauerhaftenSpeicher() {
  const st = globalThis.navigator?.storage;
  if (!st?.persist) return null;
  try {
    if (st.persisted && (await st.persisted())) return true;
    return await st.persist();
  } catch {
    return false;
  }
}
