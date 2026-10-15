// Einkaufsliste der offenen Einkaufsrunde: Zutaten der geplanten Gerichte zusammengefasst und
// nach Abteilungen sortiert, dazu eigene Einträge. Abhaken, Korrekturen (Abteilung, Zusammenführen,
// Vorrat, Ausblenden), Teilen und Abschließen. Alles lokal – funktioniert auch offline.

import {
  el, symbol, SYMBOLE, setzeTitel, toast, dialog, bestaetige, eingabe, auswahl, navigiere, teileText, fehlerAnzeige,
} from './app.js';
import * as db from './db.js';
import { heute, istSchluessel, formatDatum, formatZeitraum } from './datum.js';
import { parseZeile, formatZutat } from './zutaten.js';
import {
  ABTEILUNGEN, sortierteAbteilungen, abteilungEintrag, standardZeitraum, berechneListe, abhakZustand, listeAlsText,
  vorratEintraegeFuer,
} from './einkaufsliste.js';

const ZEITRAEUME = [{ art: 'diese-woche', text: 'Diese Woche' }, { art: 'naechste-woche', text: 'Nächste Woche' },
  { art: 'sieben-tage', text: '7 Tage' }];
const PFEIL_HOCH = 'M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z';
const PFEIL_RUNTER = 'M16.6 8.6 12 13.2 7.4 8.6 6 10l6 6 6-6z';
const BEOBACHTETE = new Set(['recipes', 'planEntries', 'trips', 'shoppingItems', 'aliases', 'settings']);
const SORTIERUNG = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const abteilungsName = (id) => ABTEILUNGEN.find((a) => a.id === id)?.name ?? 'Sonstiges';
const anzahlText = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
const knopf = (klasse, onclick, ...kinder) => el('button', { type: 'button', class: klasse, onclick }, ...kinder);
const feldMit = (text, steuerung) => el('label', { class: 'feld' }, el('span', null, text), steuerung);

/** { von, bis } aus ?von=…&bis=… (vertauscht, falls nötig) oder null. */
function bereichAusQuery(query) {
  const von = query?.get('von');
  const bis = query?.get('bis');
  if (!istSchluessel(von) || !istSchluessel(bis)) return null;
  return von <= bis ? { von, bis } : { von: bis, bis: von };
}

/** Manueller Eintrag aus einer Textzeile ('2 l Milch') oder null. */
function ausText(text) {
  const z = parseZeile(text);
  if (!z || !z.name) return null;
  return { name: z.name, qty: z.qty, qty2: z.qty2, unit: z.unit, note: [z.size, z.note].filter(Boolean).join(', ') || null };
}

// Fokus über das Neuzeichnen hinweg behalten (Bedienelemente tragen data-fokus)
const merkeFokus = (box) => (box.contains(document.activeElement) ? document.activeElement.dataset?.fokus ?? null : null);
function stelleFokusHer(box, schluessel) {
  const ziel = schluessel && [...box.querySelectorAll('[data-fokus]')].find((x) => x.dataset.fokus === schluessel);
  if (ziel && !ziel.disabled) ziel.focus({ preventScroll: true });
}

