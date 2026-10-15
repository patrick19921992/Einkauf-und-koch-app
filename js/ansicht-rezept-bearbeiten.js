// Rezept anlegen (#/neu), bearbeiten (#/rezept/<id>/bearbeiten) und importieren (#/import):
// Formular mit Live-Vorschau, Laden über den Import-Dienst oder aus eingefügtem Text.

import { el, symbol, SYMBOLE, setzeTitel, kopfAktionen, toast, bestaetige, navigiere, zurueck, holeGeteiltes, fehlerAnzeige } from './app.js';
import * as db from './db.js';
import { parseZeilen, zutatenAlsText } from './zutaten.js';
import { ImportFehler, findeUrl, textOhneUrl, rezeptAusText, ladeRezept, findeTimer } from './rezept-import.js';
import { zutatSpalten, istWebLink, hostVon, nichtGefunden } from './ansicht-rezepte.js';

const KOPF_TITEL = { neu: 'Neues Rezept', bearbeiten: 'Rezept bearbeiten', import: 'Rezept prüfen' };

export async function zeige(container, route) {
  // Aufräum-Funktionen sammeln: der Import wechselt später noch ins Formular
  const aufraeumer = [];
  const aufraeumen = () => aufraeumer.splice(0).reverse().forEach((f) => {
    try { f(); } catch (e) { console.error(e); }
  });
  const [art, id, zusatz] = route.teile;
  if (art === 'import') {
    await zeigeImport(container, route.query, aufraeumer);
  } else if (art === 'rezept' && zusatz === 'bearbeiten') {
    setzeTitel(KOPF_TITEL.bearbeiten);
    const rezept = await db.hole('recipes', id);
    if (rezept) zeigeFormular(container, { rezept, modus: 'bearbeiten', aufraeumer });
    else nichtGefunden(container);
  } else {
    setzeTitel(KOPF_TITEL.neu);
    zeigeFormular(container, { rezept: leeresRezept(await db.holeEinstellungen()), modus: 'neu', aufraeumer });
  }
  return aufraeumen;
}

// ---------------------------------------------------------------- Hilfen

function leeresRezept(einstellungen) {
  return {
    title: '', sourceUrl: '', sourceSite: '', imageUrl: '', servings: einstellungen?.standardPortionen || null,
    prepMin: null, cookMin: null, totalMin: null, tags: [], notes: '', favorite: false, ingredients: [], steps: [],
  };
}

