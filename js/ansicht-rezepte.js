// Rezeptliste (#/rezepte) und Rezept-Ansicht (#/rezept/<id>):
// Suche, Filter, Favoriten, Portionen umrechnen, in die Woche planen, löschen mit „Rückgängig“.

import { el, symbol, SYMBOLE, setzeTitel, kopfAktionen, toast, dialog, bestaetige, auswahl, navigiere, teileText } from './app.js';
import * as db from './db.js';
import { heute, plusTage, formatDatum, relativerName } from './datum.js';
import { skaliere, formatZutat } from './zutaten.js';

const TAG_MS = 86400000;
const SICHERUNG_NACH_TAGEN = 14;
const MAX_TAG_CHIPS = 12;
const MAHLZEITEN = ['frueh', 'mittag', 'abend', 'snack'];
export const MAHLZEIT_NAMEN = { frueh: 'Frühstück', mittag: 'Mittag', abend: 'Abend', snack: 'Snack' };
const sortierer = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

// Filter bleiben erhalten, solange die App offen ist (Liste → Rezept → zurück)
const filter = { suche: '', favoriten: false, tag: null };

const NEU_OPTIONEN = [
  { text: 'Neues Rezept', beschreibung: 'Selbst eintippen', wert: '#/neu', symbol: SYMBOLE.plus },
  { text: 'Link einfügen', beschreibung: 'Rezept von einer Webseite laden', wert: '#/import?modus=link', symbol: SYMBOLE.link },
  { text: 'Text einfügen', beschreibung: 'Kopierten Rezepttext übernehmen', wert: '#/import?modus=text', symbol: SYMBOLE.text },
];

export async function zeige(container, route) {
  if (route.teile[0] === 'rezept' && route.teile[1]) return zeigeRezept(container, route.teile[1], route.query);
  return zeigeListe(container);
}

// ---------------------------------------------------------------- Hilfen

/** Minuten → '45 Min.' oder '1 Std. 15 Min.'; '' wenn leer. */
export function dauerText(minuten) {
  const m = Math.round(Number(minuten));
  if (!Number.isFinite(m) || m <= 0) return '';
  const h = Math.floor(m / 60);
  if (!h) return `${m} Min.`;
  return m % 60 ? `${h} Std. ${m % 60} Min.` : `${h} Std.`;
}

const gesamtMinuten = (r) => r.totalMin || (r.prepMin || 0) + (r.cookMin || 0) || null;
const portionenText = (n) => (n === 1 ? '1 Portion' : `${n} Portionen`);
// Portionen, auf die sich die Mengen beziehen (ohne Angabe: 1)
const basisPortionen = (r) => (Number(r.servings) > 0 ? Number(r.servings) : 1);
const tagName = (s) => relativerName(s) || formatDatum(s, { wochentag: true });
const rezeptLink = (id, zusatz = '') => `#/rezept/${encodeURIComponent(id)}${zusatz}`;

/** Nur http(s)-Adressen werden als Link oder Bild benutzt. */
export function istWebLink(url) {
  return /^https?:\/\/[^\s/]+\S*$/i.test(String(url ?? '').trim());
}

/** 'https://www.chefkoch.de/…' → 'chefkoch.de' */
export function hostVon(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url ?? ''); }
}

