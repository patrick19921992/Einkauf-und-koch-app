// Einkaufsliste der offenen Einkaufsrunde: Zutaten der geplanten Gerichte zusammengefasst und
// nach Abteilungen sortiert, dazu eigene Einträge. Abhaken, Korrekturen (Abteilung, Zusammenführen,
// Vorrat, Ausblenden), Teilen und Abschließen. Alles lokal – funktioniert auch offline.

import {
  el, symbol, SYMBOLE, setzeTitel, toast, dialog, bestaetige, eingabe, auswahl, navigiere, teileText, fehlerAnzeige,
} from './app.js';
import * as db from './db.js';
import { heute, istSchluessel, formatDatum, formatZeitraum } from './datum.js';
import { parseZeile, zutatSchluessel, formatZutat } from './zutaten.js';
import {
  ABTEILUNGEN, sortierteAbteilungen, abteilungVon, kanonischerSchluessel, standardZeitraum,
  berechneListe, abhakZustand, listeAlsText,
} from './einkaufsliste.js';

const ZEITRAEUME = [
  { art: 'diese-woche', text: 'Diese Woche' },
  { art: 'naechste-woche', text: 'Nächste Woche' },
  { art: 'sieben-tage', text: '7 Tage' },
];
const PFEIL_HOCH = 'M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z';
const PFEIL_RUNTER = 'M16.6 8.6 12 13.2 7.4 8.6 6 10l6 6 6-6z';
const BEOBACHTETE = new Set(['recipes', 'planEntries', 'trips', 'shoppingItems', 'aliases', 'settings']);
const SORTIERUNG = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const abteilungsName = (id) => ABTEILUNGEN.find((a) => a.id === id)?.name ?? 'Sonstiges';
const anzahlText = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;

