// Speicher-Schicht über IndexedDB. Alle Daten bleiben auf diesem Gerät.
//
// Jeder Datensatz der synchronisierbaren Speicher hat:
//   id (UUID), createdAt, updatedAt (Millisekunden), deleted (Lösch-Markierung).
// Gelöscht wird nur durch Markieren. So funktionieren Sicherungs-Import und eine
// spätere Familien-Synchronisierung nach derselben Regel: pro id gewinnt das neuere updatedAt.

import { alsSchluessel } from './datum.js';

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
};

const GERAET_STANDARD = {
  geraetId: null,
  proxyUrl: '',
  ttsStimme: '',
  ttsTempo: 1,
  autoVorlesen: false,
  letzteSicherung: null,          // Millisekunden oder null
};

/** Standardwerte aller Einstellungen (Haushalt + Gerät). */
export const STANDARD_EINSTELLUNGEN = Object.freeze({ ...HAUSHALT_STANDARD, ...GERAET_STANDARD });

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

/** Gültiger Wert einer Einstellung oder undefined. Zahlen aus Formularfeldern kommen manchmal als Text. */
function gueltig(k, v) {
  if (typeof v === 'string' && typeof STANDARD_EINSTELLUNGEN[k] === 'number' && v.trim()) v = Number(v);
  if (v === undefined || !PRUEFUNG[k](v)) return undefined;
  return Array.isArray(v) ? [...v] : v;
}

function zusammenfuehren(haushalt, geraet) {
  const e = { ...STANDARD_EINSTELLUNGEN };
  for (const k of HAUSHALT_SCHLUESSEL) e[k] = gueltig(k, haushalt?.[k]) ?? e[k];
  for (const k of GERAET_SCHLUESSEL) e[k] = gueltig(k, geraet?.[k]) ?? e[k];
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
  let hGeaendert = false;
  let gGeaendert = false;
  for (const [k, v] of Object.entries(teil || {})) {
    if (HAUSHALT_SCHLUESSEL.includes(k)) {
      h[k] = v;
      hGeaendert = true;
    } else if (GERAET_SCHLUESSEL.includes(k) && k !== 'geraetId') {
      g[k] = v;
      gGeaendert = true;
    }
  }
  if (hGeaendert) await speichere('settings', h);
  if (gGeaendert) await speichere('settings', g);
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

/**
 * Entscheidet für einen eingehenden Datensatz, ob er übernommen wird.
 * Reine Funktion: 'neu' | 'aktualisiert' | 'uebersprungen'.
 */
export function importEntscheidung(vorhanden, eingehend) {
  if (!vorhanden) return 'neu';
  return (eingehend.updatedAt || 0) > (vorhanden.updatedAt || 0) ? 'aktualisiert' : 'uebersprungen';
}

/**
 * Liest eine Sicherung ein. Pro id gewinnt das neuere updatedAt.
 * `sicherung` darf ein Objekt oder JSON-Text sein.
 * Ergebnis: { neu, aktualisiert, uebersprungen }
 */
export async function importiere(sicherung) {
  let s = sicherung;
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      throw new Error('Die Datei ist keine gültige Sicherung (kein JSON).');
    }
  }
  if (!s || s.app !== APP_KENNUNG || !s.daten) {
    throw new Error('Die Datei ist keine Sicherung dieser App.');
  }
  if ((s.schemaVersion || 0) > SCHEMA_VERSION) {
    throw new Error('Die Sicherung stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.');
  }
  const zaehler = { neu: 0, aktualisiert: 0, uebersprungen: 0 };
  for (const store of SYNC_STORES) {
    // nur Datensätze mit gültiger id (sonst bricht IndexedDB die ganze Übernahme ab)
    const eingehend = Array.isArray(s.daten[store])
      ? s.daten[store].filter((d) => d && typeof d === 'object' && !Array.isArray(d) && typeof d.id === 'string' && d.id)
      : [];
    if (!eingehend.length) continue;
    const vorhanden = new Map((await alle(store, { mitGeloeschten: true })).map((d) => [d.id, d]));
    const uebernehmen = [];
    for (const d of eingehend) {
      const entscheidung = importEntscheidung(vorhanden.get(d.id), d);
      zaehler[entscheidung] += 1;
      if (entscheidung !== 'uebersprungen') uebernehmen.push(d);
    }
    if (uebernehmen.length) {
      // Zeitstempel der Sicherung bleiben erhalten (kein vorbereiten()).
      await transaktion([store], 'readwrite', async (tx) => {
        const os = tx.objectStore(store);
        await Promise.all(uebernehmen.map((d) => anfrage(os.put({ ...d, deleted: d.deleted === true }))));
      });
      meldeAenderung(store, uebernehmen.map((d) => d.id));
    }
  }
  const e = s.daten.einstellungen;
  if (e && typeof e === 'object') {
    await nacheinander(async () => {
      const vorhanden = await hole('settings', 'haushalt');
      if (importEntscheidung(vorhanden, e) === 'uebersprungen') return;
      const h = { id: 'haushalt', createdAt: e.createdAt, updatedAt: e.updatedAt || Date.now() };
      // nur gültige Werte übernehmen, sonst bleibt der bisherige Stand
      for (const k of HAUSHALT_SCHLUESSEL) {
        const v = gueltig(k, e[k]) ?? vorhanden?.[k];
        if (v !== undefined) h[k] = v;
      }
      await transaktion(['settings'], 'readwrite', (tx) => anfrage(tx.objectStore('settings').put(h)));
      meldeAenderung('settings', ['haushalt']);
    });
  }
  return zaehler;
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
