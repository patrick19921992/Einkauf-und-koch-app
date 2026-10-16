// Start und Rahmen der App: Router, Bedien-Helfer für alle Ansichten,
// Empfang geteilter Inhalte (Android „Teilen“), Service Worker und Updates.
//
// Ansichten sind Module mit `export async function zeige(container, route)`.
// Sie dürfen eine Aufräum-Funktion zurückgeben, die beim Verlassen aufgerufen wird.

import * as db from './db.js';

/** Wird beim Veröffentlichen durch eine Kennung ersetzt. */
export const VERSION = '__VERSION__';

const STANDARD_ROUTE = '#/rezepte';
const GETEILT_SCHLUESSEL = 'ekapp-geteilt';

const ROUTEN = [
  { muster: /^\/rezepte$/, modul: './ansicht-rezepte.js', tab: 'rezepte' },
  { muster: /^\/rezept\/[^/]+$/, modul: './ansicht-rezepte.js', tab: 'rezepte', zurueck: true },
  { muster: /^\/(neu|import)$/, modul: './ansicht-rezept-bearbeiten.js', tab: 'rezepte', zurueck: true },
  { muster: /^\/rezept\/[^/]+\/bearbeiten$/, modul: './ansicht-rezept-bearbeiten.js', tab: 'rezepte', zurueck: true },
  { muster: /^\/woche(\/\d{4}-\d{2}-\d{2})?$/, modul: './ansicht-woche.js', tab: 'woche' },
  { muster: /^\/planer$/, modul: './ansicht-planer.js', tab: 'woche', zurueck: true },
  { muster: /^\/einkauf$/, modul: './ansicht-einkauf.js', tab: 'einkauf' },
  { muster: /^\/kochen\/[^/]+$/, modul: './ansicht-kochen.js', tab: null, vollbild: true },
  { muster: /^\/mehr$/, modul: './ansicht-einstellungen.js', tab: 'mehr' },
];

let aufraeumen = null;
let renderNummer = 0;
let innerhalbNavigiert = false;
let registrierung = null;
let wartenderSW = null;
let updateAngefordert = false;
let neuGeladen = false;
let neuladenAusstehend = false;

// ---------------------------------------------------------------- DOM-Helfer

const PROPERTIES = new Set(['value', 'checked', 'selected', 'indeterminate', 'defaultValue']);

function setzeAttribut(e, k, v) {
  if (v == null || v === false) return;
  if (k === 'class') {
    e.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
  } else if (k === 'text') {
    e.textContent = String(v);
  } else if (k === 'style') {
    // Nur als Objekt erlaubt (CSP verbietet style-Attribute als Text).
    if (typeof v === 'object') Object.assign(e.style, v);
  } else if (k === 'dataset') {
    Object.assign(e.dataset, v);
  } else if (k.startsWith('on') && typeof v === 'function') {
    e.addEventListener(k.slice(2).toLowerCase(), v);
  } else if (PROPERTIES.has(k)) {
    e[k] = v;
  } else if (v === true) {
    e.setAttribute(k, '');
  } else {
    e.setAttribute(k, String(v));
  }
}

function haengeAn(eltern, kinder) {
  for (const k of kinder) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) haengeAn(eltern, k);
    else if (k instanceof Node) eltern.append(k);
    else eltern.append(document.createTextNode(String(k)));
  }
}

/**
 * Erzeugt ein Element. Beispiel:
 *   el('button', { class: 'knopf primaer', onclick: fn }, 'Speichern')
 * attrs: class (Text oder Liste), text, style (Objekt), dataset, on…-Handler,
 *        value/checked/selected als Property, sonst als Attribut. Kein innerHTML.
 * Statt attrs darf direkt ein Kind übergeben werden.
 */
export function el(tag, attrs = null, ...kinder) {
  const e = document.createElement(tag);
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kinder.unshift(attrs);
    attrs = null;
  }
  if (attrs) for (const [k, v] of Object.entries(attrs)) setzeAttribut(e, k, v);
  haengeAn(e, kinder);
  return e;
}

/** Erzeugt ein SVG-Symbol aus einem Pfad (24×24). */
export function symbol(pfad, klasse = 'symbol') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', klasse);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', pfad);
  svg.append(p);
  return svg;
}

