// Wochenplan: 7 Tage mit den eingestellten Mahlzeiten. Gerichte (Rezept oder Notiz) planen,
// Portionen ändern, „gekocht“ abhaken, verschieben, entfernen. Oben der Weg zu „Automatisch planen“,
// unten der zur Einkaufsliste.

import { el, symbol, SYMBOLE, setzeTitel, toast, dialog, eingabe, auswahl, navigiere, fehlerAnzeige } from './app.js';
import * as db from './db.js';
import {
  heute, istSchluessel, wochenstart, wochentage, plusTage, kalenderwoche,
  formatDatum, formatZeitraum, wochentagLang, relativerName,
} from './datum.js';

const SLOTS = ['frueh', 'mittag', 'abend', 'snack'];
const SLOT_NAMEN = { frueh: 'Frühstück', mittag: 'Mittag', abend: 'Abend', snack: 'Snack' };
const MIN_PORTIONEN = 1;
const MAX_PORTIONEN = 99;
const BEOBACHTETE = new Set(['planEntries', 'recipes', 'settings']);
const SORTIERUNG = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

// Unbekannte Mahlzeit (z. B. aus einer Sicherung) landet beim Abendessen
const slotVon = (eintrag) => (SLOT_NAMEN[eintrag.slot] ? eintrag.slot : 'abend');

