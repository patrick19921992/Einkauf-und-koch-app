// Kochmodus (#/kochen/<id>?p=<portionen>&plan=<planEntryId>): ein Schritt groß im Vollbild,
// Bildschirm bleibt an, Vorlesen, Timer mit Alarm, Wischen und Pfeiltasten.

import { el, symbol, SYMBOLE, setzeTitel, toast, bestaetige, navigiere, zurueck } from './app.js';
import * as db from './db.js';
import { heute } from './datum.js';
import { skaliere, formatZutat } from './zutaten.js';
import { findeTimer } from './rezept-import.js';

const RAND_PX = 32;                 // Wischen am Rand gehört der System-Zurück-Geste
const WISCH_PX = 60;
const ALTE_TIMER_MS = 3 * 3600000;  // so lange abgelaufene Timer werden beim Öffnen verworfen
const TIMER_HINWEIS = 'Timer klingeln nur, solange die App offen und der Bildschirm an ist.';
const VIBRATION = [400, 200, 400, 200, 400];
// Abkürzung samt Punkt ersetzen; war der Punkt zugleich Satzende, bleibt er (Pause beim Vorlesen)
const abk = (wort) => (treffer, ...rest) => {
  const [pos, text] = rest.slice(-2);
  return wort + (treffer.endsWith('.') && /^(?:\s*$|\s+[A-ZÄÖÜ])/.test(text.slice(pos + treffer.length)) ? '.' : '');
};
// Abkürzungen, die die Sprachausgabe sonst buchstabiert
const SPRECHEN = [[/\bEL\b/g, 'Esslöffel'], [/\bTL\b/g, 'Teelöffel'],
  [/(?<![\d,.])1\s?[Mm]in\b\.?/g, abk('1 Minute')], [/(?<![\d,.])1\s?Std\b\.?/g, abk('1 Stunde')],
  [/\b[Mm]in\b\.?/g, abk('Minuten')], [/\bStd\b\.?/g, abk('Stunden')],
  [/\bca\./gi, 'circa'], [/\bevtl\./gi, 'eventuell'], [/\bz\.\s?B\./g, 'zum Beispiel'], [/\bPck\./g, 'Packung'],
  [/(\d)\s?°\s?C?\b/g, '$1 Grad'], [/(\d)\s?g\b/g, '$1 Gramm'], [/(\d)\s?kg\b/g, '$1 Kilogramm'], [/(\d)\s?ml\b/g, '$1 Milliliter'],
  [/(\d)\s?[-–]\s?(\d)/g, '$1 bis $2']];

// Schritt merken, solange der Tab offen ist (ohne sessionStorage geht es von vorn los)
const schluessel = (id) => `ekapp-koch-${id}`;
function leseSchritt(id) {
  try { return Math.max(0, Number.parseInt(sessionStorage.getItem(schluessel(id)), 10) || 0); } catch { return 0; }
}
function merkeSchritt(id, wert) {
  try { if (wert == null) sessionStorage.removeItem(schluessel(id)); else sessionStorage.setItem(schluessel(id), String(wert)); } catch { /* egal */ }
}