/** Häufig gebrauchte Symbole (SVG-Pfade). */
export const SYMBOLE = {
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  bearbeiten: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  loeschen: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  stern: 'M12 17.3 18.2 21l-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3l5.4 4.7-1.6 7z',
  sternLeer: 'm22 9.2-7.2-.6L12 2 9.2 8.7 2 9.2l5.5 4.7L5.8 21 12 17.3 18.2 21l-1.6-7.1zm-10 6.2-3.8 2.3 1-4.3-3.3-2.9 4.4-.4L12 6.1l1.7 4.1 4.4.4-3.3 2.9 1 4.3z',
  mehr: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  schliessen: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  zurueck: 'M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z',
  weiter: 'M8.6 18.6 10 20l8-8-8-8-1.4 1.4 6.6 6.6z',
  teilen: 'M18 16a3 3 0 0 0-2 .8L8.9 12.7a3 3 0 0 0 0-1.4l7-4.1A3 3 0 1 0 15 5a3 3 0 0 0 .1.7l-7 4.1a3 3 0 1 0 0 4.4l7.1 4.2a2.8 2.8 0 0 0-.1.6 3 3 0 1 0 3-3z',
  kochen: 'M8.1 13.3 10.9 10.5 3.9 3.5a4 4 0 0 0 0 5.6zm6.8-1.8c1.5.7 3.7.2 5.3-1.4 1.9-1.9 2.3-4.7.8-6.2s-4.2-1.1-6.2.8c-1.6 1.6-2.1 3.8-1.4 5.3L3.7 19.7l1.4 1.4 6.9-6.9 6.9 6.9 1.4-1.4L13.4 13z',
  kalender: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14z',
  korb: 'M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7.2 14.8h9.9c.8 0 1.4-.4 1.7-1l3.6-6.5-1.7-1-3.6 6.5H8.1L4.3 4H1v2h2l3.6 7.6-1.4 2.4c-.7 1.3.3 2.8 1.8 2.8h12v-2H7z',
  uhr: 'M15 1H9v2h6zm-4 13h2V8h-2zm8-6.6 1.4-1.4c-.4-.5-.9-1-1.4-1.4L17.6 6A9 9 0 1 0 21 13a9 9 0 0 0-2-5.6zM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
  lautsprecher: 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  haken: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  suche: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z',
  link: 'M3.9 12A3.1 3.1 0 0 1 7 8.9h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z',
  text: 'M14 17H4v2h10zm6-8H4v2h16zM4 15h16v-2H4zM4 5v2h16V5z',
  automatisch: 'm19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25z',
  tauschen: 'M7 11 3 15l4 4v-3h7v-2H7zm14-2-4-4v3h-7v2h7v3z',
  ansehen: 'M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
};

/** Leert ein Element. */
export function leere(knoten) {
  knoten.replaceChildren();
}

/** Escaped Text für den seltenen Fall, dass HTML-Text gebraucht wird. */
export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);
}

/** Fehlerkasten mit verständlichem Text und technischem Detail. */
export function fehlerAnzeige(text, fehler = null) {
  return el('div', { class: 'fehler', role: 'alert' },
    el('p', null, text),
    fehler ? el('p', { class: 'nebentext' }, String(fehler?.message || fehler)) : null);
}

// ---------------------------------------------------------------- Kopfzeile

/** Setzt die Überschrift oben und den Fenstertitel. */
export function setzeTitel(text) {
  document.getElementById('titel').textContent = text;
  document.title = text ? `${text} – Einkauf & Koch` : 'Einkauf & Koch';
}

/** Setzt Knöpfe rechts in der Kopfzeile (werden bei jedem Seitenwechsel geleert). */
export function kopfAktionen(...knoepfe) {
  const box = document.getElementById('kopf-aktionen');
  box.replaceChildren();
  haengeAn(box, knoepfe);
}

// ---------------------------------------------------------------- Meldungen

const toastEntfernen = new WeakMap();

/**
 * Kurze Meldung unten. Optional mit Aktion, z. B. { text: 'Rückgängig', onclick }.
 * Gibt eine Funktion zum vorzeitigen Schließen zurück.
 */