/** '1,5' / '4' → Zahl > 0, sonst null. */
function zahl(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  const n = Number(t);
  return t && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// 'Pasta, schnell,pasta' → ['Pasta', 'schnell'] (ohne Doppelte, höchstens 20)
function tagsAusText(text) {
  const tags = String(text ?? '').split(/[,;]/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return tags.filter((t, i) => tags.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 20);
}

// Überschrift in der Zubereitung? → Name, null (setzt zurück) oder undefined (keine)
function schrittKopf(zeile) {
  let m;
  let t;
  if ((m = zeile.match(/^#{1,6}\s*(.+?)\s*#*$/))) t = m[1];
  else if (zeile.endsWith(':') && zeile.length <= 60 && !/[.!?]/.test(zeile.slice(0, -1)) && !/^\d/.test(zeile)) t = zeile;
  else return undefined;
  t = t.replace(/:+$/, '').trim();
  return !t || /^(?:zubereitung|anleitung|schritte|so geht['’]?s|arbeitsschritte)$/i.test(t) ? null : t;
}

/** Text der Zubereitung → [{ id, group, text }]: ein Schritt pro Zeile, Überschriften enden mit ':'. */
export function parseSchritte(text) {
  const schritte = [];
  let gruppe = null;
  for (const roh of String(text ?? '').split(/\r?\n/)) {
    let zeile = roh.replace(/\s+/g, ' ').trim();
    if (!zeile || /^schritt\s*\d+\s*[:.)]?$/i.test(zeile)) continue;
    const kopf = schrittKopf(zeile);
    if (kopf !== undefined) {
      gruppe = kopf;
      continue;
    }
    zeile = zeile.replace(/^[•*▢☐·–-]\s*/, '').replace(/^(?:schritt\s*)?\d{1,2}\s*[.):]\s+/i, '').trim();
    if (!zeile || /^\d+[.)]?$/.test(zeile)) continue;
    schritte.push({ id: db.neueId(), group: gruppe, text: zeile });
  }
  return schritte;
}

/** Schritte → Text fürs Formular (Umkehrung von parseSchritte, Leerzeile zwischen Schritten). */
export function schritteAlsText(schritte) {
  let text = '';
  let gruppe = null;
  for (const s of schritte || []) {
    const g = s?.group || null;
    if (g !== gruppe) {
      text += `${text ? '\n\n' : ''}${g || 'Zubereitung'}:\n`;
      gruppe = g;
    } else if (text) {
      text += '\n\n';
    }
    text += String(s?.text ?? '').replace(/\s*\n\s*/g, ' ').trim();
  }
  return text;
}

// Vergleichsschlüssel für Quell-Links (ohne www., Abfrage und Schrägstrich am Ende)
function urlSchluessel(url) {
  let u;
  try { u = new URL(String(url ?? '').trim()); } catch { return null; }
  return /^https?:$/.test(u.protocol) ? `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}` : null;
}

async function findeDuplikat(url) {
  const k = url ? urlSchluessel(url) : null;
  if (!k) return null;
  return (await db.alle('recipes')).find((r) => r.sourceUrl && urlSchluessel(r.sourceUrl) === k) || null;
}

function duplikatHinweis(rezept) {
  return el('div', { class: 'hinweis warnung' },
    el('p', null, 'Dieses Rezept hast du schon: ',
      el('a', { href: `#/rezept/${encodeURIComponent(rezept.id)}` }, rezept.title || 'Ohne Titel')));
}

function kuerze(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function feld(beschriftung, steuerung, zusatz = null, style = null) {
  return el('label', { class: 'feld', style }, el('span', null, beschriftung), steuerung,
    zusatz ? el('span', { class: 'nebentext' }, zusatz) : null);
}

// ---------------------------------------------------------------- Formular

function zeigeFormular(container, { rezept, modus, aufraeumer, hinweise = [] }) {
  setzeTitel(KOPF_TITEL[modus]);
  let fertig = false;
  let speichert = false;

  const zahlFeld = (wert, platzhalter, art = 'numeric') => el('input', {
    type: 'number', inputmode: art, min: '0', step: 'any', value: wert ?? '', placeholder: platzhalter,
  });
  const titel = el('input', { type: 'text', value: rezept.title || '', required: true, autocomplete: 'off', enterkeyhint: 'next' });
  const portionen = zahlFeld(rezept.servings, 'z. B. 4', 'decimal');
  const gesamt = zahlFeld(rezept.totalMin, 'Min.');
  const vorb = zahlFeld(rezept.prepMin, 'Min.');
  const koch = zahlFeld(rezept.cookMin, 'Min.');
  const tags = el('input', { type: 'text', value: (rezept.tags || []).join(', '), placeholder: 'z. B. Pasta, schnell, vegetarisch', autocomplete: 'off' });
  const startZutaten = zutatenAlsText(rezept.ingredients || []);
  const zutaten = el('textarea', {
    rows: 10, value: startZutaten, spellcheck: 'false', autocapitalize: 'off',
    placeholder: '500 g Nudeln\n2 Zwiebeln\n\nFür die Soße:\n200 ml Sahne\nSalz und Pfeffer',
  });
  const startSchritte = schritteAlsText(rezept.steps || []);
  const schritte = el('textarea', {
    rows: 10, value: startSchritte,
    placeholder: 'Nudeln in Salzwasser 10 Minuten kochen.\n\nZwiebeln würfeln und anbraten.',
  });
  const notizen = el('textarea', { rows: 4, value: rezept.notes || '' });
  // Quelle darf auch ein freier Hinweis sein (kein type=url)
  const quelle = el('input', {
    type: 'text', inputmode: 'url', value: rezept.sourceUrl || rezept.sourceSite || '',
    placeholder: 'https://… oder z. B. Omas Kochbuch', autocomplete: 'off', autocapitalize: 'off',
  });
  const bild = el('input', { type: 'url', value: rezept.imageUrl || '', placeholder: 'https://…', autocomplete: 'off' });

  // Live-Vorschau der erkannten Zutaten und Schritte
  const zutatenVorschau = el('ul', { class: 'zeilen-vorschau', 'aria-label': 'Erkannte Zutaten' });
  const zutatenInfo = el('p', { class: 'nebentext', 'aria-live': 'polite' });
  const schrittVorschau = el('ol', { class: 'zeilen-vorschau', 'aria-label': 'Erkannte Schritte' });
  const schrittInfo = el('p', { class: 'nebentext', 'aria-live': 'polite' });

  function zeichneZutatenVorschau() {
    const liste = parseZeilen(zutaten.value);
    const knoten = [];
    let gruppe = null;
    let ohneMenge = 0;
    for (const z of liste) {
      if ((z.group || null) !== gruppe && (gruppe = z.group || null)) knoten.push(el('li', { class: 'zeile-kopf' }, gruppe));
      const ok = z.qty != null || z.vague;
      if (!ok) ohneMenge += 1;
      const { menge, name } = zutatSpalten(z);
      knoten.push(el('li', { class: ok ? 'zeile-ok' : 'zeile-warnung' }, el('span', { class: 'menge' }, menge),
        el('span', null, name, ok ? null : el('span', { class: 'nebentext' }, ' – ohne Menge'))));
    }
    zutatenVorschau.replaceChildren(...knoten);
    zutatenVorschau.classList.toggle('versteckt', !knoten.length);
    zutatenInfo.textContent = !liste.length ? 'Noch keine Zutaten erkannt.'
      : `${liste.length === 1 ? '1 Zutat' : `${liste.length} Zutaten`} erkannt${ohneMenge ? ` – ${ohneMenge} ohne Menge (markiert)` : ''}.`;
  }

  function zeichneSchrittVorschau() {
    const liste = parseSchritte(schritte.value);
    const knoten = [];
    let gruppe = null;
    let timerAnzahl = 0;
    liste.forEach((s, i) => {
      if ((s.group || null) !== gruppe && (gruppe = s.group || null)) knoten.push(el('li', { class: 'zeile-kopf' }, gruppe));
      const timer = findeTimer(s.text);
      timerAnzahl += timer.length;
      knoten.push(el('li', null, el('span', { class: 'fett' }, `${i + 1}.`),
        el('span', null, kuerze(s.text, 120), timer.map((t) => [' ', el('span', { class: 'badge grau' }, `Timer ${t.label}`)]))));
    });
    schrittVorschau.replaceChildren(...knoten);
    schrittVorschau.classList.toggle('versteckt', !knoten.length);
    schrittInfo.textContent = !liste.length ? 'Noch keine Schritte erkannt.'
      : `${liste.length === 1 ? '1 Schritt' : `${liste.length} Schritte`} erkannt${timerAnzahl ? `, ${timerAnzahl === 1 ? '1 Timer' : `${timerAnzahl} Timer`}` : ''}.`;
  }

  const timer = {};
  const spaeter = (name, fn) => () => { clearTimeout(timer[name]); timer[name] = setTimeout(fn, 150); };
  zutaten.addEventListener('input', spaeter('zutaten', zeichneZutatenVorschau));
  schritte.addEventListener('input', spaeter('schritte', zeichneSchrittVorschau));
  zeichneZutatenVorschau();
  zeichneSchrittVorschau();

  // Ungespeicherte Änderungen erkennen
  const felder = [titel, portionen, gesamt, vorb, koch, tags, zutaten, schritte, notizen, quelle, bild];
  const startWert = new Map(felder.map((f) => [f, f.value]));
  const gleich = (...f) => f.every((x) => x.value === startWert.get(x));
  const geaendert = () => !fertig && (modus === 'import' || !gleich(...felder));
  const vorVerlassen = (ev) => { if (geaendert()) { ev.preventDefault(); ev.returnValue = ''; } };
  // Zurück-Pfeil und App-Links (Navigation unten, Hinweise): bei Änderungen erst nachfragen wie bei
  // „Abbrechen“. Capture-Phase, damit es vor dem Klick-Handler in app.js läuft.
  const vorKlick = (ev) => {
    const ziel = ev.target?.closest?.('#kopf-zurueck, a[href^="#/"]');
    if (!ziel || !geaendert()) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    abbrechen(ziel.id === 'kopf-zurueck' ? null : ziel.getAttribute('href'));
  };
  window.addEventListener('beforeunload', vorVerlassen);
  document.addEventListener('click', vorKlick, true);
  aufraeumer.push(() => {
    window.removeEventListener('beforeunload', vorVerlassen);
    document.removeEventListener('click', vorKlick, true);
    Object.values(timer).forEach(clearTimeout);
  });

  async function speichern() {
    if (speichert) return;
    const t = titel.value.replace(/\s+/g, ' ').trim();
    const bildUrl = bild.value.trim();
    const problem = !t ? [titel, 'Bitte gib einen Titel ein.']
      : bildUrl && !istWebLink(bildUrl) ? [bild, 'Die Bild-Adresse muss mit https:// beginnen.'] : null;
    if (problem) { toast(problem[1]); problem[0].focus(); return; }
    const q = quelle.value.trim();
    const qIstLink = istWebLink(q);
    // Unveränderte Felder behalten den gespeicherten Wert (keine Rundung, Zutaten-ids bleiben)
    const behalte = (f, alt, neuWert) => (gleich(f) && alt !== undefined ? alt : neuWert());
    const minuten = (f) => (zahl(f.value) == null ? null : Math.round(zahl(f.value)));
    const prepMin = behalte(vorb, rezept.prepMin, () => minuten(vorb));
    const cookMin = behalte(koch, rezept.cookMin, () => minuten(koch));
    const totalMin = gleich(gesamt, vorb, koch) && rezept.totalMin !== undefined ? rezept.totalMin
      : minuten(gesamt) ?? (prepMin || cookMin ? (prepMin || 0) + (cookMin || 0) : null);
    const neu = {
      ...rezept, title: behalte(titel, rezept.title || undefined, () => t),
      servings: behalte(portionen, rezept.servings, () => zahl(portionen.value)), prepMin, cookMin, totalMin,
      tags: behalte(tags, Array.isArray(rezept.tags) ? rezept.tags : undefined, () => tagsAusText(tags.value)),
      sourceUrl: behalte(quelle, rezept.sourceUrl, () => (qIstLink ? q : '')),
      sourceSite: behalte(quelle, rezept.sourceSite, () => (qIstLink ? hostVon(q) : q)),
      imageUrl: behalte(bild, rezept.imageUrl, () => bildUrl), notes: behalte(notizen, rezept.notes, () => notizen.value.trim()),
      favorite: rezept.favorite === true,
      ingredients: behalte(zutaten, Array.isArray(rezept.ingredients) ? rezept.ingredients : undefined, () => parseZeilen(zutaten.value)),
      steps: behalte(schritte, Array.isArray(rezept.steps) ? rezept.steps : undefined, () => parseSchritte(schritte.value)),
    };
    speichert = true;
    try {
      const gespeichert = await db.speichere('recipes', neu);
      fertig = true;
      toast(modus === 'bearbeiten' ? 'Änderungen gespeichert.' : 'Rezept gespeichert.');
      navigiere(`#/rezept/${encodeURIComponent(gespeichert.id)}`, { ersetzen: true });
    } catch (e) {
      console.error(e);
      speichert = false;
      toast(`Speichern hat nicht geklappt: ${e?.message || e}`);
    }
  }

  // Verlassen ohne Speichern; nach: Ziel-Hash (sonst eine Ansicht zurück)
  async function abbrechen(nach = null) {
    if (geaendert()) {
      const text = modus === 'import' ? 'Das geladene Rezept wird nicht gespeichert.' : 'Deine Änderungen gehen verloren.';
      // zurueck() wartet selbst, bis der Dialog seinen Verlaufseintrag zurückgenommen hat
      if (!(await bestaetige(text, { titel: 'Verwerfen?', ja: 'Verwerfen', nein: 'Weiter bearbeiten', gefahr: true }))) return;
    }
    fertig = true;
    if (nach) navigiere(nach);
    else zurueck();
  }

  kopfAktionen(el('button', { type: 'button', class: 'knopf primaer klein', onclick: speichern }, 'Speichern'));
  // Zahlenfelder: zwei pro Zeile auf dem Handy, vier nebeneinander auf breiten Bildschirmen
  const zeitFeld = (beschriftung, f) => feld(beschriftung, f, null, { flex: '1 1 9rem' });
  const zeiten = el('div', { class: 'leiste', style: { alignItems: 'flex-end' } },
    zeitFeld('Portionen', portionen), zeitFeld('Gesamt (Min.)', gesamt),
    zeitFeld('Vorbereitung (Min.)', vorb), zeitFeld('Kochzeit (Min.)', koch));

  container.replaceChildren(
    ...hinweise,
    el('section', { class: 'abschnitt' },
      feld('Titel *', titel),
      zeiten,
      feld('Tags', tags, 'Mit Komma trennen.')),
    el('section', { class: 'abschnitt' },
      el('h2', null, 'Zutaten'),
      feld('Eine Zutat pro Zeile', zutaten, 'Überschriften wie „Für den Teig:“ enden mit Doppelpunkt.'),
      zutatenInfo, zutatenVorschau),
    el('section', { class: 'abschnitt' },
      el('h2', null, 'Zubereitung'),
      feld('Ein Schritt pro Zeile', schritte, 'Absätze werden zu Schritten. Überschriften wie „Soße:“ enden mit Doppelpunkt.'),
      schrittInfo, schrittVorschau),
    el('section', { class: 'abschnitt' },
      el('h2', null, 'Weiteres'),
      feld('Notizen', notizen),
      feld('Quelle', quelle, 'Link zur Webseite oder ein Hinweis wie „Kochbuch S. 12“.'),
      feld('Bild-URL', bild)),
    el('div', { class: 'leiste ende' },
      el('button', { type: 'button', class: 'knopf flach', onclick: () => abbrechen() }, 'Abbrechen'),
      el('button', { type: 'button', class: 'knopf primaer', onclick: speichern }, symbol(SYMBOLE.haken), 'Speichern')));
  if (modus === 'neu') titel.focus();
}

// ---------------------------------------------------------------- Import

async function zeigeImport(container, query, aufraeumer) {
  setzeTitel('Rezept importieren');
  let aktiv = true;
  let laedt = false;
  aufraeumer.push(() => { aktiv = false; });
  const geteilt = holeGeteiltes();
  const einstellungen = await db.holeEinstellungen();
  const proxy = String(einstellungen.proxyUrl || '').trim();
  const url = findeUrl(query.get('url') || '', geteilt?.url || '', geteilt?.text || '', geteilt?.title || '') || '';
  const roh = String(geteilt?.text || '').trim();
  const geteilterText = url && roh ? textOhneUrl(roh, url) : roh;
  const modus = query.get('modus') || (!url && geteilterText ? 'text' : 'link');

  const status = el('div', { class: 'versteckt' });
  const duplikatBox = el('div', { class: 'versteckt' });
  const urlFeld = el('input', {
    type: 'url', value: url, placeholder: 'https://www.chefkoch.de/rezepte/…', autocomplete: 'off', enterkeyhint: 'go',
  });
  urlFeld.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); laden(); } });
  let dupTimer = null;
  urlFeld.addEventListener('input', () => {
    clearTimeout(dupTimer);
    dupTimer = setTimeout(() => pruefeDuplikat(findeUrl(urlFeld.value)).catch(console.error), 300);
  });
  aufraeumer.push(() => clearTimeout(dupTimer));
  const ladeKnopf = el('button', { type: 'button', class: 'knopf primaer', disabled: !proxy, onclick: () => laden() },
    symbol(SYMBOLE.link), 'Rezept laden');
  const textFeld = el('textarea', { rows: 10, value: geteilterText, placeholder: 'Titel, Zutaten und Zubereitung hier einfügen' });

  const linkKarte = el('section', { class: 'karte' },
    el('h2', null, 'Link'),
    proxy
      ? el('p', { class: 'nebentext' }, 'Link zu einem Rezept einfügen, z. B. aus Chefkoch oder einem Koch-Blog.')
      : el('div', { class: 'hinweis' },
        el('p', null, 'Zum Laden über Links brauchst du den Import-Dienst. Richte ihn unter Mehr → Import-Dienst ein. Bis dahin kannst du das Rezept als Text einfügen.'),
        el('div', { class: 'leiste' }, el('a', { class: 'knopf klein', href: '#/mehr' }, 'Import-Dienst einrichten'))),
    el('label', { class: 'feld' }, el('span', { class: 'nur-sr' }, 'Link zum Rezept'), urlFeld),
    el('div', { class: 'leiste' }, ladeKnopf),
    status, duplikatBox);
  const textKarte = el('section', { class: 'karte' },
    el('h2', null, 'Text'),
    el('p', { class: 'nebentext' }, 'Rezepttext kopieren und hier einfügen. Zutaten und Schritte werden erkannt – danach kannst du alles prüfen.'),
    el('label', { class: 'feld' }, el('span', { class: 'nur-sr' }, 'Rezepttext'), textFeld),
    el('div', { class: 'leiste' },
      el('button', { type: 'button', class: 'knopf primaer', onclick: textUebernehmen }, symbol(SYMBOLE.text), 'Text übernehmen')));
  const textZuerst = modus === 'text' || (!proxy && !!geteilterText);
  container.replaceChildren(...(textZuerst ? [textKarte, linkKarte] : [linkKarte, textKarte]));

  function zeigeStatus(knoten) {
    status.className = knoten ? '' : 'versteckt';
    status.replaceChildren(...(knoten ? [knoten] : []));
  }

  // Nach einem Fehler: zum Textfeld (auch wenn es über der Link-Karte steht)
  function zumText() {
    textKarte.scrollIntoView({ behavior: 'smooth', block: 'start' });
    textFeld.focus({ preventScroll: true });
  }

  // Fehlerkasten mit verständlicher Meldung (aus rezept-import.js) und passenden Knöpfen
  function fehlerKasten(e) {
    const code = e instanceof ImportFehler ? e.code : null;
    const dienstPruefen = ['kein-proxy', 'origin'].includes(code) || ['methode', 'antwort', 'nicht-erreichbar'].includes(e?.grund);
    return el('div', { class: 'fehler', role: 'alert' },
      el('p', null, code ? e.message : 'Das Rezept konnte nicht geladen werden. Füge den Rezepttext als Text ein.'),
      code === 'origin' ? el('p', { class: 'nebentext' }, `Adresse dieser App: ${location.origin}`) : null,
      code ? null : el('p', { class: 'nebentext' }, String(e?.message || e)),
      el('div', { class: 'leiste' },
        code === 'netz' || code === 'limit'
          ? el('button', { type: 'button', class: 'knopf klein', onclick: () => laden() }, 'Nochmal versuchen') : null,
        dienstPruefen ? el('a', { class: 'knopf klein', href: '#/mehr' },
          code === 'kein-proxy' ? 'Import-Dienst einrichten' : 'Import-Dienst prüfen') : null,
        el('button', { type: 'button', class: 'knopf klein', onclick: zumText }, symbol(SYMBOLE.text), 'Als Text einfügen')));
  }

  async function pruefeDuplikat(u) {
    const d = await findeDuplikat(u);
    if (!aktiv) return null;
    duplikatBox.className = d ? '' : 'versteckt';
    duplikatBox.replaceChildren(...(d ? [duplikatHinweis(d)] : []));
    return d;
  }

  async function zeigeEntwurf(entwurf) {
    const rezept = { ...leeresRezept(null), ...entwurf };
    if (!rezept.title && geteilt?.title && !findeUrl(geteilt.title)) rezept.title = geteilt.title.trim();
    const dup = await findeDuplikat(rezept.sourceUrl);
    if (!aktiv) return;
    const hinweise = [el('div', { class: 'hinweis' },
      el('p', { class: 'fett' }, 'Bitte prüfen und speichern.'),
      rezept.ingredients?.length ? null : el('p', null, 'Es wurden keine Zutaten erkannt – trag sie unten ein.'))];
    if (dup) hinweise.push(duplikatHinweis(dup));
    zeigeFormular(container, { rezept, modus: 'import', aufraeumer, hinweise });
    window.scrollTo(0, 0);
  }

  async function laden() {
    if (laedt) return;
    const u = findeUrl(urlFeld.value);
    if (!u) {
      zeigeStatus(fehlerAnzeige('Bitte einen vollständigen Link einfügen (beginnt mit https://).'));
      urlFeld.focus();
      return;
    }
    laedt = true;
    urlFeld.value = u;
    clearTimeout(dupTimer);
    pruefeDuplikat(u).catch(console.error);
    ladeKnopf.disabled = true;
    zeigeStatus(el('p', { class: 'hinweis', role: 'status' }, 'Lade Rezept…'));
    try {
      const entwurf = await ladeRezept(u, { proxyUrl: proxy });
      if (aktiv) await zeigeEntwurf(entwurf);
    } catch (e) {
      if (!aktiv) return;
      console.warn(e);
      zeigeStatus(fehlerKasten(e));
      if (!textFeld.value.trim() && geteilterText) textFeld.value = geteilterText;
    } finally {
      laedt = false;
      ladeKnopf.disabled = !proxy;
    }
  }

  function textUebernehmen() {
    const text = textFeld.value.trim();
    if (!text) { toast('Bitte zuerst den Rezepttext einfügen.'); textFeld.focus(); return; }
    const quelleUrl = findeUrl(urlFeld.value) || findeUrl(text) || undefined;
    let entwurf;
    try {
      // Titel aus dem Text hat Vorrang; der Titel des Teilens (oft Seitenname) nur als Ersatz, siehe zeigeEntwurf
      entwurf = rezeptAusText(text, { quelleUrl });
    } catch (e) {
      console.error(e);
      toast('Der Text konnte nicht gelesen werden.');
      return;
    }
    zeigeEntwurf(entwurf).catch(console.error);
  }

  // Geteilter Link: Duplikat prüfen und – wenn möglich – gleich laden. Fokus nur auf leere Felder,
  // die man jetzt braucht (sonst springt auf dem Handy unnötig die Tastatur auf)
  const dup = url ? await pruefeDuplikat(url) : null;
  if (!aktiv) return;
  if (url && proxy && !dup && modus !== 'text') laden();
  else if (modus === 'text' && !textFeld.value) textFeld.focus();
  else if (modus === 'link' && proxy && !url) urlFeld.focus();
}