export async function zeige(container, route) {
  setzeTitel('Einkauf');
  const s = {}; // aktueller Stand: einst, runde, offeneRunden, liste, plan, aliase, zustaende, manuelle
  const offen = { erledigt: false, vorrat: false }; // aufgeklappte Bereiche
  // ?von=…&bis=… gilt einmal; danach ohne Zeitraum im Verlauf, sonst setzte „Zurück“ eine spätere Wahl zurück
  let wunsch = bereichAusQuery(route.query);
  if ((route.query.has('von') || route.query.has('bis')) && location.hash === route.hash) {
    history.replaceState(history.state, '', '#/einkauf');
  }
  let timer = null;
  let ruheBis = 0;
  let laeuft = false;
  let nochmal = false;
  let beendet = false;

  // ------------------------------------------------------------ Grundgerüst (bleibt stehen)
  const feld = el('input', {
    type: 'text', placeholder: 'Hinzufügen, z. B. 2 l Milch', 'aria-label': 'Eintrag hinzufügen',
    autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'enter',
  });
  const formular = el('form', { class: 'einkauf-eingabe', onsubmit: hinzufuegen }, feld,
    el('button', { type: 'submit', class: 'icon-knopf primaer', 'aria-label': 'Hinzufügen' }, symbol(SYMBOLE.plus)));
  const zeitraumBox = el('div', { class: 'zeitraum' });
  const listenBox = el('div', { class: 'stapel' });
  const teilenKnopf = knopf('knopf', teilen, symbol(SYMBOLE.teilen), 'Teilen');
  const abschliessenKnopf = knopf('knopf primaer', abschliessen, symbol(SYMBOLE.haken), 'Einkauf abschließen');
  const aktionen = el('div', { class: 'aktionen-leiste' }, teilenKnopf, knopf('knopf', reihenfolge, 'Reihenfolge'), abschliessenKnopf);
  container.append(formular, zeitraumBox, listenBox, aktionen);

  // ------------------------------------------------------------ Laden + Berechnen
  async function laden() {
    const [einst, rezepte, plan, trips, items, aliasListe] = await Promise.all([db.holeEinstellungen(),
      ...['recipes', 'planEntries', 'trips', 'shoppingItems', 'aliases'].map((store) => db.alle(store))]);
    // offene Runde: die neueste ohne closedAt; sonst neu anlegen
    const offene = trips.filter((t) => t.closedAt == null).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    let runde = offene[0];
    if (!runde) {
      const z = wunsch || standardZeitraum('diese-woche', heute(), einst.wochenstart);
      runde = await db.speichere('trips', { from: z.von, to: z.bis, closedAt: null });
    } else if (wunsch && (wunsch.von !== runde.from || wunsch.bis !== runde.to)) {
      runde = await db.speichere('trips', { ...runde, from: wunsch.von, to: wunsch.bis });
    }
    wunsch = null;
    const manuelle = items.filter((i) => i.kind === 'manual');
    const zustaende = items.filter((i) => i.kind === 'state');
    const aliase = Object.fromEntries(aliasListe.map((a) => [a.id, a]));
    const vorrat = Array.isArray(einst.vorrat) ? einst.vorrat : [];
    const liste = berechneListe({
      planEintraege: plan, rezepte, manuelle, zustaende, aliase, vorrat, runde, reihenfolge: einst.abteilungsReihenfolge,
    });
    Object.assign(s, {
      einst: { ...einst, vorrat }, runde, liste, plan, aliase,
      offeneRunden: new Set([runde.id, ...offene.map((t) => t.id)]),
      zustaende: new Map(zustaende.map((z) => [z.id, z])),
      manuelle: new Map(manuelle.map((m) => [m.id, m])),
    });
  }

  // ------------------------------------------------------------ Darstellung
  function postenZeile(z, { vorrat = false } = {}) {
    const quelle = z.manuell ? z.manuell.note || '' : [...new Set((z.quellen || []).map((q) => q.titel).filter(Boolean))].join(', ');
    // „noch …“ nur, wenn nach dem Abhaken etwas dazukam
    const rest = !z.manuell && !z.erledigt && z.restText && z.restText !== z.text ? z.restText : '';
    const text = el('span', { class: 'posten-text' },
      z.text ? [el('span', { class: 'menge' }, z.text), ' '] : null,
      z.name,
      rest ? el('span', { class: 'rest' }, `noch ${rest}`) : null,
      quelle ? el('span', { class: 'posten-quelle' }, quelle) : null);
    const haken = vorrat ? null : el('input', {
      type: 'checkbox', checked: z.erledigt === true, dataset: { fokus: `h:${z.mergeKey}` },
      onchange: (ev) => abhaken(z, ev.target.checked, ev.target.closest('.posten')),
    });
    return el('li', { class: ['posten', z.erledigt && 'erledigt'] },
      el('label', null, haken, text),
      el('button', {
        type: 'button', class: 'icon-knopf', 'aria-label': `Optionen für ${z.name}`,
        dataset: { fokus: `m:${z.mergeKey}` }, onclick: () => menue(z),
      }, symbol(SYMBOLE.mehr)));
  }

  function klappe(art, titel, ...inhalt) {
    const d = el('details', { class: 'klappe', open: offen[art] }, el('summary', null, titel), ...inhalt);
    d.addEventListener('toggle', () => { offen[art] = d.open; });
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
    if (!liste.abteilungen.length && !liste.erledigt.length && !liste.vorrat.length) {
      teile.push(el('div', { class: 'leer' },
        el('p', null, 'Für diesen Zeitraum steht nichts auf der Liste.'),
        el('p', { class: 'nebentext' }, 'Plane Gerichte in der Woche oder füge oben eigene Einträge hinzu.'),
        el('div', { class: 'leiste' },
          knopf('knopf', () => navigiere(`#/woche/${s.runde.from}`), symbol(SYMBOLE.kalender), 'Zur Woche'))));
    } else if (!liste.abteilungen.length && liste.erledigt.length) {
      teile.push(el('p', { class: 'hinweis erfolg' }, 'Alles erledigt! Du kannst den Einkauf jetzt abschließen.'));
    }
    for (const a of liste.abteilungen) {
      teile.push(el('section', { class: 'abteilung' }, el('h2', null, a.name),
        el('ul', { class: 'liste' }, a.zeilen.map((z) => postenZeile(z)))));
    }
    if (liste.erledigt.length) {
      teile.push(klappe('erledigt', `Erledigt (${liste.erledigt.length})`,
        el('ul', { class: 'liste' }, liste.erledigt.map((z) => postenZeile(z)))));
    }
    if (liste.vorrat.length) {
      teile.push(klappe('vorrat', `Vorrat (${liste.vorrat.length})`,
        el('p', { class: 'nebentext mittig' }, 'Hast du normalerweise zu Hause. Über ⋮ wieder auf die Liste setzen.'),
        el('ul', { class: 'liste' }, liste.vorrat.map((z) => postenZeile(z, { vorrat: true })))));
    }
    // nur Ausgeblendete, die es in diesem Zeitraum noch gibt
    const versteckte = liste.ausgeblendet.map((z) => s.zustaende.get(`${s.runde.id}|${z.mergeKey}`)).filter(Boolean);
    if (versteckte.length) {
      teile.push(el('div', { class: 'leiste mittig' }, knopf('knopf flach klein',
        () => sicher(() => db.speichereViele('shoppingItems', versteckte.map((z) => ({ ...z, versteckt: false })))),
        `Ausgeblendete wieder zeigen (${versteckte.length})`)));
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
      for (const k of [formular, zeitraumBox, aktionen]) k.classList.remove('versteckt');
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
    }
    return undefined;
  }

  // Toast mit „Rückgängig“
  const meldeMitZurueck = (text, zurueck) => toast(text, { aktion: { text: 'Rückgängig', onclick: () => sicher(zurueck) } });

  async function hinzufuegen(ev) {
    ev.preventDefault();
    const neu = ausText(feld.value);
    if (!neu) return;
    feld.value = '';
    feld.focus();
    // section bleibt leer: die Abteilung ergibt sich (mit Korrekturen) beim Berechnen der Liste
    const item = { kind: 'manual', ...neu, section: null, checked: false };
    if (await sicher(() => db.speichere('shoppingItems', item))) {
      toast(`${neu.name} → ${abteilungsName(abteilungEintrag(item, s.aliase || {}))}`, { dauer: 2000 });
    }
  }

  function zustandSpeichern(z, felder) {
    const id = `${s.runde.id}|${z.mergeKey}`;
    return db.speichere('shoppingItems', {
      abgehakt: null, erledigt: false, versteckt: false, ...(s.zustaende.get(id) || {}),
      id, kind: 'state', tripId: s.runde.id, mergeKey: z.mergeKey, ...felder,
    });
  }

  async function abhaken(z, an, zeile) {
    zeile?.classList.toggle('erledigt', an);
    ruheBis = Date.now() + 700;
    await sicher(() => (z.manuell
      ? db.speichere('shoppingItems', { ...(s.manuelle.get(z.manuell.id) || z.manuell), checked: an })
      : zustandSpeichern(z, an ? { ...abhakZustand(z), versteckt: false } : { erledigt: false, abgehakt: null })));
  }

  /** Speichert eine Korrektur (Alias) und liefert die Funktion zum Zurücknehmen. */
  async function speichereAlias(schluessel, felder) {
    const alt = s.aliase[schluessel];
    await db.speichere('aliases', { kanonisch: null, section: null, ...(alt || {}), id: schluessel, ...felder });
    return () => (alt ? db.speichere('aliases', alt) : db.loesche('aliases', schluessel));
  }

  // Gerichte, aus denen die Zeile stammt: 'Gulasch – Mi, 21.10.'
  const herkunft = (z) => dialog({
    titel: z.name,
    inhalt: [
      z.text ? el('p', null, 'Insgesamt: ', el('span', { class: 'menge' }, z.text)) : null,
      el('ul', { class: 'liste' }, [...(z.quellen || [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)))
        .map((q) => el('li', { class: 'listen-eintrag' }, el('span', { class: 'titel' },
          [q.titel || 'Ohne Titel', istSchluessel(q.datum) && formatDatum(q.datum, { wochentag: true })].filter(Boolean).join(' – '))))),
    ],
    knoepfe: [{ text: 'Schließen', wert: true, art: 'primaer' }],
  });

  async function menue(z) {
    const manuell = z.manuell ? s.manuelle.get(z.manuell.id) || z.manuell : null;
    const { liste } = s;
    const andere = manuell ? [] : [...liste.abteilungen.flatMap((a) => a.zeilen), ...liste.erledigt, ...liste.vorrat]
      .filter((x) => !x.manuell && x.mergeKey !== z.mergeKey);
    const verbunden = manuell ? [] : Object.values(s.aliase).filter((a) => a.kanonisch === z.mergeKey);
    const optionen = [
      !manuell && z.quellen?.length
        && { text: 'Herkunft anzeigen', wert: 'herkunft', beschreibung: anzahlText(z.quellen.length, 'Gericht', 'Gerichte') },
      manuell && { text: 'Bearbeiten', wert: 'bearbeiten' },
      { text: 'Abteilung ändern', wert: 'abteilung', beschreibung: `Jetzt: ${abteilungsName(z.abteilung)}` },
      andere.length && { text: 'Zusammenführen mit …', wert: 'zusammen', beschreibung: 'Gleiche Zutat, anderer Name' },
      verbunden.length && { text: 'Zusammenführung aufheben', wert: 'trennen', beschreibung: verbunden.map((a) => a.id).join(', ') },
      !manuell && (z.imVorrat
        ? { text: 'Nicht mehr Vorrat', wert: 'vorrat-weg', beschreibung: 'Wieder auf die Liste setzen' }
        : { text: 'Zum Vorrat', wert: 'vorrat', beschreibung: 'Hast du meistens zu Hause' }),
      !manuell && !z.imVorrat && { text: 'Ausblenden', wert: 'ausblenden', beschreibung: 'Nur für diesen Einkauf' },
      manuell && { text: 'Löschen', wert: 'loeschen' },
    ].filter(Boolean);
    const w = await auswahl(z.name, optionen);
    if (!w) return;
    await sicher(async () => {
      if (w === 'herkunft') await herkunft(z);
      else if (w === 'bearbeiten') await bearbeiten(manuell);
      else if (w === 'abteilung') await abteilungAendern(z, manuell);
      else if (w === 'zusammen') await zusammenfuehren(z, andere);
      else if (w === 'vorrat' || w === 'vorrat-weg') await vorratAendern(z, w === 'vorrat');
      else if (w === 'trennen') {
        for (const a of verbunden) await speichereAlias(a.id, { kanonisch: null });
        toast('Zusammenführung aufgehoben.');
      } else if (w === 'ausblenden') {
        await zustandSpeichern(z, { versteckt: true });
        meldeMitZurueck(`„${z.name}“ ausgeblendet.`, () => zustandSpeichern(z, { versteckt: false }));
      } else if (w === 'loeschen') {
        await db.loesche('shoppingItems', manuell.id);
        meldeMitZurueck(`„${z.name}“ gelöscht.`, () => db.wiederherstellen('shoppingItems', manuell.id));
      }
    });
  }

  async function bearbeiten(item) {
    const text = await eingabe('Eintrag bearbeiten', {
      wert: formatZutat({ qty: item.qty, qty2: item.qty2, unit: item.unit, size: null, name: item.name, note: item.note }),
      pflicht: true, ok: 'Speichern',
    });
    const neu = text ? ausText(text) : null;
    if (neu) await db.speichere('shoppingItems', { ...item, ...neu });
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
    if (ziel) meldeMitZurueck('Zusammengeführt.', await speichereAlias(z.mergeKey, { kanonisch: ziel }));
  }

  async function vorratAendern(z, dazu) {
    const vorher = s.einst.vorrat;
    // weg damit auch Einträge, über die die Zeile zum Vorrat zählt ('salz und pfeffer' → salz, pfeffer)
    const weg = new Set(vorratEintraegeFuer(z.mergeKey, vorher, s.aliase));
    await db.speichereEinstellungen({ vorrat: dazu ? [...new Set([...vorher, z.mergeKey])] : vorher.filter((k) => !weg.has(k)) });
    meldeMitZurueck(dazu ? `„${z.name}“ zählt jetzt zum Vorrat.` : `„${z.name}“ steht wieder auf der Liste.`,
      () => db.speichereEinstellungen({ vorrat: vorher }));
  }

  async function setzeZeitraum(z) {
    if (!z || (z.von === s.runde.from && z.bis === s.runde.to)) return;
    await sicher(() => db.speichere('trips', { ...s.runde, from: z.von, to: z.bis }));
  }

  async function eigenerZeitraum() {
    const [von, bis] = [s.runde.from, s.runde.to].map((wert) => el('input', { type: 'date', value: wert, required: true }));
    // ungültig → undefined: Dialog bleibt offen, Fokus aufs fehlerhafte Feld
    const lesen = () => bereichAusQuery(new URLSearchParams({ von: von.value, bis: bis.value }))
      ?? ([von, bis].find((f) => !istSchluessel(f.value))?.focus(), undefined);
    const w = await dialog({
      titel: 'Zeitraum wählen',
      inhalt: [feldMit('Von', von), feldMit('Bis', bis)],
      knoepfe: [{ text: 'Abbrechen', wert: null, art: 'flach' }, { text: 'Übernehmen', wert: lesen, art: 'primaer' }],
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
    const pfeil = (a, i, r) => el('button', {
      type: 'button', class: 'icon-knopf', 'aria-label': `${a.name} nach ${r < 0 ? 'oben' : 'unten'}`,
      disabled: r < 0 ? i === 0 : i === liste.length - 1, dataset: { fokus: `${a.id}:${r}` }, onclick: () => schiebe(i, r),
    }, symbol(r < 0 ? PFEIL_HOCH : PFEIL_RUNTER));
    const zeichneReihe = () => ul.replaceChildren(...liste.map((a, i) => el('li', { class: 'listen-eintrag' },
      el('span', { class: 'titel' }, a.name), pfeil(a, i, -1), pfeil(a, i, 1))));
    function schiebe(i, r) {
      const j = i + r;
      if (j < 0 || j >= liste.length) return;
      [liste[i], liste[j]] = [liste[j], liste[i]];
      zeichneReihe();
      // Fokus bleibt beim verschobenen Eintrag (am Rand auf dem anderen Pfeil)
      stelleFokusHer(ul, `${liste[j].id}:${r}`);
      if (!ul.contains(document.activeElement)) stelleFokusHer(ul, `${liste[j].id}:${-r}`);
    }
    zeichneReihe();
    const w = await dialog({
      titel: 'Reihenfolge der Abteilungen',
      inhalt: [el('p', { class: 'nebentext' }, 'So, wie du durch deinen Laden gehst.'), ul],
      knoepfe: [
        { text: 'Standard', wert: 'standard', art: 'flach' },
        { text: 'Abbrechen', wert: null, art: 'flach' },
        { text: 'Speichern', wert: 'speichern', art: 'primaer' },
      ],
    });
    if (!w) return;
    await sicher(() => db.speichereEinstellungen({ abteilungsReihenfolge: w === 'speichern' ? liste.map((a) => a.id) : null }));
  }

  async function abschliessen() {
    const { runde, liste } = s;
    const text = liste.anzahlOffen > 0
      ? `Noch ${anzahlText(liste.anzahlOffen, 'Posten', 'Posten')} offen. Zutaten der geplanten Gerichte verschwinden danach `
        + 'von der Liste, offene eigene Einträge bleiben.'
      : 'Die geplanten Gerichte werden als eingekauft markiert, abgehakte eigene Einträge werden entfernt.';
    if (!(await bestaetige(text, { titel: 'Einkauf abschließen?', ja: 'Abschließen' }))) return;
    const eintragIds = new Set(liste.eintraege.map((e) => e.id));
    const erledigte = [...s.manuelle.values()].filter((m) => m.checked);
    // Abhak-Zustände längst abgeschlossener Runden braucht niemand mehr
    const alteZustaende = [...s.zustaende.values()].filter((z) => !s.offeneRunden.has(z.tripId));
    ruheBis = Date.now() + 300;
    const ok = await sicher(async () => {
      // erst Gerichte und Einträge, zuletzt die Runde – so springt die Liste nicht zwischendurch
      await db.speichereViele('planEntries', s.plan.filter((e) => eintragIds.has(e.id)).map((e) => ({ ...e, tripId: runde.id })));
      await db.speichereViele('shoppingItems', [...erledigte, ...alteZustaende].map((m) => ({ ...m, deleted: true })));
      await db.speichere('trips', { ...runde, closedAt: Date.now() });
      return true;
    });
    if (ok) meldeMitZurueck('Einkauf abgeschlossen.', () => abschlussZuruecknehmen(runde, eintragIds, erledigte));
  }

  async function abschlussZuruecknehmen(runde, eintragIds, erledigte) {
    ruheBis = Date.now() + 300;
    // zuerst wieder öffnen, damit beim Zeichnen keine weitere Runde angelegt wird
    await db.speichere('trips', { ...runde, closedAt: null });
    const [trips, plan] = await Promise.all([db.alle('trips'), db.alle('planEntries')]);
    await db.speichereViele('planEntries', plan.filter((e) => eintragIds.has(e.id) && e.tripId === runde.id)
      .map((e) => ({ ...e, tripId: null })));
    for (const m of erledigte) await db.wiederherstellen('shoppingItems', m.id);
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