export function toast(text, { aktion = null, dauer = 3500 } = {}) {
  const box = document.getElementById('toasts');
  const t = el('div', { class: 'toast', role: 'status' }, el('span', null, text));
  let timer = null;
  const entfernen = () => {
    clearTimeout(timer);
    t.classList.add('weg');
    setTimeout(() => t.remove(), 250);
  };
  if (aktion) {
    t.append(el('button', {
      type: 'button',
      class: 'toast-aktion',
      onclick: () => {
        entfernen();
        aktion.onclick?.();
      },
    }, aktion.text));
  }
  toastEntfernen.set(t, entfernen);
  box.append(t);
  // höchstens drei Meldungen gleichzeitig, die älteste geht zuerst
  const offen = [...box.querySelectorAll('.toast:not(.weg)')];
  for (const alt of offen.slice(0, -3)) toastEntfernen.get(alt)?.();
  timer = setTimeout(entfernen, aktion ? Math.max(dauer, 6000) : dauer);
  return entfernen;
}

// ---------------------------------------------------------------- Dialoge

let dialogAufloesen = null;
let dialogImVerlauf = false;
let verlaufWartet = null;
let verlaufWartetAufloesen = null;

window.addEventListener('popstate', () => {
  if (verlaufWartetAufloesen) {
    const r = verlaufWartetAufloesen;
    verlaufWartetAufloesen = null;
    verlaufWartet = null;
    r();
    return;
  }
  if (dialogImVerlauf) {
    // Zurück-Geste bei offenem Dialog: nur den Dialog schließen
    dialogImVerlauf = false;
    schliesseDialog(null, true);
  }
});

function entferneDialogAusVerlauf() {
  if (!dialogImVerlauf) return;
  dialogImVerlauf = false;
  verlaufWartet = new Promise((r) => {
    verlaufWartetAufloesen = r;
  });
  history.back();
  // Sicherheitsnetz, falls kein popstate kommt
  setTimeout(() => {
    if (verlaufWartetAufloesen) {
      const r = verlaufWartetAufloesen;
      verlaufWartetAufloesen = null;
      verlaufWartet = null;
      r();
    }
  }, 600);
}

function schliesseDialog(wert, ausVerlauf = false) {
  const d = document.getElementById('dialog');
  if (d.open) d.close();
  d.replaceChildren();
  const r = dialogAufloesen;
  dialogAufloesen = null;
  if (!ausVerlauf) entferneDialogAusVerlauf();
  r?.(wert);
}

/**
 * Zeigt einen modalen Dialog. Ergebnis: der `wert` des gedrückten Knopfs, sonst null.
 * knoepfe: [{ text, wert, art: 'primaer' | 'gefahr' | 'flach' }]
 *   Ist `wert` eine Funktion, wird ihr Ergebnis zurückgegeben. Gibt sie undefined zurück,
 *   bleibt der Dialog offen (z. B. bei ungültiger Eingabe).
 * inhalt: Text, Knoten oder Liste von Knoten.
 * fokus: false verhindert, dass das erste Eingabefeld (und damit die Tastatur) aktiv wird.
 */
export function dialog({ titel = '', inhalt = null, knoepfe = [{ text: 'OK', wert: true, art: 'primaer' }], schliessbar = true, fokus = true } = {}) {
  if (dialogAufloesen) schliesseDialog(null);
  const d = document.getElementById('dialog');
  return new Promise((resolve) => {
    dialogAufloesen = resolve;
    const knopfLeiste = el('div', { class: 'dlg-knoepfe' },
      knoepfe.map((k) => el('button', {
        type: 'button',
        class: ['knopf', k.art || 'flach'],
        onclick: () => {
          const w = typeof k.wert === 'function' ? k.wert() : k.wert;
          if (w === undefined) return;
          schliesseDialog(w);
        },
      }, k.text)));
    const inhaltBox = el('div', { class: 'dlg-inhalt' }, inhalt);
    // Name für Bildschirmleser: der Titel des Dialogs
    if (titel) d.setAttribute('aria-labelledby', 'dlg-titel');
    else d.removeAttribute('aria-labelledby');
    d.replaceChildren(
      titel ? el('h2', { class: 'dlg-titel', id: 'dlg-titel' }, titel) : null,
      inhaltBox,
      knoepfe.length ? knopfLeiste : null,
    );
    d.oncancel = (ev) => {
      ev.preventDefault();
      if (schliessbar) schliesseDialog(null);
    };
    d.onclick = (ev) => {
      // Klick auf den abgedunkelten Hintergrund
      if (ev.target === d && schliessbar) schliesseDialog(null);
    };
    d.onclose = () => {
      // Vom Browser erzwungenes Schließen (z. B. zweimal Zurück trotz schliessbar: false)
      if (dialogAufloesen === resolve && !d.open) schliesseDialog(null);
    };
    // showModal() fokussiert selbst das erste Feld (Tastatur geht auf). Bei fokus: false den Inhalt
    // dabei kurz sperren und stattdessen den Dialog selbst fokussieren.
    if (fokus) d.removeAttribute('tabindex');
    else d.tabIndex = -1;
    inhaltBox.inert = !fokus;
    d.showModal();
    if (!fokus) {
      inhaltBox.inert = false;
      d.focus({ preventScroll: true });
    }
    // Eigener Verlaufseintrag, damit die Zurück-Geste nur den Dialog schließt.
    // Läuft noch das Zurückspulen eines vorherigen Dialogs, erst danach eintragen.
    const eintragen = () => {
      if (dialogAufloesen !== resolve) return;
      history.pushState({ ekDialog: true }, '');
      dialogImVerlauf = true;
    };
    if (verlaufWartet) verlaufWartet.then(eintragen);
    else eintragen();
    const erstesFeld = fokus ? d.querySelector('input, textarea, select') : null;
    if (erstesFeld) setTimeout(() => erstesFeld.focus(), 50);
  });
}