/** Suchtext ohne Groß-/Kleinschreibung und Akzente ('Gemüse' → 'gemuse'). */
function suchText(text) {
  return String(text ?? '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function portionenZahl(wert, ersatz) {
  const n = Math.round(Number(wert));
  return wert != null && Number.isFinite(n) && n >= MIN_PORTIONEN ? Math.min(n, MAX_PORTIONEN) : ersatz;
}

// Portionen eines Eintrags; fehlt die Angabe, gilt die des Rezepts
const portionenVon = (eintrag, rezept) => portionenZahl(eintrag.servings, portionenZahl(rezept?.servings, 1));
const portionenText = (n) => `${n} ${n === 1 ? 'Portion' : 'Portionen'}`;
// Schon eingekaufte Portionen (beim Abschließen gemerkt); null bei älteren Einträgen
const eingekauftFuer = (eintrag) => (eintrag.tripId && Number(eintrag.eingekauftPortionen) > 0 ? Number(eintrag.eingekauftPortionen) : null);

/** Stepper − / Zahl / +. `aendern(n)` wird bei jedem Klick aufgerufen. */
function portionenStepper(wert, aendern, { fokus = null, name = 'Portionen' } = {}) {
  let aktuell = wert;
  const ausgabe = el('output', { 'aria-live': 'polite' }, String(aktuell));
  const minus = el('button', { type: 'button', 'aria-label': `${name}: eine weniger`, dataset: fokus ? { fokus: `${fokus}-` } : null }, '−');
  const plus = el('button', { type: 'button', 'aria-label': `${name}: eine mehr`, dataset: fokus ? { fokus: `${fokus}+` } : null }, '+');
  const setze = (n) => {
    aktuell = Math.min(MAX_PORTIONEN, Math.max(MIN_PORTIONEN, n));
    ausgabe.textContent = String(aktuell);
    minus.disabled = aktuell <= MIN_PORTIONEN;
    plus.disabled = aktuell >= MAX_PORTIONEN;
  };
  minus.addEventListener('click', () => { setze(aktuell - 1); aendern(aktuell); });
  plus.addEventListener('click', () => { setze(aktuell + 1); aendern(aktuell); });
  setze(aktuell);
  return el('span', { class: 'stepper', role: 'group', 'aria-label': name }, minus, ausgabe, plus);
}

function merkeFokus(container) {
  const a = document.activeElement;
  return a && container.contains(a) ? a.dataset?.fokus ?? null : null;
}

function stelleFokusHer(container, schluessel) {
  if (!schluessel) return;
  const ziel = [...container.querySelectorAll('[data-fokus]')].find((x) => x.dataset.fokus === schluessel);
  if (ziel && !ziel.disabled) ziel.focus({ preventScroll: true });
}

export async function zeige(container, route) {
  setzeTitel('Woche');
  const angefragt = istSchluessel(route.teile[1]) ? route.teile[1] : null;
  let einst = null;
  let rezepte = new Map();
  let timer = null;
  let renderNummer = 0;

  async function speichereEintrag(eintrag) {
    try {
      return await db.speichere('planEntries', eintrag);
    } catch (e) {
      console.error(e);
      toast('Speichern hat nicht geklappt.');
      return null;
    }
  }

  // ------------------------------------------------------------ Planen
  async function planen(datum, slot) {
    const liste = (await db.alle('recipes')).sort((a, b) =>
      (b.favorite === true) - (a.favorite === true) || SORTIERUNG.compare(a.title || '', b.title || ''));
    let portionen = portionenZahl(einst.standardPortionen, 4);
    let beruehrt = false; // Stepper benutzt?
    let gewaehlt;
    let uebernehmen = null;
    const waehle = (wert) => {
      gewaehlt = wert;
      uebernehmen?.click();
    };
    const eintraege = liste.map((r) => {
      // eigene Portionen des Rezepts zeigen (Kuchen für 12 ≠ 4 Portionen Gulasch)
      const basis = portionenZahl(r.servings, null);
      const meta = [r.favorite ? '★ Favorit' : '', basis ? `für ${portionenText(basis)}` : '',
        r.totalMin ? `${r.totalMin} Min.` : '', ...(r.tags || []).slice(0, 3)].filter(Boolean).join(' · ');
      return {
        text: suchText([r.title, ...(r.tags || [])].join(' ')),
        li: el('li', null, el('button', { type: 'button', class: 'listen-eintrag', onclick: () => waehle({ rezept: r }) },
          el('span', { class: 'haupt' },
            el('span', { class: 'titel' }, r.title || 'Ohne Titel'),
            meta ? el('span', { class: 'nebentext' }, meta) : null))),
      };
    });
    const keinTreffer = el('p', { class: 'leer versteckt' }, 'Kein Rezept gefunden.');
    const suche = el('input', {
      type: 'search', placeholder: 'Rezept suchen', 'aria-label': 'Rezept suchen', autocomplete: 'off', enterkeyhint: 'search',
      oninput: () => {
        const woerter = suchText(suche.value).split(/\s+/).filter(Boolean);
        let treffer = 0;
        for (const x of eintraege) {
          const passt = woerter.every((w) => x.text.includes(w));
          x.li.classList.toggle('versteckt', !passt);
          if (passt) treffer += 1;
        }
        keinTreffer.classList.toggle('versteckt', treffer > 0);
      },
      // Enter übernimmt das Rezept, wenn nur noch eines passt
      onkeydown: (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const passend = eintraege.filter((x) => !x.li.classList.contains('versteckt'));
        if (passend.length === 1) passend[0].li.querySelector('button').click();
      },
    });
    // fokus: false – die Tastatur soll die Rezeptliste nicht gleich verdecken
    const ergebnis = dialog({
      fokus: false,
      titel: `${wochentagLang(datum)}, ${formatDatum(datum)} · ${SLOT_NAMEN[slot]}`,
      inhalt: [
        el('div', { class: 'feld-zeile' }, el('span', null, 'Portionen'), portionenStepper(portionen, (n) => {
          portionen = n;
          beruehrt = true;
        })),
        liste.length
          ? el('label', { class: 'suche' }, symbol(SYMBOLE.suche), suche)
          : el('p', { class: 'hinweis' }, 'Noch keine Rezepte gespeichert. Du kannst trotzdem eine Notiz planen, z. B. „Reste“.'),
        keinTreffer,
        el('ul', { class: 'liste' }, eintraege.map((x) => x.li)),
      ],
      knoepfe: [
        { text: 'Abbrechen', wert: null, art: 'flach' },
        { text: 'Ohne Rezept', wert: () => ({ notiz: true }), art: 'flach' },
        { text: 'Übernehmen', wert: () => gewaehlt, art: 'primaer' },
      ],
    });
    // Ein Tipp auf ein Rezept schließt den Dialog über den (unsichtbaren) Übernehmen-Knopf
    uebernehmen = document.querySelector('#dialog .dlg-knoepfe .knopf:last-child');
    uebernehmen?.classList.add('versteckt');
    const w = await ergebnis;
    if (!w) return;
    let neu = { date: datum, slot, servings: portionen, note: '', cooked: false, tripId: null };
    const ohnePortionen = !!w.rezept && !portionenZahl(w.rezept.servings, null);
    if (w.rezept) {
      neu = { ...neu, recipeId: w.rezept.id, title: w.rezept.title || '' };
      // Rezept ohne Portionsangabe gilt als 1 Portion (= einmal das ganze Rezept), sonst würde es vervielfacht
      if (ohnePortionen && !beruehrt) neu.servings = 1;
    } else {
      const text = await eingabe('Notiz planen', {
        platzhalter: 'z. B. Reste, Essen gehen', beschriftung: `${wochentagLang(datum)} · ${SLOT_NAMEN[slot]}`, pflicht: true, ok: 'Planen',
      });
      if (!text) return;
      neu = { ...neu, recipeId: null, title: text };
    }
    const gespeichert = await speichereEintrag(neu);
    // Standard-Portionen passen kaum zum Rezept (Kuchen für 12, „1 Blech“): Hinweis mit Umstellen
    const basis = w.rezept ? portionenZahl(w.rezept.servings, null) : null;
    if (gespeichert && ohnePortionen && !beruehrt) {
      toast('Rezept ohne Portionsangabe: einmal das ganze Rezept eingeplant.');
    } else if (gespeichert && basis && !beruehrt && (portionen / basis < 0.5 || portionen / basis > 2)) {
      toast(`Geplant für ${portionenText(portionen)} (Rezept: ${basis}).`, {
        aktion: {
          text: `Auf ${basis} ändern`,
          onclick: async () => {
            const aktuell = await db.hole('planEntries', gespeichert.id);
            if (aktuell) await speichereEintrag({ ...aktuell, servings: basis });
          },
        },
      });
    }
  }

  // ------------------------------------------------------------ Menü eines Eintrags
  async function verschieben(eintrag) {
    const slots = SLOTS.filter((s) => einst.mahlzeiten.includes(s) || s === slotVon(eintrag));
    const datumFeld = el('input', { type: 'date', value: eintrag.date, required: true });
    const slotFeld = el('select', null, slots.map((s) => el('option', { value: s }, SLOT_NAMEN[s])));
    slotFeld.value = slotVon(eintrag);
    const w = await dialog({
      titel: 'Verschieben',
      inhalt: [
        el('label', { class: 'feld' }, el('span', null, 'Tag'), datumFeld),
        slots.length > 1 ? el('label', { class: 'feld' }, el('span', null, 'Mahlzeit'), slotFeld) : null,
      ],
      knoepfe: [
        { text: 'Abbrechen', wert: null, art: 'flach' },
        {
          text: 'Verschieben',
          art: 'primaer',
          wert: () => {
            if (istSchluessel(datumFeld.value)) return { datum: datumFeld.value, slot: slotFeld.value };
            datumFeld.focus();
            return undefined;
          },
        },
      ],
    });
    if (!w || (w.datum === eintrag.date && w.slot === slotVon(eintrag))) return;
    await speichereEintrag({ ...eintrag, date: w.datum, slot: w.slot });
    const start = wochenstart(w.datum, einst.wochenstart);
    const sichtbar = container.querySelector(`[data-tag="${w.datum}"]`);
    // formatDatum endet schon mit Punkt ('Do, 15.10.')
    toast(`Verschoben auf ${formatDatum(w.datum, { wochentag: true })}`, sichtbar ? {} : {
      aktion: { text: 'Anzeigen', onclick: () => navigiere(`#/woche/${start}`) },
    });
  }

  async function menue(eintrag, rezept, titel) {
    const optionen = [];
    if (rezept) optionen.push({ text: 'Kochen', wert: 'kochen', beschreibung: `Kochmodus für ${portionenVon(eintrag, rezept)} Portionen` });
    optionen.push({ text: 'Verschieben', wert: 'verschieben', beschreibung: 'Anderer Tag oder andere Mahlzeit' });
    if (!eintrag.recipeId) optionen.push({ text: 'Umbenennen', wert: 'umbenennen' });
    optionen.push({ text: 'Entfernen', wert: 'entfernen' });
    const w = await auswahl(titel, optionen);
    if (!w) return;
    if (w === 'kochen') {
      navigiere(`#/kochen/${encodeURIComponent(rezept.id)}?p=${portionenVon(eintrag, rezept)}&plan=${encodeURIComponent(eintrag.id)}`);
    } else if (w === 'verschieben') {
      await verschieben(eintrag);
    } else if (w === 'umbenennen') {
      const text = await eingabe('Notiz ändern', { wert: eintrag.title || '', pflicht: true, ok: 'Speichern' });
      if (text) await speichereEintrag({ ...eintrag, title: text });
    } else if (w === 'entfernen') {
      await db.loesche('planEntries', eintrag.id);
      toast(`„${titel}“ entfernt.`, { aktion: { text: 'Rückgängig', onclick: () => db.wiederherstellen('planEntries', eintrag.id) } });
    }
  }

  // ------------------------------------------------------------ Darstellung
  function eintragZeile(eintrag) {
    const rezept = eintrag.recipeId ? rezepte.get(eintrag.recipeId) : null;
    const titel = rezept?.title || eintrag.title || (eintrag.recipeId ? 'Gelöschtes Rezept' : 'Ohne Titel');
    const fokus = `e:${eintrag.id}`;
    const gekauft = eingekauftFuer(eintrag);
    return el('div', { class: ['plan-eintrag', eintrag.cooked && 'gekocht', eintrag.tripId && 'eingekauft'] },
      rezept
        ? el('a', { href: `#/rezept/${encodeURIComponent(rezept.id)}` }, titel)
        : el('span', { class: 'titel' }, titel),
      eintrag.note ? el('span', { class: 'nebentext' }, eintrag.note) : null,
      eintrag.recipeId && !rezept ? el('span', { class: 'badge grau' }, 'Rezept gelöscht') : null,
      eintrag.recipeId
        ? portionenStepper(portionenVon(eintrag, rezept), (n) => {
          const vorher = portionenVon(eintrag, rezept);
          eintrag.servings = n;
          speichereEintrag(eintrag);
          // schon eingekauft: mehr Portionen → die Differenz kommt auf die Einkaufsliste
          if (gekauft && n > gekauft && vorher <= gekauft) {
            toast(`Eingekauft für ${portionenText(gekauft)} – der Rest kommt auf die Einkaufsliste.`,
              { aktion: { text: 'Zur Liste', onclick: () => navigiere('#/einkauf') } });
          }
        }, { fokus })
        : null,
      eintrag.recipeId ? el('span', { class: 'nebentext' }, 'Portionen') : null,
      el('label', { class: 'checkbox' },
        el('input', {
          type: 'checkbox',
          checked: eintrag.cooked === true,
          'aria-label': `${eintrag.title || 'Eintrag'} gekocht`,
          dataset: { fokus: `${fokus}:gekocht` },
          onchange: (ev) => {
            eintrag.cooked = ev.target.checked;
            ev.target.closest('.plan-eintrag')?.classList.toggle('gekocht', eintrag.cooked);
            speichereEintrag(eintrag);
          },
        }),
        el('span', null, 'gekocht')),
      eintrag.tripId ? el('span', { class: 'badge gruen' },
        gekauft && portionenVon(eintrag, rezept) > gekauft ? `eingekauft für ${gekauft}` : 'eingekauft') : null,
      el('button', {
        type: 'button',
        class: 'icon-knopf',
        'aria-label': `Optionen für ${titel}`,
        dataset: { fokus: `${fokus}:menue` },
        onclick: () => menue(eintrag, rezept, titel),
      }, symbol(SYMBOLE.mehr)));
  }

  function tagKarte(datum, eintraege, slotsAnzeige, mitTitel, heuteKey) {
    const relativ = relativerName(datum, heuteKey);
    const karte = el('section', { class: ['tag', datum === heuteKey && 'heute'], dataset: { tag: datum } },
      el('h3', { class: ['tag-kopf', datum < heuteKey && 'gedimmt'] },
        el('span', null, wochentagLang(datum)),
        el('span', { class: 'nebentext' }, formatDatum(datum)),
        relativ ? el('span', { class: ['badge', relativ === 'Heute' ? 'gruen' : 'grau'] }, relativ) : null));
    for (const slot of slotsAnzeige) {
      const imSlot = eintraege.filter((e) => slotVon(e) === slot);
      if (!imSlot.length && !einst.mahlzeiten.includes(slot)) continue;
      karte.append(el('div', { class: 'mahlzeit' },
        mitTitel ? el('h4', { class: 'mahlzeit-titel' }, SLOT_NAMEN[slot]) : null,
        imSlot.map(eintragZeile),
        el('button', {
          type: 'button',
          class: 'leer-slot',
          'aria-label': `${wochentagLang(datum)}, ${SLOT_NAMEN[slot]}: Gericht planen`,
          dataset: { fokus: `plus:${datum}:${slot}` },
          onclick: () => planen(datum, slot),
        }, symbol(SYMBOLE.plus), imSlot.length ? 'Weiteres Gericht' : 'Gericht planen')));
    }
    return karte;
  }

  async function zeichne() {
    const nummer = ++renderNummer;
    const [e, alleRezepte, plan] = await Promise.all([db.holeEinstellungen(), db.alle('recipes'), db.alle('planEntries')]);
    if (nummer !== renderNummer) return;
    einst = { ...e, mahlzeiten: Array.isArray(e.mahlzeiten) && e.mahlzeiten.length ? e.mahlzeiten : ['abend'] };
    rezepte = new Map(alleRezepte.map((r) => [r.id, r]));
    const heuteKey = heute();
    const start = wochenstart(angefragt || heuteKey, einst.wochenstart);
    const tage = wochentage(start);
    const ende = tage[6];
    const dieseWoche = start === wochenstart(heuteKey, einst.wochenstart);
    const inWoche = plan
      .filter((p) => p.date >= start && p.date <= ende)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    // Mahlzeiten: eingestellte plus solche, in denen trotzdem etwas geplant ist
    const slotsAnzeige = SLOTS.filter((s) => einst.mahlzeiten.includes(s) || inWoche.some((p) => slotVon(p) === s));
    const mitTitel = slotsAnzeige.length > 1;

    const kopf = el('div', { class: 'woche-kopf' },
      el('button', {
        type: 'button', class: 'icon-knopf', 'aria-label': 'Vorige Woche', dataset: { fokus: 'zurueck' },
        onclick: () => navigiere(`#/woche/${plusTage(start, -7)}`, { ersetzen: true }),
      }, symbol(SYMBOLE.zurueck)),
      el('h2', null, `KW ${kalenderwoche(plusTage(start, 3))} · ${formatZeitraum(start, ende)}`),
      el('button', {
        type: 'button', class: 'icon-knopf', 'aria-label': 'Nächste Woche', dataset: { fokus: 'weiter' },
        onclick: () => navigiere(`#/woche/${plusTage(start, 7)}`, { ersetzen: true }),
      }, symbol(SYMBOLE.weiter)),
      el('button', {
        type: 'button',
        class: 'knopf klein flach',
        'aria-label': dieseWoche ? 'Zum heutigen Tag' : 'Zur aktuellen Woche',
        onclick: () => {
          if (!dieseWoche) {
            navigiere('#/woche', { ersetzen: true });
            return;
          }
          container.querySelector('.tag.heute')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, 'Heute'));

    // Automatisch planen ab dem gezeigten Wochenanfang (der Planer beginnt frühestens heute); leere Woche: großer Hinweis
    const planerKnopf = (art) => el('button', {
      type: 'button', class: ['knopf', art], dataset: { fokus: 'planer' },
      onclick: () => navigiere(`#/planer?start=${start < heuteKey ? heuteKey : start}`),
    }, symbol(SYMBOLE.automatisch), 'Automatisch planen');
    let planer = null;
    if (ende >= heuteKey) {
      planer = inWoche.length
        ? el('div', { class: 'leiste woche-planer' }, planerKnopf('klein'))
        : el('div', { class: 'karte woche-leer' },
          el('p', { class: 'fett' }, 'Noch nichts geplant.'),
          el('p', { class: 'nebentext' }, 'Lass dir die Woche vorschlagen – passend zu euren Vorlieben, mit Einkaufsliste und geschätzten Kosten. Oder tippe unten bei einem Tag auf „Gericht planen“.'),
          planerKnopf('primaer'));
    }

    const geplant = inWoche.filter((p) => p.recipeId).length;
    const fuss = el('div', { class: 'stapel' },
      el('button', {
        type: 'button',
        class: 'knopf gross primaer',
        onclick: () => navigiere(`#/einkauf?von=${start}&bis=${ende}`),
      }, symbol(SYMBOLE.korb), 'Einkaufsliste für diese Woche'),
      el('p', { class: 'nebentext mittig' }, geplant
        ? `${geplant} ${geplant === 1 ? 'Gericht' : 'Gerichte'} mit Rezept in dieser Woche.`
        : 'Noch keine Gerichte mit Rezept in dieser Woche.'));

    const fokus = merkeFokus(container);
    container.replaceChildren(
      kopf,
      ...(planer ? [planer] : []),
      ...tage.map((d) => tagKarte(d, inWoche.filter((p) => p.date === d), slotsAnzeige, mitTitel, heuteKey)),
      fuss,
    );
    stelleFokusHer(container, fokus);
  }

  async function zeichneSicher() {
    try {
      await zeichne();
    } catch (e) {
      console.error(e);
      container.replaceChildren(fehlerAnzeige('Der Wochenplan konnte nicht geladen werden.', e));
    }
  }

  await zeichne();
  // Angefragter Tag mitten in der Woche (z. B. Start eines übernommenen Plans): gleich dorthin scrollen
  if (angefragt && einst && angefragt !== wochenstart(angefragt, einst.wochenstart)) {
    container.querySelector(`[data-tag="${angefragt}"]`)?.scrollIntoView({ block: 'start' });
  }
  const abmelden = db.beobachte(({ store } = {}) => {
    if (!BEOBACHTETE.has(store)) return;
    clearTimeout(timer);
    timer = setTimeout(zeichneSicher, 100);
  });
  return () => {
    abmelden();
    clearTimeout(timer);
    renderNummer += 1;
  };
}