/** { von, bis } aus ?von=…&bis=… oder null. */
function bereichAusQuery(query) {
  const von = query?.get('von');
  const bis = query?.get('bis');
  if (!istSchluessel(von) || !istSchluessel(bis)) return null;
  return von <= bis ? { von, bis } : { von: bis, bis: von };
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
  setzeTitel('Einkauf');
  const s = {}; // aktueller Stand: einst, runde, liste, aliase, zustaende, manuelle
  let queryGenutzt = false;
  let timer = null;
  let ruheBis = 0;
  let laeuft = false;
  let nochmal = false;
  let beendet = false;
  let erledigtOffen = false;
  let vorratOffen = false;

  // ------------------------------------------------------------ Grundgerüst (bleibt stehen)
  const feld = el('input', {
    type: 'text', placeholder: 'Hinzufügen, z. B. 2 l Milch', 'aria-label': 'Eintrag hinzufügen',
    autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'enter',
  });
  const formular = el('form', { class: 'einkauf-eingabe', onsubmit: hinzufuegen },
    feld,
    el('button', { type: 'submit', class: 'icon-knopf primaer', 'aria-label': 'Hinzufügen' }, symbol(SYMBOLE.plus)));
  const zeitraumBox = el('div', { class: 'zeitraum' });
  const listenBox = el('div', { class: 'stapel' });
  const teilenKnopf = el('button', { type: 'button', class: 'knopf', onclick: teilen }, symbol(SYMBOLE.teilen), 'Teilen');
  const reihenfolgeKnopf = el('button', { type: 'button', class: 'knopf', onclick: reihenfolge }, 'Reihenfolge');
  const abschliessenKnopf = el('button', { type: 'button', class: 'knopf primaer', onclick: abschliessen },
    symbol(SYMBOLE.haken), 'Einkauf abschließen');
  const aktionen = el('div', { class: 'aktionen-leiste' }, teilenKnopf, reihenfolgeKnopf, abschliessenKnopf);
  container.append(formular, zeitraumBox, listenBox, aktionen);

  // ------------------------------------------------------------ Laden + Berechnen
  async function laden() {
    const [einst, rezepte, plan, trips, items, aliasListe] = await Promise.all([
      db.holeEinstellungen(), db.alle('recipes'), db.alle('planEntries'), db.alle('trips'),
      db.alle('shoppingItems'), db.alle('aliases'),
    ]);
    const wunsch = queryGenutzt ? null : bereichAusQuery(route.query);
    queryGenutzt = true;
    // offene Runde: die neueste ohne closedAt; sonst neu anlegen
    let runde = trips.filter((t) => t.closedAt == null).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (!runde) {
      const z = wunsch || standardZeitraum('diese-woche', heute(), einst.wochenstart);
      runde = await db.speichere('trips', { from: z.von, to: z.bis, closedAt: null });
    } else if (wunsch && (wunsch.von !== runde.from || wunsch.bis !== runde.to)) {
      runde = await db.speichere('trips', { ...runde, from: wunsch.von, to: wunsch.bis });
    }
    const manuelle = items.filter((i) => i.kind === 'manual');
    const zustaende = items.filter((i) => i.kind === 'state');
    const aliase = Object.fromEntries(aliasListe.map((a) => [a.id, a]));
    const vorrat = Array.isArray(einst.vorrat) ? einst.vorrat : [];
    const liste = berechneListe({
      planEintraege: plan, rezepte, manuelle, zustaende, aliase, vorrat, runde, reihenfolge: einst.abteilungsReihenfolge,
    });
    Object.assign(s, {
      einst: { ...einst, vorrat }, runde, liste, aliase, plan,
      zustaende: new Map(zustaende.map((z) => [z.id, z])),
      manuelle: new Map(manuelle.map((m) => [m.id, m])),
    });
  }

  // ------------------------------------------------------------ Darstellung
  function quellText(z) {
    if (z.manuell) return z.manuell.note || '';
    const titel = [...new Set((z.quellen || []).map((q) => q.titel).filter(Boolean))];
    return titel.join(', ');
  }

  function postenZeile(z, { vorrat = false } = {}) {
    const quelle = quellText(z);
    // „noch …“ nur, wenn nach dem Abhaken etwas dazukam
    const offenerRest = !z.manuell && !z.erledigt && z.restText && z.restText !== z.text ? z.restText : '';
    const text = el('span', { class: 'posten-text' },
      z.text ? el('span', { class: 'menge' }, z.text) : null,
      z.text ? ' ' : null,
      z.name,
      offenerRest ? el('span', { class: 'rest' }, `noch ${offenerRest}`) : null,
      quelle ? el('span', { class: 'posten-quelle' }, quelle) : null);
    const haken = vorrat ? null : el('input', {
      type: 'checkbox',
      checked: z.erledigt === true,
      dataset: { fokus: `h:${z.mergeKey}` },
      onchange: (ev) => abhaken(z, ev.target.checked, ev.target.closest('.posten')),
    });
    return el('li', { class: ['posten', z.erledigt && 'erledigt'] },
      el('label', null, haken, text),
      el('button', {
        type: 'button',
        class: 'icon-knopf',
        'aria-label': `Optionen für ${z.name}`,
        dataset: { fokus: `m:${z.mergeKey}` },
        onclick: () => menue(z),
      }, symbol(SYMBOLE.mehr)));
  }

  function klappe(titel, offen, merken, ...inhalt) {
    const d = el('details', { class: 'klappe', open: offen }, el('summary', null, titel), ...inhalt);
    d.addEventListener('toggle', () => merken(d.open));
    return d;
  }

  function zeichneZeitraum() {
    const h = heute();
    const passend = ZEITRAEUME.find((z) => {
      const r = standardZeitraum(z.art, h, s.einst.wochenstart);
      return r.von === s.runde.from && r.bis === s.runde.to;
    });
    const chip = (text, aktiv, fokus, onclick) => el('button', {
      type: 'button', class: ['chip', aktiv && 'aktiv'], 'aria-pressed': String(aktiv), dataset: { fokus }, onclick,
    }, text);
    const gerichte = s.liste.eintraege.filter((e) => e.recipeId).length;
    zeitraumBox.replaceChildren(
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Zeitraum' },
        ZEITRAEUME.map((z) => chip(z.text, passend === z, `z:${z.art}`,
          () => setzeZeitraum(standardZeitraum(z.art, heute(), s.einst.wochenstart)))),
        chip('Anderer …', !passend, 'z:eigen', eigenerZeitraum)),
      el('span', { class: 'nebentext' },
        `${formatZeitraum(s.runde.from, s.runde.to)} · ${anzahlText(gerichte, 'Gericht', 'Gerichte')}`));
  }

  function zeichneListe() {
    const { liste } = s;
    const teile = [];
    const leer = !liste.abteilungen.length && !liste.erledigt.length && !liste.vorrat.length;
    if (leer) {
      teile.push(el('div', { class: 'leer' },
        el('p', null, 'Für diesen Zeitraum steht nichts auf der Liste.'),
        el('p', { class: 'nebentext' }, 'Plane Gerichte in der Woche oder füge oben eigene Einträge hinzu.'),
        el('div', { class: 'leiste' }, el('button', {
          type: 'button', class: 'knopf', onclick: () => navigiere(`#/woche/${s.runde.from}`),
        }, symbol(SYMBOLE.kalender), 'Zur Woche'))));
    } else if (!liste.abteilungen.length && liste.erledigt.length) {
      teile.push(el('p', { class: 'hinweis erfolg' }, 'Alles erledigt! Du kannst den Einkauf jetzt abschließen.'));
    }
    for (const a of liste.abteilungen) {
      teile.push(el('section', { class: 'abteilung' }, el('h2', null, a.name),
        el('ul', { class: 'liste' }, a.zeilen.map((z) => postenZeile(z)))));
    }
    if (liste.erledigt.length) {
      teile.push(klappe(`Erledigt (${liste.erledigt.length})`, erledigtOffen, (o) => { erledigtOffen = o; },
        el('ul', { class: 'liste' }, liste.erledigt.map((z) => postenZeile(z)))));
    }
    if (liste.vorrat.length) {
      teile.push(klappe(`Vorrat (${liste.vorrat.length})`, vorratOffen, (o) => { vorratOffen = o; },
        el('p', { class: 'nebentext mittig' }, 'Hast du normalerweise zu Hause. Über ⋮ wieder auf die Liste setzen.'),
        el('ul', { class: 'liste' }, liste.vorrat.map((z) => postenZeile(z, { vorrat: true })))));
    }
    const versteckte = [...s.zustaende.values()].filter((z) => z.tripId === s.runde.id && z.versteckt);
    if (versteckte.length) {
      teile.push(el('div', { class: 'leiste mittig' }, el('button', {
        type: 'button',
        class: 'knopf flach klein',
        onclick: () => sicher(() => db.speichereViele('shoppingItems', versteckte.map((z) => ({ ...z, versteckt: false })))),
      }, `Ausgeblendete wieder zeigen (${versteckte.length})`)));
    }
    listenBox.replaceChildren(...teile);
    teilenKnopf.disabled = liste.anzahlOffen === 0;
    abschliessenKnopf.disabled = !liste.eintraege.length && !s.manuelle.size;
  }

  async function zeichne() {
    if (laeuft) {
      nochmal = true;
      return;
    }
    laeuft = true;
    try {
      await laden();
      if (beendet) return;
      const fokus = merkeFokus(container);
      zeichneZeitraum();
      zeichneListe();
      stelleFokusHer(container, fokus);
    } catch (e) {
      console.error(e);
      listenBox.replaceChildren(fehlerAnzeige('Die Einkaufsliste konnte nicht geladen werden.', e));
      // ohne geladenen Stand keine Bedienelemente anbieten
      for (const k of [formular, zeitraumBox, aktionen]) k.classList.toggle('versteckt', !s.liste);
    } finally {
      laeuft = false;
      if (nochmal && !beendet) {
        nochmal = false;
        plane(0);
      }
    }
  }

  // Neu zeichnen, gebündelt; nach dem Abhaken kurz warten, damit man das Durchstreichen sieht
  function plane(verzoegerung = 100) {
    clearTimeout(timer);
    timer = setTimeout(zeichne, Math.max(verzoegerung, ruheBis - Date.now()));
  }

  // ------------------------------------------------------------ Aktionen
  async function sicher(arbeit) {
    try {
      return await arbeit();
    } catch (e) {
      console.error(e);
      toast('Speichern hat nicht geklappt.');
      plane(0);
      return undefined;
    }
  }

  async function hinzufuegen(ev) {
    ev.preventDefault();
    const z = parseZeile(feld.value);
    if (!z || !z.name) return;
    feld.value = '';
    feld.focus();
    const note = [z.size, z.note].filter(Boolean).join(', ') || null;
    await sicher(() => db.speichere('shoppingItems', {
      kind: 'manual', name: z.name, qty: z.qty, qty2: z.qty2, unit: z.unit, note, section: null, checked: false,
    }));
    const schluessel = kanonischerSchluessel(zutatSchluessel(z.name), s.aliase || {});
    toast(`${z.name} → ${abteilungsName(abteilungVon(schluessel, s.aliase || {}))}`, { dauer: 2000 });
  }

  function zustandSpeichern(z, felder) {
    const id = `${s.runde.id}|${z.mergeKey}`;
    const alt = s.zustaende.get(id);
    return db.speichere('shoppingItems', {
      abgehakt: null, erledigt: false, versteckt: false, ...(alt || {}),
      id, kind: 'state', tripId: s.runde.id, mergeKey: z.mergeKey, ...felder,
    });
  }

  async function abhaken(z, an, zeile) {
    zeile?.classList.toggle('erledigt', an);
    ruheBis = Date.now() + 700;
    await sicher(() => {
      if (z.manuell) return db.speichere('shoppingItems', { ...(s.manuelle.get(z.manuell.id) || z.manuell), checked: an });
      return zustandSpeichern(z, an ? { ...abhakZustand(z), versteckt: false } : { erledigt: false, abgehakt: null });
    });
  }

  async function speichereAlias(schluessel, felder) {
    const alt = s.aliase[schluessel];
    await db.speichere('aliases', { kanonisch: null, section: null, ...(alt || {}), id: schluessel, ...felder });
    return () => (alt ? db.speichere('aliases', alt) : db.loesche('aliases', schluessel));
  }

  function alleZeilen() {
    const { liste } = s;
    return [...liste.abteilungen.flatMap((a) => a.zeilen), ...liste.erledigt, ...liste.vorrat];
  }

  async function herkunft(z) {
    const quellen = [...(z.quellen || [])].sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));
    await dialog({
      titel: z.name,
      inhalt: [
        z.text ? el('p', null, 'Insgesamt: ', el('span', { class: 'menge' }, z.text)) : null,
        el('ul', { class: 'liste' }, quellen.map((q) => el('li', { class: 'listen-eintrag' },
          el('span', { class: 'haupt' },
            el('span', { class: 'titel' }, q.titel || 'Ohne Titel'),
            istSchluessel(q.datum) ? el('span', { class: 'nebentext' }, formatDatum(q.datum, { wochentag: true })) : null)))),
      ],
      knoepfe: [{ text: 'Schließen', wert: true, art: 'primaer' }],
    });
  }

  async function menue(z) {
    const manuell = z.manuell ? s.manuelle.get(z.manuell.id) || z.manuell : null;
    const andere = manuell ? [] : alleZeilen().filter((x) => !x.manuell && x.mergeKey !== z.mergeKey);
    const zusammengefuehrt = manuell ? [] : Object.values(s.aliase).filter((a) => a.kanonisch === z.mergeKey);
    const optionen = [];
    if (!manuell && z.quellen?.length) {
      optionen.push({ text: 'Herkunft anzeigen', wert: 'herkunft', beschreibung: anzahlText(z.quellen.length, 'Gericht', 'Gerichte') });
    }
    if (manuell) optionen.push({ text: 'Bearbeiten', wert: 'bearbeiten' });
    optionen.push({ text: 'Abteilung ändern', wert: 'abteilung', beschreibung: `Jetzt: ${abteilungsName(z.abteilung)}` });
    if (andere.length) optionen.push({ text: 'Zusammenführen mit …', wert: 'zusammen', beschreibung: 'Gleiche Zutat, anderer Name' });
    if (zusammengefuehrt.length) optionen.push({ text: 'Zusammenführung aufheben', wert: 'trennen' });
    if (!manuell) {
      optionen.push(z.imVorrat
        ? { text: 'Nicht mehr Vorrat', wert: 'vorrat-weg', beschreibung: 'Wieder auf die Liste setzen' }
        : { text: 'Zum Vorrat', wert: 'vorrat', beschreibung: 'Hast du meistens zu Hause' });
      if (!z.imVorrat) optionen.push({ text: 'Ausblenden', wert: 'ausblenden', beschreibung: 'Nur für diesen Einkauf' });
    } else {
      optionen.push({ text: 'Löschen', wert: 'loeschen' });
    }
    const w = await auswahl(z.name, optionen);
    if (!w) return;
    await sicher(async () => {
      if (w === 'herkunft') await herkunft(z);
      else if (w === 'bearbeiten') await bearbeiten(manuell);
      else if (w === 'abteilung') await abteilungAendern(z, manuell);
      else if (w === 'zusammen') await zusammenfuehren(z, andere);
      else if (w === 'trennen') await trennen(z, zusammengefuehrt);
      else if (w === 'vorrat' || w === 'vorrat-weg') await vorratAendern(z, w === 'vorrat');
      else if (w === 'ausblenden') {
        await zustandSpeichern(z, { versteckt: true });
        toast(`„${z.name}“ ausgeblendet.`, {
          aktion: { text: 'Rückgängig', onclick: () => sicher(() => zustandSpeichern(z, { versteckt: false })) },
        });
      } else if (w === 'loeschen') {
        await db.loesche('shoppingItems', manuell.id);
        toast(`„${z.name}“ gelöscht.`, {
          aktion: { text: 'Rückgängig', onclick: () => sicher(() => db.wiederherstellen('shoppingItems', manuell.id)) },
        });
      }
    });
  }

  async function bearbeiten(item) {
    const text = await eingabe('Eintrag bearbeiten', {
      wert: formatZutat({ qty: item.qty, qty2: item.qty2, unit: item.unit, size: null, name: item.name, note: item.note }),
      pflicht: true, ok: 'Speichern',
    });
    const z = text ? parseZeile(text) : null;
    if (!z || !z.name) return;
    const note = [z.size, z.note].filter(Boolean).join(', ') || null;
    await db.speichere('shoppingItems', { ...item, name: z.name, qty: z.qty, qty2: z.qty2, unit: z.unit, note });
  }

  async function abteilungAendern(z, manuell) {
    const id = await auswahl(`Abteilung für „${z.name}“`, sortierteAbteilungen(s.einst.abteilungsReihenfolge)
      .map((a) => ({ text: a.name, wert: a.id, beschreibung: a.id === z.abteilung ? 'aktuell' : undefined })));
    if (!id || id === z.abteilung) return;
    if (manuell) await db.speichere('shoppingItems', { ...manuell, section: id });
    else await speichereAlias(z.mergeKey, { section: id });
    toast(`„${z.name}“ steht jetzt unter ${abteilungsName(id)}.`);
  }

  async function zusammenfuehren(z, andere) {
    const ziel = await auswahl(`„${z.name}“ zusammenführen mit …`, [...andere]
      .sort((a, b) => SORTIERUNG.compare(a.name, b.name))
      .map((x) => ({ text: x.name, wert: x.mergeKey, beschreibung: x.text || undefined })));
    if (!ziel) return;
    const rueckgaengig = await speichereAlias(z.mergeKey, { kanonisch: ziel });
    toast('Zusammengeführt.', { aktion: { text: 'Rückgängig', onclick: () => sicher(rueckgaengig) } });
  }

  async function trennen(z, zusammengefuehrt) {
    const ids = zusammengefuehrt.length === 1 ? [zusammengefuehrt[0].id] : await auswahl('Was soll wieder einzeln stehen?',
      [...zusammengefuehrt.map((a) => ({ text: a.id, wert: [a.id] })), { text: 'Alle', wert: zusammengefuehrt.map((a) => a.id) }]);
    if (!ids) return;
    for (const id of ids) await speichereAlias(id, { kanonisch: null });
    toast('Zusammenführung aufgehoben.');
  }

  async function vorratAendern(z, dazu) {
    const vorher = s.einst.vorrat;
    const neu = dazu ? [...new Set([...vorher, z.mergeKey])] : vorher.filter((k) => k !== z.mergeKey);
    await db.speichereEinstellungen({ vorrat: neu });
    toast(dazu ? `„${z.name}“ zählt jetzt zum Vorrat.` : `„${z.name}“ steht wieder auf der Liste.`, {
      aktion: { text: 'Rückgängig', onclick: () => sicher(() => db.speichereEinstellungen({ vorrat: vorher })) },
    });
  }

  async function setzeZeitraum(z) {
    if (!z || (z.von === s.runde.from && z.bis === s.runde.to)) return;
    await sicher(() => db.speichere('trips', { ...s.runde, from: z.von, to: z.bis }));
  }

  async function eigenerZeitraum() {
    const von = el('input', { type: 'date', value: s.runde.from, required: true });
    const bis = el('input', { type: 'date', value: s.runde.to, required: true });
    const w = await dialog({
      titel: 'Zeitraum wählen',
      inhalt: [el('label', { class: 'feld' }, el('span', null, 'Von'), von), el('label', { class: 'feld' }, el('span', null, 'Bis'), bis)],
      knoepfe: [
        { text: 'Abbrechen', wert: null, art: 'flach' },
        {
          text: 'Übernehmen',
          art: 'primaer',
          wert: () => {
            if (!istSchluessel(von.value)) return von.focus(), undefined;
            if (!istSchluessel(bis.value)) return bis.focus(), undefined;
            return von.value <= bis.value ? { von: von.value, bis: bis.value } : { von: bis.value, bis: von.value };
          },
        },
      ],
    });
    if (w) await setzeZeitraum(w);
  }

  function teilen() {
    const titel = `Einkaufsliste ${formatZeitraum(s.runde.from, s.runde.to)}`;
    teileText(titel, listeAlsText(s.liste, { titel }));
  }

  async function reihenfolge() {
    const liste = sortierteAbteilungen(s.einst.abteilungsReihenfolge).map((a) => ({ id: a.id, name: a.name }));
    const ul = el('ul', { class: 'liste' });
    const zeichneReihe = (fokus) => {
      ul.replaceChildren(...liste.map((a, i) => el('li', { class: 'listen-eintrag' },
        el('span', { class: 'titel' }, a.name),
        el('button', {
          type: 'button', class: 'icon-knopf', 'aria-label': `${a.name} nach oben`, disabled: i === 0,
          dataset: { fokus: `${a.id}:-1` }, onclick: () => schiebe(i, -1),
        }, symbol(PFEIL_HOCH)),
        el('button', {
          type: 'button', class: 'icon-knopf', 'aria-label': `${a.name} nach unten`, disabled: i === liste.length - 1,
          dataset: { fokus: `${a.id}:1` }, onclick: () => schiebe(i, 1),
        }, symbol(PFEIL_RUNTER)))));
      if (fokus) {
        const [id, richtung] = fokus;
        stelleFokusHer(ul, `${id}:${richtung}`);
        if (!ul.contains(document.activeElement)) stelleFokusHer(ul, `${id}:${-richtung}`);
      }
    };
    const schiebe = (i, richtung) => {
      const j = i + richtung;
      if (j < 0 || j >= liste.length) return;
      [liste[i], liste[j]] = [liste[j], liste[i]];
      zeichneReihe([liste[j].id, richtung]);
    };
    zeichneReihe(null);
    const w = await dialog({
      titel: 'Reihenfolge der Abteilungen',
      inhalt: [el('p', { class: 'nebentext' }, 'So, wie du durch deinen Laden gehst.'), ul],
      knoepfe: [
        { text: 'Standard', wert: 'standard', art: 'flach' },
        { text: 'Abbrechen', wert: null, art: 'flach' },
        { text: 'Speichern', wert: 'speichern', art: 'primaer' },
      ],
    });
    if (w === 'speichern') await sicher(() => db.speichereEinstellungen({ abteilungsReihenfolge: liste.map((a) => a.id) }));
    else if (w === 'standard') await sicher(() => db.speichereEinstellungen({ abteilungsReihenfolge: null }));
  }

  async function abschliessen() {
    const { runde, liste } = s;
    const offen = liste.anzahlOffen;
    const text = offen > 0
      ? `Noch ${anzahlText(offen, 'Posten', 'Posten')} offen. Zutaten der geplanten Gerichte verschwinden danach von der Liste, offene eigene Einträge bleiben.`
      : 'Die geplanten Gerichte werden als eingekauft markiert, abgehakte eigene Einträge werden entfernt.';
    if (!(await bestaetige(text, { titel: 'Einkauf abschließen?', ja: 'Abschließen' }))) return;
    const eintragIds = new Set(liste.eintraege.map((e) => e.id));
    const eintraege = s.plan.filter((e) => eintragIds.has(e.id));
    const erledigteManuelle = [...s.manuelle.values()].filter((m) => m.checked);
    ruheBis = Date.now() + 300;
    const ok = await sicher(async () => {
      // erst Gerichte und Einträge, zuletzt die Runde – so springt die Liste nicht zwischendurch
      await db.speichereViele('planEntries', eintraege.map((e) => ({ ...e, tripId: runde.id })));
      await db.speichereViele('shoppingItems', erledigteManuelle.map((m) => ({ ...m, deleted: true })));
      await db.speichere('trips', { ...runde, closedAt: Date.now() });
      return true;
    });
    if (!ok) return;
    toast('Einkauf abgeschlossen.', {
      aktion: { text: 'Rückgängig', onclick: () => sicher(() => abschlussZuruecknehmen(runde, eintragIds, erledigteManuelle)) },
    });
  }

  async function abschlussZuruecknehmen(runde, eintragIds, manuelle) {
    ruheBis = Date.now() + 300;
    // zuerst wieder öffnen, damit beim Zeichnen keine weitere Runde angelegt wird
    await db.speichere('trips', { ...runde, closedAt: null });
    const [trips, plan] = await Promise.all([db.alle('trips'), db.alle('planEntries')]);
    await db.speichereViele('planEntries', plan
      .filter((e) => eintragIds.has(e.id) && e.tripId === runde.id)
      .map((e) => ({ ...e, tripId: null })));
    for (const m of manuelle) await db.wiederherstellen('shoppingItems', m.id);
    for (const t of trips) if (t.closedAt == null && t.id !== runde.id) await db.loesche('trips', t.id);
  }

  // ------------------------------------------------------------ Start
  await zeichne();
  const abmelden = db.beobachte(({ store } = {}) => {
    if (BEOBACHTETE.has(store)) plane(100);
  });
  return () => {
    beendet = true;
    abmelden();
    clearTimeout(timer);
  };
}