/** Ja/Nein-Frage. Ergebnis: true oder false. */
export async function bestaetige(text, { titel = '', ja = 'OK', nein = 'Abbrechen', gefahr = false } = {}) {
  const w = await dialog({
    titel,
    inhalt: el('p', null, text),
    knoepfe: [
      { text: nein, wert: false, art: 'flach' },
      { text: ja, wert: true, art: gefahr ? 'gefahr' : 'primaer' },
    ],
  });
  return w === true;
}

/** Fragt einen Text ab. Ergebnis: der Text (getrimmt) oder null. */
export async function eingabe(titel, { wert = '', platzhalter = '', typ = 'text', mehrzeilig = false, beschriftung = '', pflicht = false, ok = 'OK' } = {}) {
  const feld = mehrzeilig
    ? el('textarea', { rows: 6, placeholder: platzhalter, value: wert })
    : el('input', { type: typ, placeholder: platzhalter, value: wert, enterkeyhint: 'done' });
  const lesen = () => {
    const v = feld.value.trim();
    if (pflicht && !v) {
      feld.focus();
      return undefined;
    }
    return v;
  };
  if (!mehrzeilig) {
    feld.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const v = lesen();
        if (v !== undefined) schliesseDialog(v);
      }
    });
  }
  const w = await dialog({
    titel,
    inhalt: el('label', { class: 'feld' }, beschriftung ? el('span', null, beschriftung) : null, feld),
    knoepfe: [
      { text: 'Abbrechen', wert: null, art: 'flach' },
      { text: ok, wert: lesen, art: 'primaer' },
    ],
  });
  return w;
}

/**
 * Auswahl aus einer Liste großer Knöpfe. optionen: [{ text, wert, beschreibung? }]
 * Ergebnis: wert oder null.
 */
export function auswahl(titel, optionen) {
  const liste = el('div', { class: 'auswahl-liste' },
    optionen.map((o) => el('button', {
      type: 'button',
      class: 'auswahl-option',
      onclick: () => schliesseDialog(o.wert),
    },
    el('span', { class: 'fett' }, o.text),
    o.beschreibung ? el('span', { class: 'nebentext' }, o.beschreibung) : null)));
  return dialog({ titel, inhalt: liste, knoepfe: [{ text: 'Abbrechen', wert: null, art: 'flach' }] });
}

// ---------------------------------------------------------------- Navigation