// Für die Suche: klein, ohne Akzente; ä/ae, ö/oe, ü/ue und ß/ss gelten als gleich
function falte(text) {
  return String(text ?? '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
}

/** Zutat in Mengen-Spalte und Rest teilen: { menge: '200 g', name: 'Mehl (gesiebt)' }. */
export function zutatSpalten(z) {
  const voll = formatZutat(z) || String(z?.raw ?? '');
  const name = [String(z?.name ?? '').trim(), z?.note ? `(${z.note})` : ''].filter(Boolean).join(' ');
  if (name && voll.length > name.length && voll.endsWith(name)) return { menge: voll.slice(0, -name.length).trim(), name };
  return { menge: '', name: voll };
}

// Ersetzt den Inhalt; Listen werden aufgelöst, null/false ausgelassen (replaceChildren macht daraus Text)
const fuelle = (ziel, ...kinder) => ziel.replaceChildren(...kinder.flat(Infinity).filter((k) => k != null && typeof k !== 'boolean'));

// Fasst schnelle Folgen von Aufrufen zusammen (für beobachte)
function verzoegert(fn, ms = 100) {
  let t = null;
  const f = () => { clearTimeout(t); t = setTimeout(fn, ms); };
  f.stopp = () => clearTimeout(t);
  return f;
}

/** Zähler mit − / +. Ergebnis: { knoten, wert() } */
function stepper(start, beiAenderung = null, min = 1, max = 99) {
  let wert = start;
  const ausgabe = el('output', { 'aria-live': 'polite' });
  const minus = el('button', { type: 'button', 'aria-label': 'Weniger Portionen' }, '−');
  const plus = el('button', { type: 'button', 'aria-label': 'Mehr Portionen' }, '+');
  const setze = (w) => {
    wert = Math.min(max, Math.max(min, w));
    ausgabe.textContent = String(wert);
    minus.disabled = wert <= min;
    plus.disabled = wert >= max;
  };
  minus.addEventListener('click', () => { setze(wert - 1); beiAenderung?.(wert); });
  plus.addEventListener('click', () => { setze(wert + 1); beiAenderung?.(wert); });
  setze(wert);
  return { knoten: el('span', { class: 'stepper' }, minus, ausgabe, plus), wert: () => wert };
}

// Führt eine Speicher-Aktion aus; bei einem Fehler kurze Meldung und null
async function versuche(arbeit, fehlerText) {
  try { return await arbeit(); } catch (e) { console.error(e); toast(fehlerText); return null; }
}

const favoritUmschalten = (id) => versuche(async () => {
  const r = await db.hole('recipes', id);
  return r ? db.speichere('recipes', { ...r, favorite: !r.favorite }) : null;
}, 'Speichern hat nicht geklappt.');

function sternKnopf(r, onclick) {
  return el('button', {
    type: 'button', class: 'icon-knopf', 'aria-pressed': String(!!r.favorite), 'aria-label': 'Favorit',
    title: r.favorite ? 'Aus den Favoriten nehmen' : 'Als Favorit merken', onclick,
  }, symbol(r.favorite ? SYMBOLE.stern : SYMBOLE.sternLeer));
}

// ---------------------------------------------------------------- Liste

async function zeigeListe(container) {
  setzeTitel('Rezepte');
  let aktiv = true;
  let rezepte = []; // [{ r, heu: gefalteter Suchtext }]
  let einstellungen = null;

  const hinweisBox = el('div', { class: 'versteckt' });
  const suchFeld = el('input', {
    type: 'search', value: filter.suche, placeholder: 'Rezepte durchsuchen', 'aria-label': 'Rezepte durchsuchen',
    autocomplete: 'off', enterkeyhint: 'search',
  });
  suchFeld.addEventListener('input', () => { filter.suche = suchFeld.value; zeichneListe(); });
  const sucheBox = el('label', { class: 'suche versteckt' }, symbol(SYMBOLE.suche), suchFeld);
  const chipsBox = el('div', { class: 'chips versteckt', role: 'group', 'aria-label': 'Filter' });
  const zaehler = el('p', { class: 'nebentext versteckt', 'aria-live': 'polite' });
  const listeBox = el('div');
  const fab = el('button', {
    type: 'button', class: 'fab', 'aria-label': 'Rezept hinzufügen',
    onclick: async () => {
      const ziel = await auswahl('Rezept hinzufügen', NEU_OPTIONEN);
      if (ziel) navigiere(ziel);
    },
  }, symbol(SYMBOLE.plus));
  container.replaceChildren(hinweisBox, sucheBox, chipsBox, zaehler, listeBox, fab);

  function zeichneHinweis() {
    const letzte = einstellungen?.letzteSicherung;
    const tage = letzte ? Math.floor((Date.now() - letzte) / TAG_MS) : null;
    const zeigen = rezepte.length > 0 && (tage == null || tage >= SICHERUNG_NACH_TAGEN);
    hinweisBox.className = zeigen ? 'hinweis' : 'versteckt';
    hinweisBox.replaceChildren(...(!zeigen ? [] : [
      el('p', null, el('span', { class: 'fett' }, `Letzte Sicherung: ${tage == null ? 'nie' : `vor ${tage} Tagen`}.`),
        ' Sichere deine Rezepte ab und zu, damit nichts verloren geht.'),
      el('div', { class: 'leiste' },
        el('button', { type: 'button', class: 'knopf klein primaer', onclick: () => navigiere('#/mehr') }, 'Jetzt sichern')),
    ]));
  }

  const neuZeichnen = () => { zeichneChips(); zeichneListe(); };
  function zeichneChips() {
    const zaehlung = new Map(); // klein geschriebener Tag → { name, n }
    for (const { r } of rezepte) {
      for (const t of new Set((r.tags || []).map((x) => String(x).trim()).filter(Boolean))) {
        const e = zaehlung.get(t.toLowerCase()) || { name: t, n: 0 };
        e.n += 1;
        zaehlung.set(t.toLowerCase(), e);
      }
    }
    if (filter.tag && !zaehlung.has(filter.tag)) filter.tag = null;
    const tags = [...zaehlung].sort((a, b) => b[1].n - a[1].n || sortierer.compare(a[1].name, b[1].name)).slice(0, MAX_TAG_CHIPS);
    if (filter.tag && !tags.some(([k]) => k === filter.tag)) tags.push([filter.tag, zaehlung.get(filter.tag)]);
    const chip = (inhalt, an, onclick) => el('button', {
      type: 'button', class: ['chip', an && 'aktiv'], 'aria-pressed': String(an), onclick,
    }, inhalt);
    fuelle(chipsBox,
      chip([symbol(SYMBOLE.stern), 'Favoriten'], filter.favoriten, () => { filter.favoriten = !filter.favoriten; neuZeichnen(); }),
      tags.map(([k, e]) => chip(e.name, filter.tag === k, () => { filter.tag = filter.tag === k ? null : k; neuZeichnen(); })));
    chipsBox.classList.toggle('versteckt', !rezepte.length);
  }

  function zeile(r) {
    const meta = [dauerText(gesamtMinuten(r)), Number(r.servings) > 0 ? portionenText(Number(r.servings)) : '',
      (r.tags || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
    return el('li', null, el('div', { class: 'listen-eintrag' },
      el('a', { class: 'haupt', href: rezeptLink(r.id) },
        el('span', { class: 'titel' }, r.title || 'Ohne Titel'),
        meta ? el('span', { class: 'nebentext' }, meta) : null),
      sternKnopf(r, () => favoritUmschalten(r.id))));
  }

  function zeichneListe() {
    sucheBox.classList.toggle('versteckt', !rezepte.length);
    zaehler.classList.toggle('versteckt', !rezepte.length);
    if (!rezepte.length) {
      listeBox.replaceChildren(el('div', { class: 'leer' },
        el('p', { class: 'fett' }, 'Noch keine Rezepte'),
        el('p', null, 'Leg ein Rezept selbst an oder übernimm es aus dem Internet – als Link oder als kopierten Text.'),
        el('div', { class: 'stapel' }, NEU_OPTIONEN.map((o, i) => el('button', {
          type: 'button', class: ['knopf', i === 0 && 'primaer'], onclick: () => navigiere(o.wert),
        }, symbol(o.symbol), o.text)))));
      return;
    }
    const woerter = falte(filter.suche).split(/\s+/).filter(Boolean);
    const treffer = rezepte.filter(({ r, heu }) => (!filter.favoriten || r.favorite) &&
      (!filter.tag || (r.tags || []).some((t) => String(t).trim().toLowerCase() === filter.tag)) &&
      woerter.every((w) => heu.includes(w)));
    zaehler.textContent = treffer.length < rezepte.length ? `${treffer.length} von ${rezepte.length} Rezepten`
      : rezepte.length === 1 ? '1 Rezept' : `${rezepte.length} Rezepte`;
    if (treffer.length) {
      listeBox.replaceChildren(el('ul', { class: 'liste' }, treffer.map(({ r }) => zeile(r))));
      return;
    }
    listeBox.replaceChildren(el('div', { class: 'leer' },
      el('p', null, 'Keine passenden Rezepte gefunden.'),
      el('button', {
        type: 'button', class: 'knopf',
        onclick: () => {
          Object.assign(filter, { suche: '', favoriten: false, tag: null });
          suchFeld.value = '';
          neuZeichnen();
        },
      }, 'Filter zurücksetzen')));
  }

  async function laden() {
    const [liste, e] = await Promise.all([db.alle('recipes'), db.holeEinstellungen()]);
    if (!aktiv) return;
    einstellungen = e;
    rezepte = liste
      .map((r) => ({ r, heu: falte([r.title, ...(r.tags || []), ...(r.ingredients || []).map((z) => z?.name)].join(' ')) }))
      .sort((a, b) => sortierer.compare(a.r.title || '', b.r.title || ''));
    zeichneHinweis();
    neuZeichnen();
  }

  await laden();
  const neuLaden = verzoegert(() => laden().catch(console.error));
  const abmelden = db.beobachte(({ store }) => {
    if (store === 'recipes' || store === 'settings') neuLaden();
  });
  return () => { aktiv = false; abmelden(); neuLaden.stopp(); };
}

// ---------------------------------------------------------------- Einzelnes Rezept

export function nichtGefunden(container) {
  setzeTitel('Rezept');
  kopfAktionen();
  container.replaceChildren(el('div', { class: 'leer' },
    el('p', null, 'Dieses Rezept gibt es nicht (mehr).'),
    el('a', { class: 'knopf', href: '#/rezepte' }, 'Zur Rezeptliste')));
}

function kopfBereich(r) {
  let bild = null;
  if (istWebLink(r.imageUrl)) {
    // Attribute vor src setzen, damit kein Referrer mitgeht
    bild = el('img', { class: 'rezept-bild', alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', decoding: 'async', src: r.imageUrl });
    bild.addEventListener('error', () => bild.remove());
  }
  const meta = [];
  if (gesamtMinuten(r)) meta.push(el('span', null, symbol(SYMBOLE.uhr), ` ${dauerText(gesamtMinuten(r))}`));
  if (r.prepMin) meta.push(el('span', null, `Vorbereitung ${dauerText(r.prepMin)}`));
  if (r.cookMin) meta.push(el('span', null, `Kochzeit ${dauerText(r.cookMin)}`));
  if (istWebLink(r.sourceUrl)) {
    meta.push(el('a', { href: r.sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
      symbol(SYMBOLE.link), ` ${r.sourceSite || hostVon(r.sourceUrl)}`));
  } else if (r.sourceSite) {
    meta.push(el('span', null, `Quelle: ${r.sourceSite}`));
  }
  const tags = (r.tags || []).filter(Boolean);
  return el('div', { class: 'rezept-kopf' }, bild,
    el('h2', null, r.title || 'Ohne Titel'),
    meta.length ? el('div', { class: 'meta' }, meta) : null,
    tags.length ? el('div', { class: 'meta' }, tags.map((t) => el('span', { class: 'badge grau' }, t))) : null);
}

// Gruppiert Einträge nach `group`: Überschrift (h3) + neue Liste je Gruppe
function gruppiert(eintraege, neueListe, eintrag) {
  const knoten = [];
  let gruppe = null;
  let liste = null;
  eintraege.forEach((x, i) => {
    if (!liste || (x.group || null) !== gruppe) {
      gruppe = x.group || null;
      if (gruppe) knoten.push(el('h3', { class: 'zutat-gruppe' }, gruppe));
      knoten.push((liste = neueListe(i)));
    }
    liste.append(eintrag(x));
  });
  return knoten;
}

function zutatenKnoten(zutaten, faktor) {
  if (!zutaten?.length) return [el('p', { class: 'nebentext' }, 'Keine Zutaten eingetragen.')];
  return gruppiert(zutaten, () => el('ul', { class: 'zutaten-liste' }), (z) => {
    const { menge, name } = zutatSpalten(faktor === 1 ? z : skaliere(z, faktor));
    return el('li', { class: 'zutat' }, el('span', { class: 'menge' }, menge), el('span', null, name));
  });
}

function schritteKnoten(schritte) {
  if (!schritte?.length) return [el('p', { class: 'nebentext' }, 'Keine Zubereitungsschritte eingetragen.')];
  // Nummerierung läuft über Gruppen hinweg weiter (start)
  return gruppiert(schritte, (i) => el('ol', { class: 'schritte', start: i + 1 }), (s) => el('li', { class: 'schritt' }, s.text));
}

/** Rezept als Text zum Teilen (mit den gerade eingestellten Portionen). */
function rezeptAlsText(r, portionen) {
  const faktor = portionen / basisPortionen(r);
  const zeilen = [r.title || 'Rezept', ''];
  const mitGruppen = (liste, text) => {
    let gruppe = null;
    liste.forEach((x, i) => {
      if ((x.group || null) !== gruppe && (gruppe = x.group || null)) zeilen.push('', `${gruppe}:`);
      zeilen.push(text(x, i));
    });
    zeilen.push('');
  };
  if (r.ingredients?.length) {
    zeilen.push(Number(r.servings) > 0 ? `Zutaten für ${portionenText(portionen)}:` : 'Zutaten:');
    mitGruppen(r.ingredients, (z) => `• ${formatZutat(skaliere(z, faktor))}`);
  }
  if (r.steps?.length) {
    zeilen.push('Zubereitung:');
    mitGruppen(r.steps, (s, i) => `${i + 1}. ${s.text}`);
  }
  if (r.notes) zeilen.push('Notizen:', r.notes, '');
  if (istWebLink(r.sourceUrl)) zeilen.push(`Quelle: ${r.sourceUrl}`);
  return zeilen.join('\n').trim();
}

async function planeDialog(rezept, portionen, einstellungen) {
  const h = heute();
  const tagWahl = el('select', null, Array.from({ length: 14 }, (_, i) => el('option', { value: plusTage(h, i) }, tagName(plusTage(h, i)))));
  const slots = MAHLZEITEN.filter((m) => (einstellungen.mahlzeiten || []).includes(m));
  if (!slots.length) slots.push('abend');
  const slotWahl = el('select', null, slots.map((m) => el('option', { value: m, selected: m === 'abend' }, MAHLZEIT_NAMEN[m])));
  const st = stepper(portionen);
  // fokus: false – Auswahlfelder und Zähler brauchen keine Tastatur
  const wahl = await dialog({
    titel: 'In Woche planen', fokus: false, inhalt: [
      el('p', { class: 'fett' }, rezept.title),
      el('label', { class: 'feld' }, el('span', null, 'Tag'), tagWahl),
      slots.length > 1 ? el('label', { class: 'feld' }, el('span', null, 'Mahlzeit'), slotWahl) : null,
      el('div', { class: 'feld-zeile' }, el('span', null, 'Portionen'), st.knoten),
    ],
    knoepfe: [
      { text: 'Abbrechen', wert: null, art: 'flach' },
      { text: 'Planen', wert: () => ({ date: tagWahl.value, slot: slotWahl.value || slots[0], servings: st.wert() }), art: 'primaer' },
    ],
  });
  const eintrag = { ...wahl, recipeId: rezept.id, title: rezept.title, note: '', cooked: false, tripId: null };
  if (!wahl || !(await versuche(() => db.speichere('planEntries', eintrag), 'Planen hat nicht geklappt.'))) return;
  toast(`Geplant: ${tagName(wahl.date)}, ${MAHLZEIT_NAMEN[wahl.slot]}`,
    { aktion: { text: 'Zur Woche', onclick: () => navigiere(`#/woche/${wahl.date}`) } });
}

async function loescheRezept(rezept) {
  const ok = await bestaetige(`„${rezept.title || 'Ohne Titel'}“ wird gelöscht.`, { titel: 'Rezept löschen?', ja: 'Löschen', gefahr: true });
  if (!ok || !(await versuche(() => db.loesche('recipes', rezept.id).then(() => true), 'Löschen hat nicht geklappt.'))) return;
  navigiere('#/rezepte', { ersetzen: true });
  const rueckgaengig = () => db.wiederherstellen('recipes', rezept.id).then(() => toast('Rezept wiederhergestellt.'), console.error);
  toast('Rezept gelöscht.', { aktion: { text: 'Rückgängig', onclick: rueckgaengig } });
}

async function zeigeRezept(container, id, query) {
  setzeTitel('Rezept');
  let aktiv = true;
  let [rezept, einstellungen] = await Promise.all([db.hole('recipes', id), db.holeEinstellungen()]);
  if (!rezept) return nichtGefunden(container);
  const p = Math.round(Number(query.get('p')));
  let portionen = p > 0 && p < 100 ? p : Math.min(99, Math.max(1, Math.round(basisPortionen(rezept))));
  const geplantBox = el('p', { class: 'nebentext versteckt' });

  function zeichneKopf() {
    document.title = `${rezept.title || 'Rezept'} – Einkauf & Koch`;
    kopfAktionen(
      sternKnopf(rezept, async () => {
        const neu = await favoritUmschalten(id);
        if (!neu || !aktiv) return;
        rezept = neu;
        zeichneKopf();
        toast(neu.favorite ? 'Zu den Favoriten hinzugefügt.' : 'Aus den Favoriten entfernt.', { dauer: 2000 });
      }),
      el('a', { class: 'icon-knopf', href: rezeptLink(id, '/bearbeiten'), 'aria-label': 'Bearbeiten', title: 'Bearbeiten' },
        symbol(SYMBOLE.bearbeiten)));
  }

  async function zeichneGeplant() {
    const h = heute();
    const eintraege = (await db.alle('planEntries')).filter((e) => e.recipeId === id && e.date >= h)
      .sort((a, b) => a.date.localeCompare(b.date) || MAHLZEITEN.indexOf(a.slot) - MAHLZEITEN.indexOf(b.slot));
    if (!aktiv) return;
    geplantBox.classList.toggle('versteckt', !eintraege.length);
    fuelle(geplantBox, 'Geplant: ', eintraege.slice(0, 5).map((e, i) => [i ? ', ' : '',
      el('a', { href: `#/woche/${e.date}` }, `${tagName(e.date)} (${MAHLZEIT_NAMEN[e.slot] || e.slot})`)]),
    eintraege.length > 5 ? ' …' : '');
  }

  function zeichne() {
    const zutatenBox = el('div');
    const zeichneZutaten = () => zutatenBox.replaceChildren(...zutatenKnoten(rezept.ingredients, portionen / basisPortionen(rezept)));
    zeichneZutaten();
    const st = stepper(portionen, (w) => { portionen = w; zeichneZutaten(); });
    zeichneKopf();
    fuelle(container,
      kopfBereich(rezept),
      el('div', { class: 'leiste' },
        el('button', { type: 'button', class: 'knopf primaer', onclick: () => navigiere(`#/kochen/${encodeURIComponent(id)}?p=${portionen}`) },
          symbol(SYMBOLE.kochen), 'Kochen'),
        el('button', { type: 'button', class: 'knopf', onclick: () => planeDialog(rezept, portionen, einstellungen) },
          symbol(SYMBOLE.kalender), 'In Woche planen')),
      geplantBox,
      el('section', { class: 'abschnitt' },
        el('h2', null, 'Zutaten'),
        el('div', { class: 'feld-zeile' }, el('span', null, 'Portionen'), st.knoten),
        Number(rezept.servings) > 0 ? null
          : el('p', { class: 'nebentext' }, 'Im Rezept steht keine Portionszahl – die Mengen gelten für „1“.'),
        zutatenBox),
      el('section', { class: 'abschnitt' }, el('h2', null, 'Zubereitung'), schritteKnoten(rezept.steps)),
      rezept.notes ? el('section', { class: 'abschnitt' }, el('h2', null, 'Notizen'),
        String(rezept.notes).split(/\n+/).map((t) => el('p', null, t))) : null,
      el('div', { class: 'leiste' },
        el('a', { class: 'knopf', href: rezeptLink(id, '/bearbeiten') }, symbol(SYMBOLE.bearbeiten), 'Bearbeiten'),
        el('button', { type: 'button', class: 'knopf', onclick: () => teileText(rezept.title, rezeptAlsText(rezept, portionen)) },
          symbol(SYMBOLE.teilen), 'Teilen'),
        // rot: zerstörerische Aktion (mit Nachfrage und „Rückgängig“)
        el('button', { type: 'button', class: 'knopf gefahr', onclick: () => loescheRezept(rezept) }, symbol(SYMBOLE.loeschen), 'Löschen')));
  }

  zeichne();
  zeichneGeplant().catch(console.error);

  // Änderungen aus anderen Tabs oder Ansichten übernehmen
  const neuLaden = verzoegert(async () => {
    const [neu, e] = await Promise.all([db.hole('recipes', id), db.holeEinstellungen()]);
    if (!aktiv) return;
    einstellungen = e;
    if (!neu) nichtGefunden(container);
    else if (neu.updatedAt !== rezept.updatedAt) {
      rezept = neu;
      zeichne();
    }
  });
  const neuGeplant = verzoegert(() => zeichneGeplant().catch(console.error));
  const abmelden = db.beobachte(({ store }) => {
    if (store === 'recipes' || store === 'settings') neuLaden();
    else if (store === 'planEntries') neuGeplant();
  });
  return () => { aktiv = false; abmelden(); neuLaden.stopp(); neuGeplant.stopp(); };
}