/** Restzeit als 'mm:ss' bzw. 'h:mm:ss'. */
function restText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const zz = (n) => String(n).padStart(2, '0');
  return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${zz(Math.floor((s % 3600) / 60))}:${zz(s % 60)}`;
}

/** Zutat in Mengen-Spalte und Rest teilen (wie in der Rezept-Ansicht). */
function zutatSpalten(z) {
  const voll = formatZutat(z) || String(z?.raw ?? '');
  const name = [String(z?.name ?? '').trim(), z?.note ? `(${z.note})` : ''].filter(Boolean).join(' ');
  if (name && voll.length > name.length && voll.endsWith(name)) return { menge: voll.slice(0, -name.length).trim(), name };
  return { menge: '', name: voll };
}

/** Text in Sätze (≤ 180 Zeichen) für die Sprachausgabe – lange Äußerungen bricht Chrome ab. */
function saetze(text) {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim();
  for (const [muster, ersatz] of SPRECHEN) t = t.replace(muster, ersatz);
  return t.split(/(?<=[.!?;:])\s+/).reduce((teile, satz) => {
    if (teile.length && `${teile.at(-1)} ${satz}`.length <= 180) teile[teile.length - 1] += ` ${satz}`;
    else if (satz) teile.push(satz);
    return teile;
  }, []);
}

/** Deutsche Stimme: gewählte, sonst lokale de-DE, sonst irgendeine deutsche. */
function waehleStimme(sprache, wunsch) {
  const stimmen = sprache?.getVoices() || [];
  const deutsch = stimmen.filter((v) => /^de(?:[-_]|$)/i.test(v.lang || ''));
  const deDE = (v) => /^de[-_]DE$/i.test(v.lang);
  return (wunsch && stimmen.find((v) => v.voiceURI === wunsch || v.name === wunsch)) ||
    deutsch.find((v) => deDE(v) && v.localService) || deutsch.find(deDE) || deutsch[0] || null;
}

/** Navigation API: { eigen: Schlüssel dieses Eintrags, vorher: Hash des vorherigen Eintrags der App | null } oder null. */
function verlaufsLage() {
  const nav = globalThis.navigation;
  try {
    const vorher = nav.currentEntry.index > 0 ? nav.entries()[nav.currentEntry.index - 1] : null;
    return { eigen: nav.currentEntry.key, vorher: vorher?.sameDocument && vorher.url ? new URL(vorher.url).hash : null };
  } catch {
    return null; // Browser ohne Navigation API
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Ersetzt den Inhalt; null/false werden ausgelassen
const fuelle = (ziel, ...kinder) => ziel.replaceChildren(...kinder.flat(Infinity).filter((k) => k != null && typeof k !== 'boolean'));
const knopf = (klasse, onclick, ...inhalt) => el('button', { type: 'button', class: ['knopf', klasse], onclick }, ...inhalt);

/** Piepton (WebAudio, 880 Hz) und Vibration. Der AudioContext entsteht erst bei einer Berührung. */
function wecker() {
  let ak = null;
  let takt = null;
  const audio = () => {
    const AK = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!ak && AK) try { ak = new AK(); } catch { ak = null; }
    if (ak?.state === 'suspended') ak.resume().catch(() => {});
    return ak;
  };
  const piep = (abstand = 0, dauer = 0.25) => {
    const a = audio();
    if (!a || a.state === 'closed') return;
    const t = a.currentTime + abstand;
    const osz = new OscillatorNode(a, { type: 'square', frequency: 880 });
    const laut = new GainNode(a, { gain: 0 });
    laut.gain.setTargetAtTime(0.35, t, 0.004); // weiche Flanken, kein Knacken
    laut.gain.setTargetAtTime(0, t + dauer - 0.02, 0.004);
    osz.connect(laut).connect(a.destination);
    osz.start(t);
    osz.stop(t + dauer + 0.03);
  };
  const aus = () => { clearInterval(takt); takt = null; navigator.vibrate?.(0); };
  return {
    freischalten: audio,
    aus,
    laeuft: () => !!takt,
    testen() { [0, 0.5, 1].forEach((s) => piep(s)); navigator.vibrate?.([200, 100, 200]); },
    an() { // 0,25 s Ton, 0,25 s Pause; Vibration alle 2,5 s
      let n = 0;
      const schlag = () => { piep(); if (n++ % 5 === 0) navigator.vibrate?.(VIBRATION); };
      if (!takt) { schlag(); takt = setInterval(schlag, 500); }
    },
    schliessen() { aus(); ak?.close().catch(() => {}); ak = null; },
  };
}

/** Bildschirm wach halten (Wake Lock); `melden(an)` bei jeder Änderung. */
function wachhaltung(melden) {
  let sperre = null;
  let gewuenscht = false;
  let laeuft = false;
  const an = () => !!sperre && !sperre.released;
  async function anfordern() {
    if (!gewuenscht || an() || laeuft) return;
    laeuft = true;
    try {
      if (navigator.wakeLock?.request && document.visibilityState === 'visible') {
        const s = await navigator.wakeLock.request('screen');
        if (gewuenscht) { sperre = s; s.addEventListener('release', () => melden(an())); } else s.release().catch(() => {});
      }
    } catch { /* z. B. Energiesparmodus */ }
    laeuft = false;
    melden(an());
  }
  return {
    anfordern,
    gewuenscht: () => gewuenscht,
    starten() { gewuenscht = true; return anfordern(); },
    freigeben() { gewuenscht = false; sperre?.release().catch(() => {}); sperre = null; },
  };
}

export async function zeige(container, route) {
  const id = route.teile[1];
  const rezeptHash = `#/rezept/${encodeURIComponent(id)}`;
  const lage = verlaufsLage(); // vor dem ersten Dialog lesen (Dialoge legen eigene Einträge an)
  const [rezept, einstellungen] = await Promise.all([db.hole('recipes', id), db.holeEinstellungen()]);
  const koch = el('div', { class: 'koch' });
  container.append(koch);
  const schliessKnopf = (onclick) => el('button', { type: 'button', class: 'icon-knopf', 'aria-label': 'Kochmodus verlassen', onclick },
    symbol(SYMBOLE.schliessen));
  if (!rezept) {
    setzeTitel('Kochmodus');
    fuelle(koch, el('div', { class: 'koch-kopf' }, schliessKnopf(() => zurueck())), el('div', { class: 'leer' },
      el('p', null, 'Dieses Rezept gibt es nicht (mehr).'), knopf('primaer', () => navigiere('#/rezepte', { ersetzen: true }), 'Zur Rezeptliste')));
    return undefined;
  }

  setzeTitel(`Kochen: ${rezept.title || 'Rezept'}`);
  const p = Number.parseInt(route.query.get('p'), 10);
  const portionen = p > 0 && p < 100 ? p : (rezept.servings || einstellungen.standardPortionen || 4);
  const portionenText = `${portionen} ${portionen === 1 ? 'Portion' : 'Portionen'}`;
  const schritte = (rezept.steps || []).filter((s) => String(s?.text ?? '').trim());
  const sprache = globalThis.speechSynthesis || null;
  const ton = wecker();
  const wachAnzeige = el('span', { class: 'wachhalten aus' }, 'Bildschirm kann ausgehen');
  const wach = wachhaltung((an) => {
    wachAnzeige.textContent = an ? 'Bildschirm bleibt an' : 'Bildschirm kann ausgehen';
    wachAnzeige.classList.toggle('aus', !an);
  });
  let phase = 'start';               // 'start' | 'schritt' | 'fertig'
  let index = Math.min(leseSchritt(id), Math.max(0, schritte.length - 1));
  let aktiv = true;
  let vorleseNr = 0;
  let timer = [];                    // Timer dieses Rezepts aus dem Speicher 'timers'
  const timerKnoten = new Map();     // id → { pille, rest }
  const quittiert = new Set();       // ids, deren Alarm schon ausgeschaltet wurde
  const abgehakt = new Set();        // bereitgestellte Zutaten (solange die Seite offen ist)

  // ---------------------------------------------------------------- feste Bausteine
  const zaehler = el('div', { class: 'koch-zaehler', 'aria-live': 'polite' });
  const balken = el('span');
  const fortschritt = el('div', { class: 'fortschritt', 'aria-hidden': 'true' }, balken);
  const gruppe = el('div', { class: 'koch-gruppe' });
  const schrittText = el('div', { class: 'koch-schritt' });
  const timerLeiste = el('div', { class: 'timer-leiste', 'aria-label': 'Laufende Timer' });
  const timerHinweis = el('p', { class: 'nebentext versteckt', style: { flexBasis: '100%' } }, TIMER_HINWEIS);
  const werkzeuge = el('div', { class: 'koch-werkzeuge' });
  const vorlesKnopf = el('button', { type: 'button', class: 'knopf', 'aria-pressed': 'false', onclick: () => umschaltenVorlesen() },
    symbol(SYMBOLE.lautsprecher), 'Vorlesen');
  const zutatenKlappe = el('details', { class: 'koch-zutaten' });
  const zurueckKnopf = knopf('', () => zurueckSchritt());
  const weiterKnopf = knopf('primaer', () => weiter());
  const alarmText = el('p', { class: 'nebentext' });
  const ausKnopf = knopf('', () => alarmQuittieren(), 'Aus');
  const alarm = el('div', { class: 'alarm-overlay versteckt', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Timer abgelaufen' },
    el('div', null, 'Zeit ist um!'), alarmText, ausKnopf);
  container.append(alarm);
  const alarmOffen = () => !alarm.classList.contains('versteckt');

  function kopf(text) {
    zaehler.textContent = text;
    return el('div', { class: 'koch-kopf' }, schliessKnopf(() => verlassen()), zaehler, wach.gewuenscht() ? wachAnzeige : null);
  }

  // Skalierte Zutaten zum Abhaken (Startbildschirm und Zutaten-Klappe teilen den Zustand)
  function zutatenListe() {
    const zutaten = (rezept.ingredients || []).filter(Boolean);
    if (!zutaten.length) return [el('p', { class: 'nebentext' }, 'Keine Zutaten eingetragen.')];
    const faktor = rezept.servings ? portionen / rezept.servings : 1;
    const knoten = [];
    let aktGruppe = null;
    let liste = null;
    zutaten.forEach((z, i) => {
      if (!liste || (z.group || null) !== aktGruppe) {
        aktGruppe = z.group || null;
        if (aktGruppe) knoten.push(el('h3', { class: 'zutat-gruppe' }, aktGruppe));
        knoten.push((liste = el('ul', { class: 'zutaten-liste' })));
      }
      const k = z.id ?? `z${i}`;
      const { menge, name } = zutatSpalten(faktor === 1 ? z : skaliere(z, faktor));
      const zeile = el('li', { class: ['zutat', abgehakt.has(k) && 'gedimmt'] });
      const box = el('input', { type: 'checkbox', checked: abgehakt.has(k), onchange: () => {
        if (box.checked) abgehakt.add(k); else abgehakt.delete(k);
        zeile.classList.toggle('gedimmt', box.checked);
      } });
      zeile.append(el('label', { class: 'checkbox' }, box, el('span', { class: 'menge' }, menge), el('span', null, name)));
      liste.append(zeile);
    });
    return knoten;
  }

  // ---------------------------------------------------------------- Bildschirme
  function zeigeStart() {
    phase = 'start';
    stoppeVorlesen();
    const fortsetzen = index > 0 && index < schritte.length;
    fuelle(koch, kopf('Kochmodus'),
      el('div', { class: 'koch-start' },
        el('h2', null, rezept.title || 'Ohne Titel'),
        el('p', { class: 'meta' }, el('span', { class: 'badge gruen' }, portionenText),
          schritte.length ? el('span', null, `${schritte.length} Schritte`) : null),
        el('h3', { class: 'zutat-gruppe' }, 'Zutaten bereitstellen'),
        zutatenListe(),
        schritte.length
          ? el('p', { class: 'nebentext' }, 'Weiter geht es mit den Knöpfen unten, durch Wischen oder mit den Pfeiltasten.')
          : el('p', { class: 'hinweis warnung' }, 'Für dieses Rezept sind keine Zubereitungsschritte eingetragen.'),
        el('div', { class: 'hinweis' }, el('p', null, `${TIMER_HINWEIS} Stell die Lautstärke hoch und prüfe den Ton einmal.`),
          el('div', { class: 'leiste' }, knopf('klein', () => ton.testen(), symbol(SYMBOLE.lautsprecher), 'Ton testen'))),
        fortsetzen ? knopf('flach voll', () => { index = 0; starte(); }, 'Von vorn beginnen') : null),
      timerLeiste,
      el('div', { class: 'koch-navi' }, schritte.length
        ? knopf('primaer', () => starte(), symbol(SYMBOLE.kochen), fortsetzen ? `Weiter bei Schritt ${index + 1}` : 'Kochmodus starten')
        : knopf('primaer', () => navigiere(`#/rezept/${encodeURIComponent(id)}/bearbeiten`), symbol(SYMBOLE.bearbeiten), 'Rezept bearbeiten')));
  }

  // Start per Berührung: nur hier dürfen Wake Lock, Ton und Vibration freigeschaltet werden
  function starte() {
    wach.starten();
    ton.freischalten();
    sprache?.getVoices(); // Stimmen vorladen
    fuelle(zutatenKlappe, el('summary', null, `Zutaten · ${portionenText}`), el('div', null, zutatenListe()));
    zeigeSchritt(index);
  }
  function zeigeSchritt(i) {
    phase = 'schritt';
    index = Math.max(0, Math.min(schritte.length - 1, i));
    merkeSchritt(id, index);
    const s = schritte[index];
    const letzter = index === schritte.length - 1;
    gruppe.textContent = s.group || '';
    gruppe.classList.toggle('versteckt', !s.group);
    schrittText.textContent = s.text;
    balken.style.width = `${((index + 1) / schritte.length) * 100}%`;
    let erkannt = [];
    try { erkannt = findeTimer(s.text) || []; } catch (e) { console.warn(e); }
    fuelle(werkzeuge, sprache ? vorlesKnopf : null,
      erkannt.map((t) => knopf('', () => starteTimer(t.label, t.sekunden), symbol(SYMBOLE.uhr), t.label)), timerHinweis);
    fuelle(zurueckKnopf, symbol(SYMBOLE.zurueck), index === 0 ? 'Übersicht' : 'Zurück');
    fuelle(weiterKnopf, letzter ? 'Fertig' : 'Weiter', symbol(letzter ? SYMBOLE.haken : SYMBOLE.weiter));
    fuelle(koch, kopf(`Schritt ${index + 1} / ${schritte.length}`), fortschritt, gruppe, schrittText,
      timerLeiste, werkzeuge, zutatenKlappe, el('div', { class: 'koch-navi' }, zurueckKnopf, weiterKnopf));
    schrittText.scrollTop = 0;
    stoppeVorlesen();
    if (einstellungen.autoVorlesen) lies(s.text);
  }

  async function zeigeFertig() {
    phase = 'fertig';
    stoppeVorlesen();
    merkeSchritt(id, null);
    balken.style.width = '100%';
    const box = el('div', { class: 'koch-start' }, el('h2', null, 'Fertig – guten Appetit!'), el('p', { class: 'nebentext' }, rezept.title || ''));
    fuelle(koch, kopf('Fertig'), fortschritt, box, timerLeiste, el('div', { class: 'koch-navi' },
      knopf('', () => zeigeSchritt(schritte.length - 1), symbol(SYMBOLE.zurueck), 'Letzter Schritt'),
      knopf('primaer', () => zumRezept(), 'Zurück zum Rezept')));
    // Plan-Eintrag aus ?plan=…, sonst der heutige, noch nicht gekochte Eintrag dieses Rezepts
    const planId = route.query.get('plan');
    const eintrag = await (planId ? db.hole('planEntries', planId)
      : db.alle('planEntries').then((l) => l.find((e) => e.recipeId === id && e.date === heute() && !e.cooked))).catch(() => null);
    if (!aktiv || phase !== 'fertig' || !eintrag) return;
    const erledigt = () => el('p', { class: 'hinweis erfolg' }, 'Im Wochenplan als gekocht markiert.');
    const markieren = knopf('primaer gross', async () => {
      markieren.disabled = true;
      await db.speichere('planEntries', { ...((await db.hole('planEntries', eintrag.id)) || eintrag), cooked: true })
        .then(() => markieren.replaceWith(erledigt()), (e) => { markieren.disabled = false; toast(`Speichern hat nicht geklappt: ${e.message || e}`); });
    }, symbol(SYMBOLE.haken), 'Als gekocht markieren');
    box.append(eintrag.cooked ? erledigt() : markieren);
  }

  function weiter() {
    if (phase !== 'schritt') return;
    wach.anfordern(); // falls das System die Sperre aufgehoben hat
    if (index + 1 < schritte.length) zeigeSchritt(index + 1); else zeigeFertig();
  }
  function zurueckSchritt() {
    wach.anfordern();
    if (phase === 'fertig') zeigeSchritt(schritte.length - 1);
    else if (phase === 'schritt') { if (index > 0) zeigeSchritt(index - 1); else zeigeStart(); }
  }
  async function verlassen() {
    if (phase !== 'start') {
      const ok = await bestaetige(timer.some((t) => !quittiert.has(t.id))
        ? 'Laufende Timer klingeln erst wieder, wenn du den Kochmodus erneut öffnest.'
        : 'Dein Schritt bleibt gemerkt, du kannst später weitermachen.',
      { titel: 'Kochmodus verlassen?', ja: 'Verlassen', nein: 'Weiterkochen' });
      if (!ok) return;
    }
    if (aktiv) zurueckOder(lage?.vorher);
  }
  // Kam der Kochmodus vom Rezept, geht es im Verlauf zurück (kein doppelter Eintrag)
  const zumRezept = () => zurueckOder(lage?.vorher?.split('?')[0] === rezeptHash);

  // Zurück zur vorherigen Seite der App (klappt auch nach Neuladen), sonst zum Rezept statt zur Liste
  async function zurueckOder(imVerlauf) {
    if (imVerlauf === undefined) return void zurueck(); // Browser ohne Navigation API
    if (!imVerlauf) return void navigiere(rezeptHash, { ersetzen: true });
    // erst warten, bis ein Dialog seinen eigenen Verlaufseintrag wieder abgebaut hat
    for (let i = 0; i < 20 && navigation.currentEntry?.key !== lage.eigen; i++) await pause(50);
    if (aktiv) { if (navigation.currentEntry?.key === lage.eigen) history.back(); else zurueck(); }
  }

  // ---------------------------------------------------------------- Timer
  function zeichneTimer() {
    timerKnoten.clear();
    fuelle(timerLeiste, timer.filter((t) => !quittiert.has(t.id)).map((t) => {
      const rest = el('span', { class: 'fett' });
      const pille = el('div', { class: 'timer', role: 'timer' }, el('span', null, t.label), rest,
        el('button', { type: 'button', class: 'icon-knopf', 'aria-label': `Timer ${t.label} stoppen`, onclick: () => stoppeTimer(t) },
          symbol(SYMBOLE.schliessen)));
      timerKnoten.set(t.id, { pille, rest });
      return pille;
    }));
    timerHinweis.classList.toggle('versteckt', timerKnoten.size === 0);
    tick();
  }

  // Jede Sekunde: Restzeiten anzeigen, abgelaufene Timer melden (Alarm bis „Aus“)
  function tick() {
    if (!aktiv) return;
    const jetzt = Date.now();
    for (const t of timer) {
      const k = timerKnoten.get(t.id);
      k?.pille.classList.toggle('fertig', t.endsAt <= jetzt);
      if (k) k.rest.textContent = t.endsAt <= jetzt ? 'fertig' : restText(t.endsAt - jetzt);
    }
    const klingeln = timer.filter((t) => !quittiert.has(t.id) && t.endsAt <= jetzt);
    if (klingeln.length) {
      alarmText.textContent = klingeln.map((t) => t.label).join(' · ');
      if (!alarmOffen()) { alarm.classList.remove('versteckt'); stoppeVorlesen(); ausKnopf.focus(); }
      ton.an();
    } else if (alarmOffen() || ton.laeuft()) {
      alarm.classList.add('versteckt');
      ton.aus();
    }
  }

  async function ladeTimer(erstesMal = false) {
    let liste = (await db.alle('timers')).filter((t) => t.recipeId === id && Number.isFinite(t.endsAt));
    const alt = erstesMal ? liste.filter((t) => t.endsAt < Date.now() - ALTE_TIMER_MS) : []; // uralte still verwerfen
    alt.forEach((t) => db.entferne('timers', t.id).catch(() => {}));
    liste = liste.filter((t) => !alt.includes(t));
    if (!aktiv) return;
    timer = liste.sort((a, b) => a.endsAt - b.endsAt);
    zeichneTimer();
  }
  async function starteTimer(label, sekunden) {
    ton.freischalten(); // Tippen auf den Timer schaltet den Ton frei
    const name = `Schritt ${index + 1} · ${label}`;
    if (timer.some((t) => t.label === name && !quittiert.has(t.id) && t.endsAt > Date.now())) return void toast('Dieser Timer läuft schon.');
    const neu = await db.speichere('timers', { recipeId: id, schritt: index, label: name, endsAt: Date.now() + sekunden * 1000 })
      .catch((e) => void toast(`Timer konnte nicht gestartet werden: ${e.message || e}`));
    if (!neu || !aktiv) return;
    timer = [...timer.filter((t) => t.id !== neu.id), neu].sort((a, b) => a.endsAt - b.endsAt);
    zeichneTimer();
  }

  // Stoppen (×) bzw. „Aus“ beim Alarm: Timer endgültig entfernen
  function stoppeTimer(...liste) {
    for (const t of liste) quittiert.add(t.id);
    zeichneTimer();
    return Promise.all(liste.map((t) => db.entferne('timers', t.id).catch(() => {})));
  }
  const alarmQuittieren = () => stoppeTimer(...timer.filter((t) => t.endsAt <= Date.now() && !quittiert.has(t.id)));

  // ---------------------------------------------------------------- Vorlesen
  const setzeLiest = (an) => vorlesKnopf.setAttribute('aria-pressed', an ? 'true' : 'false');
  function lies(text) {
    if (!sprache || typeof SpeechSynthesisUtterance === 'undefined') return;
    sprache.cancel();
    const nr = ++vorleseNr;
    const stimme = waehleStimme(sprache, einstellungen.ttsStimme);
    const teile = saetze(text);
    const ende = () => { if (nr === vorleseNr) setzeLiest(false); };
    teile.forEach((satz, i) => sprache.speak(Object.assign(new SpeechSynthesisUtterance(satz), {
      lang: stimme?.lang || 'de-DE', voice: stimme, rate: Number(einstellungen.ttsTempo) || 1, onerror: ende, onend: i === teile.length - 1 ? ende : null,
    })));
    setzeLiest(teile.length > 0);
  }
  function stoppeVorlesen() {
    vorleseNr += 1;
    if (sprache?.speaking || sprache?.pending) sprache.cancel();
    setzeLiest(false);
  }
  function umschaltenVorlesen() {
    if (vorlesKnopf.getAttribute('aria-pressed') === 'true') stoppeVorlesen();
    else if (phase === 'schritt') lies(schritte[index].text);
  }

  // ---------------------------------------------------------------- Gesten, Tasten, Sichtbarkeit
  let wisch = null;
  const beiBeruehrung = (ev) => {
    const t = ev.touches[0];
    wisch = null;
    if (phase === 'start' || ev.touches.length !== 1) return;
    if (t.clientX < RAND_PX || t.clientX > window.innerWidth - RAND_PX) return; // Rand: System-Geste
    if (!ev.target.closest?.('.timer-leiste, input, textarea, select')) wisch = { x: t.clientX, y: t.clientY };
  };
  const beiLoslassen = (ev) => {
    if (!wisch) return;
    const [dx, dy] = [ev.changedTouches[0].clientX - wisch.x, ev.changedTouches[0].clientY - wisch.y];
    wisch = null;
    if (Math.abs(dx) < WISCH_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (alarmOffen() || document.querySelector('dialog[open]')) return;
    if (dx < 0) weiter(); else zurueckSchritt();
  };
  const beiTaste = (ev) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (alarmOffen()) {
      if (['Escape', 'Enter', ' '].includes(ev.key)) { ev.preventDefault(); alarmQuittieren(); }
      return;
    }
    if (phase === 'start' || document.querySelector('dialog[open]') || ev.target.closest?.('input, textarea, select')) return;
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    ev.preventDefault();
    if (ev.key === 'ArrowRight') weiter(); else zurueckSchritt();
  };
  // Wieder sichtbar: Sperre neu anfordern, abgelaufene Timer sofort melden
  const beiSichtbarkeit = () => { if (document.visibilityState === 'visible') { wach.anfordern(); tick(); } };
  const lauscher = [[koch, 'touchstart', beiBeruehrung], [koch, 'touchend', beiLoslassen], [koch, 'touchcancel', () => { wisch = null; }],
    [document, 'keydown', beiTaste], [document, 'visibilitychange', beiSichtbarkeit]];
  for (const [ziel, typ, fn] of lauscher) ziel.addEventListener(typ, fn, { passive: typ.startsWith('touch') });
  // Waagerechtes Wischen blättert Schritte – nicht zusätzlich im Browser-Verlauf (Chrome mit Touch/Touchpad)
  document.documentElement.style.overscrollBehaviorX = 'none';
  let ladeVerzoegerung = null; // Timer-Änderungen (auch aus anderen Tabs) gesammelt nachladen
  const abmelden = db.beobachte(({ store }) => {
    if (store === 'timers') { clearTimeout(ladeVerzoegerung); ladeVerzoegerung = setTimeout(() => ladeTimer().catch(() => {}), 100); }
  });
  const ticker = setInterval(tick, 1000);
  sprache?.getVoices();
  zeigeStart();
  await ladeTimer(true).catch(() => {});

  // Aufräumen: Sperre freigeben, Sprache und Ton beenden, Takte und Lauscher entfernen
  return () => {
    aktiv = false;
    clearInterval(ticker);
    clearTimeout(ladeVerzoegerung);
    abmelden();
    for (const [ziel, typ, fn] of lauscher) ziel.removeEventListener(typ, fn);
    stoppeVorlesen();
    wach.freigeben();
    ton.schliessen();
    alarm.remove();
    document.documentElement.style.overscrollBehaviorX = '';
  };
}