function leseRoute() {
  const hash = location.hash || STANDARD_ROUTE;
  const ohneRaute = hash.replace(/^#/, '');
  const fragezeichen = ohneRaute.indexOf('?');
  const pfad = fragezeichen >= 0 ? ohneRaute.slice(0, fragezeichen) : ohneRaute;
  const query = new URLSearchParams(fragezeichen >= 0 ? ohneRaute.slice(fragezeichen + 1) : '');
  const teile = pfad.split('/').filter(Boolean).map((t) => {
    try {
      return decodeURIComponent(t);
    } catch {
      return t; // kaputte %-Folge (z. B. abgeschnittener Link): roh weitergeben statt abzustürzen
    }
  });
  return { hash, pfad, teile, query };
}

/** Aktuelle Route: { hash, pfad, teile, query (URLSearchParams) } */
export function aktuelleRoute() {
  return leseRoute();
}

/** Wechselt die Ansicht, z. B. navigiere('#/rezept/123'). Fragt vorher einen Verlassen-Schutz. */
export async function navigiere(hash, { ersetzen = false } = {}) {
  if (verlaufWartet) await verlaufWartet;
  if (!(await darfVerlassen())) return;
  const ziel = hash.startsWith('#') ? hash : `#${hash}`;
  if (ziel === location.hash) {
    zeigeRoute();
    return;
  }
  if (ersetzen) location.replace(ziel);
  else location.hash = ziel;
}

/** Eine Ansicht zurück (oder zur Rezeptliste, wenn es kein Zurück gibt). */
export async function zurueck() {
  if (verlaufWartet) await verlaufWartet;
  if (!(await darfVerlassen())) return;
  if (kannZurueck()) history.back();
  else navigiere(STANDARD_ROUTE, { ersetzen: true });
}

// Position im Verlauf (Navigation API) oder null, wenn der Browser sie nicht kennt
function verlaufsIndex() {
  try {
    const i = globalThis.navigation?.currentEntry?.index;
    return Number.isInteger(i) && i >= 0 ? i : null;
  } catch {
    return null;
  }
}

// Liegt davor ein Eintrag dieser App? Die Navigation API weiß das auch nach einem Neuladen.
function kannZurueck() {
  const i = verlaufsIndex();
  if (i === null) return innerhalbNavigiert && history.length > 1;
  return i > 0 && globalThis.navigation.entries()[i - 1]?.sameDocument === true;
}

// ---------------------------------------------------------------- Verlassen-Schutz

let verlassenSchutz = null;
let angezeigt = { hash: null, index: null }; // Hash und Verlaufsposition der gezeigten Ansicht
let rueckkehr = null;
let schutzLaeuft = false;

/**
 * Schützt die aktuelle Ansicht vor dem Verlassen, z. B. bei ungespeicherten Änderungen –
 * auch bei Zurück-Geste und Links. fn() → false (auch als Promise) = bleiben, sonst verlassen.
 * Gilt bis zum nächsten Seitenwechsel. Gibt eine Funktion zum Aufheben zurück.
 */
export function setzeVerlassenSchutz(fn) {
  const eigen = typeof fn === 'function' ? fn : null;
  verlassenSchutz = eigen;
  return () => {
    if (verlassenSchutz === eigen) verlassenSchutz = null;
  };
}

// Fragt den Schutz. true = darf verlassen werden (der Schutz ist dann aufgehoben).
async function darfVerlassen() {
  const schutz = verlassenSchutz;
  if (!schutz) return true;
  let ok = true;
  try {
    ok = (await schutz()) !== false;
  } catch (e) {
    console.error(e);
  }
  if (verlaufWartet) await verlaufWartet; // Verlaufseintrag des Dialogs zuerst abbauen
  if (ok && verlassenSchutz === schutz) verlassenSchutz = null;
  return ok;
}

// Springt im Verlauf zur geschützten Ansicht zurück, ohne sie neu zu zeichnen
function springe(schritte) {
  return new Promise((resolve) => {
    const fertig = () => {
      clearTimeout(uhr);
      rueckkehr = null;
      resolve();
    };
    const uhr = setTimeout(fertig, 1000);
    rueckkehr = fertig;
    history.go(schritte);
  });
}

// Zurück-Geste oder Link hat eine geschützte Ansicht verlassen: erst zurückholen, dann fragen.
// false = geht hier nicht (ohne Navigation API), dann wird normal gewechselt.
function schuetzeVerlassen() {
  const jetzt = verlaufsIndex();
  if (jetzt === null || angezeigt.index === null) return false;
  const ziel = location.hash;
  const schritte = angezeigt.index - jetzt; // > 0: Zurück, < 0: Link oder Vor, 0: ersetzt
  schutzLaeuft = true;
  (async () => {
    try {
      if (schritte === 0) history.replaceState(history.state, '', angezeigt.hash);
      else await springe(schritte);
      if (!(await darfVerlassen())) return;
      if (schritte > 0) history.go(-schritte);
      else navigiere(ziel, { ersetzen: schritte === 0 });
    } finally {
      schutzLaeuft = false;
    }
  })();
  return true;
}

function setzeTab(tab) {
  for (const a of document.querySelectorAll('.navi-link')) {
    const aktiv = a.dataset.tab === tab;
    a.classList.toggle('aktiv', aktiv);
    if (aktiv) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

async function zeigeRoute() {
  const nummer = ++renderNummer;
  const route = leseRoute();
  const def = ROUTEN.find((r) => r.muster.test(route.pfad));
  if (!def) {
    history.replaceState(null, '', STANDARD_ROUTE);
    zeigeRoute();
    return;
  }
  if (neuladenAusstehend && !def.vollbild) {
    // Ein anderer Tab hat die neue Version aktiviert: jetzt (nach dem Kochen) neu laden
    neuLaden();
    return;
  }
  verlassenSchutz = null;
  angezeigt = { hash: location.hash, index: verlaufsIndex() };
  if (aufraeumen) {
    try {
      aufraeumen();
    } catch (e) {
      console.error(e);
    }
    aufraeumen = null;
  }
  if (dialogAufloesen) {
    // Seitenwechsel bei offenem Dialog: schließen, ohne den Verlauf zurückzuspulen
    dialogImVerlauf = false;
    schliesseDialog(null, true);
  }
  document.body.classList.toggle('kochmodus', !!def.vollbild);
  setzeTab(def.tab);
  document.getElementById('kopf-zurueck').classList.toggle('versteckt', !def.zurueck);
  kopfAktionen();
  const root = document.getElementById('inhalt');
  root.replaceChildren(el('p', { class: 'leer' }, 'Lädt…'));

  let modul;
  try {
    modul = await import(def.modul);
  } catch (e) {
    console.error(e);
    if (nummer === renderNummer) {
      root.replaceChildren(fehlerAnzeige('Dieser Bereich konnte nicht geladen werden. Bitte die App neu laden.', e));
    }
    return;
  }
  if (nummer !== renderNummer) return;

  const container = el('div', { class: 'seite' });
  root.replaceChildren(container);
  window.scrollTo(0, 0);
  try {
    const ergebnis = await modul.zeige(container, route);
    if (typeof ergebnis === 'function') {
      if (nummer === renderNummer) aufraeumen = ergebnis;
      else ergebnis();
    }
  } catch (e) {
    console.error(e);
    if (nummer === renderNummer) root.replaceChildren(fehlerAnzeige('Hier ist ein Fehler aufgetreten.', e));
  }
  if (nummer === renderNummer && !def.vollbild && wartenderSW) zeigeUpdateBanner();
}

// ---------------------------------------------------------------- Teilen

function uebernimmGeteiltes() {
  const p = new URLSearchParams(location.search);
  if (!p.has('title') && !p.has('text') && !p.has('url')) return false;
  const daten = { title: p.get('title') || '', text: p.get('text') || '', url: p.get('url') || '' };
  try {
    sessionStorage.setItem(GETEILT_SCHLUESSEL, JSON.stringify(daten));
  } catch {
    geteiltImSpeicher = daten;
  }
  // Query entfernen, damit ein Neuladen den Import nicht wiederholt
  history.replaceState(null, '', `${location.pathname}#/import`);
  return true;
}

let geteiltImSpeicher = null;

/** Liefert einmalig die per „Teilen“ empfangenen Daten { title, text, url } oder null. */
export function holeGeteiltes() {
  if (geteiltImSpeicher) {
    const d = geteiltImSpeicher;
    geteiltImSpeicher = null;
    return d;
  }
  try {
    const roh = sessionStorage.getItem(GETEILT_SCHLUESSEL);
    if (!roh) return null;
    sessionStorage.removeItem(GETEILT_SCHLUESSEL);
    return JSON.parse(roh);
  } catch {
    return null;
  }
}

/** Teilt Text über das Android-Teilen-Menü, sonst Kopieren in die Zwischenablage. */
export async function teileText(titel, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: titel, text });
      return 'geteilt';
    } catch (e) {
      if (e?.name === 'AbortError') return 'abgebrochen';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('In die Zwischenablage kopiert.');
    return 'kopiert';
  } catch {
    toast('Teilen ist hier nicht möglich.');
    return 'fehler';
  }
}

// ---------------------------------------------------------------- Updates

function zeigeUpdateBanner() {
  if (document.body.classList.contains('kochmodus')) return;
  document.getElementById('update-banner').classList.remove('versteckt');
}

function merkeWartenden(sw) {
  if (!sw || sw.state === 'redundant') return;
  wartenderSW = sw;
  zeigeUpdateBanner();
}

/** Lädt genau einmal neu (Update-Wechsel und Sicherheits-Timer dürfen nicht doppelt laden). */
function neuLaden() {
  if (neuGeladen) return;
  neuGeladen = true;
  location.reload();
}

/** Wartet, bis ein installierender Service Worker fertig ist (oder scheitert). */
function warteAufInstallation(sw, ms = 30000) {
  return new Promise((resolve) => {
    if (!sw || sw.state !== 'installing') {
      resolve();
      return;
    }
    const fertig = () => {
      if (sw.state === 'installing') return;
      sw.removeEventListener('statechange', fertig);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      sw.removeEventListener('statechange', fertig);
      resolve();
    }, ms);
    sw.addEventListener('statechange', fertig);
  });
}

async function registriereServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let bisherigerController = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Erstinstallation (clients.claim): Seite läuft schon mit der neuesten Version
    if (!bisherigerController) {
      bisherigerController = navigator.serviceWorker.controller;
      if (!updateAngefordert) return;
    }
    // Wechsel aus einem anderen Tab: nicht mitten beim Kochen neu laden, sondern beim nächsten Seitenwechsel
    if (!updateAngefordert && document.body.classList.contains('kochmodus')) {
      neuladenAusstehend = true;
      return;
    }
    neuLaden();
  });
  try {
    registrierung = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (e) {
    console.warn('Service Worker nicht registriert:', e);
    return;
  }
  if (!registrierung) return;
  if (registrierung.waiting && navigator.serviceWorker.controller) merkeWartenden(registrierung.waiting);
  registrierung.addEventListener('updatefound', () => {
    const neu = registrierung.installing;
    neu?.addEventListener('statechange', () => {
      if (neu.state === 'installed' && navigator.serviceWorker.controller) merkeWartenden(neu);
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registrierung?.update().catch(() => {});
  });
}

/** Sucht nach einer neuen Version. Ergebnis: 'neu' | 'aktuell' | 'offline' | null (kein Service Worker). */
export async function pruefeUpdate() {
  if (!registrierung) return null;
  try {
    await registrierung.update();
  } catch {
    return 'offline';
  }
  // update() kehrt zurück, sobald das Skript geladen ist – die Installation (Dateien laden) abwarten,
  // damit „Neu laden“ danach wirklich die neue Version startet
  await warteAufInstallation(registrierung.installing);
  if (registrierung.waiting) {
    merkeWartenden(registrierung.waiting);
    return 'neu';
  }
  return registrierung.installing ? 'neu' : 'aktuell';
}

/** Lädt die neue Version (falls eine wartet), sonst einfach neu. */
export function ladeNeu() {
  const sw = registrierung?.waiting || wartenderSW;
  if (sw && sw.state !== 'redundant') {
    updateAngefordert = true;
    sw.postMessage({ typ: 'SKIP_WAITING' });
    // Sicherheitsnetz, falls der Wechsel ausbleibt
    setTimeout(neuLaden, 3000);
  } else {
    neuLaden();
  }
}

// ---------------------------------------------------------------- Start

function start() {
  uebernimmGeteiltes();
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    history.replaceState(null, '', STANDARD_ROUTE);
  }
  document.getElementById('kopf-zurueck').addEventListener('click', zurueck);
  document.getElementById('update-knopf').addEventListener('click', ladeNeu);
  window.addEventListener('hashchange', () => {
    innerhalbNavigiert = true;
    if (rueckkehr && location.hash === angezeigt.hash) {
      rueckkehr(); // eigener Rücksprung des Verlassen-Schutzes: die Ansicht steht noch
      return;
    }
    if (schutzLaeuft || (verlassenSchutz && location.hash !== angezeigt.hash && schuetzeVerlassen())) return;
    zeigeRoute();
  });
  zeigeRoute();
  registriereServiceWorker();
  db.bitteUmDauerhaftenSpeicher();
  setTimeout(() => db.bereinige().catch(() => {}), 10000);
}

start();
