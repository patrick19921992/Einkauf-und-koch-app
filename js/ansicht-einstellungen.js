// „Mehr“ (#/mehr): Sicherung speichern/teilen/einlesen, Speicherplatz, Import-Dienst,
// Planung, Vorrat, Vorlesen, App-Version und Hilfe.

import { el, symbol, SYMBOLE, VERSION, setzeTitel, toast, bestaetige, fehlerAnzeige, navigiere, pruefeUpdate, ladeNeu } from './app.js';
import * as db from './db.js';
import { alsSchluessel, heute, tageZwischen, formatDatum } from './datum.js';
import { zutatSchluessel } from './zutaten.js';

const SICHERUNG_NACH_TAGEN = 14;
const MAHLZEITEN = [['frueh', 'Frühstück'], ['mittag', 'Mittag'], ['abend', 'Abend'], ['snack', 'Snack']];
const WOCHENSTART = [[1, 'Montag'], [0, 'Sonntag'], [6, 'Samstag']];
const PROBE_TEXT = 'Schritt 1: Die Zwiebeln fein würfeln und in 2 Esslöffeln Butter glasig dünsten.';
const PROXY_BEISPIEL = 'https://rezepte.dein-name.workers.dev';
const STANDARD_ORIGIN = 'https://patrick19921992.github.io'; // wie ERLAUBTE_ORIGINS in proxy/worker.js
const MAX_DATEI_BYTES = 50 * 1024 * 1024; // größere Dateien sind sicher keine Sicherung

// Ersetzt den Inhalt; null/false werden ausgelassen
const fuelle = (ziel, ...kinder) => ziel.replaceChildren(...kinder.flat(Infinity).filter((k) => k != null && typeof k !== 'boolean'));
const abschnitt = (titel, ...inhalt) => el('section', { class: 'abschnitt' }, el('h2', null, titel), ...inhalt);
const hilfe = (titel, ...inhalt) => el('details', { class: 'hilfe' }, el('summary', null, titel), ...inhalt);
const istAbbruch = (f) => f?.name === 'AbortError';

/** Knopf, dessen Klick-Funktion den Knopf selbst bekommt (zum Sperren während der Arbeit). */
function knopf(text, klick, art = '', sym = null) {
  const k = el('button', { type: 'button', class: ['knopf', art], onclick: () => klick(k) }, sym ? symbol(sym) : null, text);
  return k;
}

/** Zeile „Beschriftung links, Bedienelement rechts“. */
function zeile(titel, beschreibung, ...rechts) {
  return el('div', { class: 'einstellung' },
    el('div', null, el('div', { class: 'fett' }, titel), beschreibung ? el('div', { class: 'nebentext' }, beschreibung) : null), ...rechts);
}

/** Bytes → '0,4 MB', '250 MB' bzw. '1 GB' (ab 1000 MB, sonst liest sich „1.016 MB“ schlecht). */
function groesse(bytes) {
  const mb = Math.max(0.1, bytes / (1024 * 1024));
  const zahl = (x) => x.toLocaleString('de-DE', { maximumFractionDigits: x < 10 ? 1 : 0 });
  return mb >= 1000 ? `${zahl(mb / 1024)} GB` : `${zahl(mb)} MB`;
}

/** 'heute, 14:30 Uhr' / 'gestern' / 'vor 5 Tagen (10.10.2026)' / 'nie'. */
function sicherungsText(ms) {
  if (!ms) return 'nie';
  const d = new Date(ms);
  const tage = tageZwischen(alsSchluessel(d), heute());
  if (tage <= 0) return `heute, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
  return tage === 1 ? 'gestern' : `vor ${tage} Tagen (${formatDatum(alsSchluessel(d), { jahr: true })})`;
}

/** Bietet Text als Datei zum Herunterladen an. */
function herunterladen(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a', { href: url, download: name, class: 'versteckt' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Adresse des Import-Dienstes prüfen und vereinheitlichen. '' = keiner, null = ungültig. */
function proxyNormal(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    // http nur unter der Adresse der App selbst (lokaler Test); andere erlaubt die CSP ohnehin nicht
    const eigen = u.origin === location.origin;
    if (!(u.protocol === 'https:' || eigen) || u.username || u.password) return null;
    if (!eigen && u.hostname !== 'localhost' && !u.hostname.includes('.')) return null; // Tippfehler wie „https://rezepte“
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Erklärung, wenn ein Server antwortet, die App aber nicht lesen darf (CORS/ERLAUBTE_ORIGINS). */
function originHinweis() {
  const fremd = location.origin !== STANDARD_ORIGIN;
  return `Unter der Adresse antwortet ein Server, aber nicht für diese App. Ist es die Adresse des Import-Dienstes?${fremd
    ? ` Dann im Worker unter „Settings“ → „Variables and Secrets“ die Text-Variable ERLAUBTE_ORIGINS mit ${location.origin} anlegen.` : ''}`;
}

export async function zeige(container) {
  setzeTitel('Mehr');
  const e = await db.holeEinstellungen();
  const aufraeumer = [];
  // Sofort im Objekt übernehmen, in der Datenbank der Reihe nach speichern (schnelles Tippen)
  let kette = Promise.resolve();
  const speichern = (teil) => {
    Object.assign(e, teil);
    kette = kette.then(() => db.speichereEinstellungen(teil)).catch((f) => toast(`Speichern hat nicht geklappt: ${f.message || f}`));
    return kette;
  };

  // ---------------------------------------------------------------- Sicherung
  const sicherungStatus = el('div');
  const sicherungMeldung = el('div');
  const dateiFeld = el('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', class: 'versteckt', onchange: () => einlesen() });
  const fehler = (text, f = null) => {
    if (f) console.error(f);
    fuelle(sicherungMeldung, fehlerAnzeige(text, f));
  };

  async function zeigeSicherungStatus() {
    const anzahl = await db.anzahl('recipes').catch(() => 0);
    const alt = !e.letzteSicherung || Date.now() - e.letzteSicherung > SICHERUNG_NACH_TAGEN * 86400000;
    fuelle(sicherungStatus, el('div', { class: ['hinweis', alt ? anzahl && 'warnung' : 'erfolg'] },
      el('p', { class: 'fett' }, `Letzte Sicherung: ${sicherungsText(e.letzteSicherung)}`),
      el('p', { class: 'nebentext' }, `${anzahl} ${anzahl === 1 ? 'Rezept' : 'Rezepte'} auf diesem Gerät.`)));
  }

  async function gesichert(text) {
    await speichern({ letzteSicherung: Date.now() });
    fuelle(sicherungMeldung);
    toast(text);
    zeigeSicherungStatus();
  }

  async function sicherungSpeichern() {
    const name = db.backupDateiname();
    try {
      // Desktop: zuerst den Datei-Dialog öffnen (braucht die frische Berührung), dann die Daten holen
      const griff = typeof window.showSaveFilePicker === 'function'
        ? await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Sicherung (JSON)', accept: { 'application/json': ['.json'] } }] })
          .catch((f) => { if (istAbbruch(f)) throw f; return null; }) // nicht erlaubt → normaler Download
        : null;
      const json = JSON.stringify(await db.exportiere());
      if (griff) {
        const schreiber = await griff.createWritable();
        await schreiber.write(json);
        await schreiber.close();
        await gesichert('Sicherung gespeichert.');
      } else {
        herunterladen(json, name);
        await gesichert('Sicherung wird heruntergeladen (Ordner „Downloads“).');
      }
    } catch (f) {
      if (!istAbbruch(f)) fehler('Die Sicherung konnte nicht gespeichert werden.', f);
    }
  }

  async function sicherungTeilen() {
    try {
      const json = JSON.stringify(await db.exportiere());
      const name = db.backupDateiname();
      // .json lässt Android nicht teilen → als .txt (text/plain); Einlesen nimmt beides
      const datei = new File([json], name.replace(/\.json$/, '.txt'), { type: 'text/plain' });
      if (navigator.share && navigator.canShare?.({ files: [datei] })) {
        try {
          await navigator.share({ files: [datei], title: 'Einkauf & Koch – Sicherung' });
          await gesichert('Sicherung geteilt.');
          return;
        } catch (f) {
          if (istAbbruch(f)) return;
          console.warn('Teilen fehlgeschlagen, lade herunter:', f);
        }
      }
      herunterladen(json, name);
      await gesichert('Teilen geht hier nicht – die Sicherung wurde heruntergeladen.');
    } catch (f) {
      fehler('Die Sicherung konnte nicht geteilt werden.', f);
    }
  }

  async function einlesen() {
    const datei = dateiFeld.files?.[0];
    dateiFeld.value = ''; // dieselbe Datei darf erneut gewählt werden
    if (!datei) return;
    fuelle(sicherungMeldung);
    if (datei.size > MAX_DATEI_BYTES) {
      fehler(`Die Datei ist zu groß für eine Sicherung (${groesse(datei.size)}). Bitte die Datei „rezepte-backup-….json“ wählen.`);
      return;
    }
    let daten;
    try {
      daten = JSON.parse(await datei.text());
    } catch (f) {
      console.warn(f); // technische Meldung des Browsers hilft hier niemandem
      fehler('Die Datei ist keine gültige Sicherung (kein JSON). Bitte die Datei „rezepte-backup-….json“ (oder .txt) wählen.');
      return;
    }
    if (!daten || typeof daten !== 'object' || typeof daten.daten !== 'object' || !daten.daten) {
      fehler('Die Datei ist keine Sicherung dieser App.');
      return;
    }
    const rezepte = Array.isArray(daten?.daten?.recipes) ? daten.daten.recipes.filter((r) => r && !r.deleted).length : 0;
    const vom = Date.parse(daten?.exportedAt);
    const datum = Number.isFinite(vom) ? ` vom ${formatDatum(alsSchluessel(new Date(vom)), { jahr: true })}` : '';
    if (!(await bestaetige(`Sicherung${datum} mit ${rezepte} ${rezepte === 1 ? 'Rezept' : 'Rezepten'} einlesen? ` +
      'Pro Eintrag gewinnt der neuere Stand, gelöscht wird nichts.', { titel: 'Sicherung einlesen', ja: 'Einlesen' }))) return;
    try {
      const erg = await db.importiere(daten);
      toast(`Eingelesen: ${erg.neu} neu, ${erg.aktualisiert} aktualisiert${erg.uebersprungen ? `, ${erg.uebersprungen} unverändert` : ''}`, { dauer: 5000 });
      navigiere('#/mehr', { ersetzen: true }); // neu zeichnen: Haushalts-Einstellungen können sich geändert haben
    } catch (f) {
      fehler(f?.message || 'Die Sicherung konnte nicht eingelesen werden.');
    }
  }

  // ---------------------------------------------------------------- Speicher
  const speicherBox = el('div', { class: 'stapel' });
  async function zeigeSpeicher() {
    const s = await db.speicherStatus();
    const anfragen = knopf('Dauerhaft speichern anfragen', async () => {
      const r = await db.bitteUmDauerhaftenSpeicher();
      toast(r === true ? 'Die Daten werden jetzt dauerhaft gespeichert.' : r === null ? 'Dieser Browser unterstützt das nicht.'
        : 'Der Browser hat abgelehnt. Tipp: App installieren und öfter benutzen, dann klappt es meist.');
      zeigeSpeicher();
    });
    fuelle(speicherBox,
      el('p', { class: ['hinweis', s.persistent === true ? 'erfolg' : s.persistent === false && 'warnung'] }, s.persistent === true
        ? 'Dauerhaft gespeichert: Der Browser löscht die Daten nicht von selbst.'
        : s.persistent === false ? 'Nicht dauerhaft: Bei Speichermangel könnte der Browser die Daten löschen. Bitte regelmäßig sichern.'
          : 'Ob die Daten dauerhaft gespeichert sind, meldet dieser Browser nicht.'),
      s.belegt != null && s.verfuegbar ? [
        el('meter', { class: 'speicher-balken', min: '0', max: String(s.verfuegbar), value: String(s.belegt), high: String(s.verfuegbar * 0.8) }),
        el('p', { class: 'nebentext' }, `${groesse(s.belegt)} von ${groesse(s.verfuegbar)} belegt`)] : null,
      s.persistent === false ? el('div', { class: 'leiste' }, anfragen) : null);
  }

  // ---------------------------------------------------------------- Import-Dienst
  const proxyFeld = el('input', { type: 'url', inputmode: 'url', placeholder: PROXY_BEISPIEL, value: e.proxyUrl || '', autocomplete: 'off', spellcheck: 'false' });
  const proxyMeldung = el('div');
  async function proxySpeichern() {
    const url = proxyNormal(proxyFeld.value);
    if (url === null) return fuelle(proxyMeldung, fehlerAnzeige(`Bitte eine vollständige https-Adresse eingeben, z. B. ${PROXY_BEISPIEL}`));
    proxyFeld.value = url;
    await speichern({ proxyUrl: url });
    fuelle(proxyMeldung);
    return toast(url ? 'Adresse gespeichert.' : 'Import-Dienst entfernt.');
  }
  // Ping an `${proxy}?ping=1`; klappt es, wird die Adresse gleich gespeichert
  async function proxyTesten(k) {
    const url = proxyNormal(proxyFeld.value);
    if (!url) return fuelle(proxyMeldung, fehlerAnzeige(url === null ? `Die Adresse ist ungültig. Bitte eine vollständige https-Adresse eingeben, z. B. ${PROXY_BEISPIEL}` : 'Bitte zuerst die Adresse eingeben.'));
    k.disabled = true;
    fuelle(proxyMeldung, el('p', { class: 'nebentext' }, 'Teste Verbindung…'));
    const ziel = new URL(url);
    ziel.searchParams.set('ping', '1');
    let meldung;
    try {
      const antwort = await fetch(ziel.href, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) });
      const json = await antwort.json().catch(() => null);
      if (antwort.ok && json?.ok === true) {
        const neu = url !== e.proxyUrl;
        if (neu) { proxyFeld.value = url; await speichern({ proxyUrl: url }); }
        meldung = el('p', { class: 'hinweis erfolg' }, `Verbindung klappt${json.version ? ` (Version ${json.version})` : ''}.${neu ? ' Adresse gespeichert.' : ''}`);
      } else {
        meldung = fehlerAnzeige(json?.fehler === 'origin' ? originHinweis()
          : `Unerwartete Antwort (Status ${antwort.status}). Ist das die Adresse des Import-Dienstes?`);
      }
    } catch (f) {
      console.warn('Import-Dienst nicht erreichbar:', f);
      meldung = fehlerAnzeige(await pingFehler(f, ziel.href));
    }
    k.disabled = false;
    return fuelle(proxyMeldung, meldung);
  }
  // Warum der Ping scheiterte: Zeit, offline, Server antwortet ohne Freigabe für die App, gar nicht erreichbar
  async function pingFehler(f, adresse) {
    if (f?.name === 'TimeoutError') return 'Keine Antwort nach 10 Sekunden. Bitte Adresse und Internet prüfen.';
    if (navigator.onLine === false) return 'Du bist offline. Bitte später noch einmal testen.';
    const erreichbar = await fetch(adresse, { mode: 'no-cors', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) })
      .then(() => true, () => false);
    return erreichbar ? originHinweis() : 'Keine Verbindung. Bitte Adresse und Internet prüfen.';
  }

  // ---------------------------------------------------------------- Planung
  const portionenAusgabe = el('output');
  const weniger = el('button', { type: 'button', 'aria-label': 'Weniger Portionen', onclick: () => portionen(-1) }, '−');
  const mehr = el('button', { type: 'button', 'aria-label': 'Mehr Portionen', onclick: () => portionen(1) }, '+');
  function portionen(d) {
    const w = Math.min(20, Math.max(1, (Number(e.standardPortionen) || 4) + d));
    portionenAusgabe.textContent = String(w);
    weniger.disabled = w <= 1;
    mehr.disabled = w >= 20;
    if (d) speichern({ standardPortionen: w });
  }
  portionen(0);

  const mahlzeitFelder = MAHLZEITEN.map(([wert, name]) => el('label', { class: 'checkbox' },
    el('input', { type: 'checkbox', value: wert, checked: (e.mahlzeiten || []).includes(wert), onchange: (ev) => mahlzeiten(ev.target) }),
    el('span', null, name)));
  function mahlzeiten(feld) {
    const gewaehlt = mahlzeitFelder.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    if (gewaehlt.length) speichern({ mahlzeiten: gewaehlt });
    else {
      feld.checked = true;
      toast('Mindestens eine Mahlzeit muss aktiv bleiben.');
    }
  }

  // ---------------------------------------------------------------- Vorrat (als Zusammenführ-Schlüssel gespeichert)
  const vorratChips = el('div', { class: 'chips' });
  const vorratFeld = el('input', { type: 'text', placeholder: 'z. B. Öl, Zucker', enterkeyhint: 'done', autocomplete: 'off' });
  const anzeigeName = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  function zeigeVorrat() {
    const liste = [...(e.vorrat || [])].sort((a, b) => a.localeCompare(b, 'de'));
    fuelle(vorratChips, liste.length ? liste.map((k) => el('span', { class: 'chip' }, anzeigeName(k),
      el('button', { type: 'button', class: 'icon-knopf', 'aria-label': `${anzeigeName(k)} entfernen`, onclick: () => vorratSetzen(e.vorrat.filter((x) => x !== k)) },
        symbol(SYMBOLE.schliessen)))) : el('p', { class: 'nebentext' }, 'Noch nichts im Vorrat.'));
  }
  function vorratSetzen(liste) {
    speichern({ vorrat: [...new Set(liste)] });
    zeigeVorrat();
  }
  function vorratHinzufuegen() {
    const neu = vorratFeld.value.split(/[,;\n]/).map((t) => zutatSchluessel(t)).filter(Boolean);
    vorratFeld.value = '';
    if (neu.length) vorratSetzen([...(e.vorrat || []), ...neu]);
  }
  vorratFeld.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); vorratHinzufuegen(); }
  });

  // ---------------------------------------------------------------- Vorlesen
  const sprache = globalThis.speechSynthesis || null;
  const deutsch = () => (sprache?.getVoices() || []).filter((v) => /^de(?:[-_]|$)/i.test(v.lang || ''));
  const stimmenWahl = el('select', { 'aria-label': 'Stimme', onchange: () => speichern({ ttsStimme: stimmenWahl.value }) });
  const stimmenHinweis = el('div');
  function fuelleStimmen() { // Stimmen kommen in Chrome oft erst nach 'voiceschanged'
    const stimmen = deutsch();
    const opt = (wert, text) => el('option', { value: wert, selected: wert === (e.ttsStimme || '') }, text);
    fuelle(stimmenWahl, opt('', 'Automatisch'), stimmen.map((v) => opt(v.voiceURI, `${v.name}${v.localService ? '' : ' (online)'}`)),
      !e.ttsStimme || stimmen.some((v) => v.voiceURI === e.ttsStimme) ? null : opt(e.ttsStimme, 'Gespeicherte Stimme (nicht gefunden)'));
    fuelle(stimmenHinweis, stimmen.length ? null : el('p', { class: 'hinweis warnung' },
      'Keine deutsche Stimme gefunden. Android: Einstellungen → System → Sprache → Sprachausgabe → „Sprachdienste von Google“ → deutsche Stimme installieren.'));
  }
  const tempoText = el('output');
  const zeigeTempo = (w) => { tempoText.textContent = `${Number(w).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`; };
  const tempoRegler = el('input', {
    type: 'range', min: '0.7', max: '1.3', step: '0.1', value: String(e.ttsTempo || 1), 'aria-label': 'Sprechtempo',
    oninput: () => zeigeTempo(tempoRegler.value), onchange: () => speichern({ ttsTempo: Number(tempoRegler.value) }),
  });
  zeigeTempo(tempoRegler.value);
  function probe() {
    sprache.cancel();
    const stimmen = deutsch();
    const v = stimmen.find((s) => s.voiceURI === stimmenWahl.value) || stimmen.find((s) => /^de[-_]DE$/i.test(s.lang)) || stimmen[0];
    sprache.speak(Object.assign(new SpeechSynthesisUtterance(PROBE_TEXT), { voice: v || null, lang: v?.lang || 'de-DE', rate: Number(tempoRegler.value) || 1 }));
  }
  if (sprache) {
    fuelleStimmen();
    sprache.addEventListener?.('voiceschanged', fuelleStimmen);
    aufraeumer.push(() => { sprache.removeEventListener?.('voiceschanged', fuelleStimmen); sprache.cancel(); });
  }

  // ---------------------------------------------------------------- App
  async function nachUpdateSuchen(k) {
    const text = k.lastChild.textContent;
    k.disabled = true;
    k.lastChild.textContent = 'Suche nach Updates…';
    const r = await pruefeUpdate().catch(() => 'offline');
    k.disabled = false;
    k.lastChild.textContent = text;
    if (r === 'neu') toast('Neue Version gefunden.', { aktion: { text: 'Neu laden', onclick: ladeNeu } });
    else toast(r === 'aktuell' ? 'Die App ist aktuell.' : r === 'offline' ? 'Keine Verbindung – bitte später noch einmal versuchen.'
      : 'Updates sind hier nicht verfügbar (ohne Service Worker).');
  }

  // ---------------------------------------------------------------- Aufbau
  fuelle(container,
    abschnitt('Sicherung',
      el('p', { class: 'nebentext' }, 'Alle Rezepte, der Wochenplan und die Einkaufsliste in einer Datei. Teile sie z. B. nach Google Drive oder per E-Mail an dich selbst. Beim Einlesen gewinnt pro Eintrag der neuere Stand – gelöscht wird nichts.'),
      sicherungStatus,
      el('div', { class: 'leiste' },
        knopf('Sicherung speichern', sicherungSpeichern, 'primaer'),
        knopf('Sicherung teilen', sicherungTeilen, '', SYMBOLE.teilen),
        knopf('Sicherung einlesen', () => dateiFeld.click()), dateiFeld),
      sicherungMeldung),
    abschnitt('Speicher', speicherBox),
    abschnitt('Import-Dienst',
      el('p', { class: 'nebentext' }, 'Nötig, um Rezepte per Link zu laden. Ohne Dienst klappt „Text einfügen“ weiterhin.'),
      el('label', { class: 'feld' }, el('span', null, 'Adresse des Dienstes'), proxyFeld),
      el('div', { class: 'leiste' }, knopf('Speichern', proxySpeichern, 'primaer'), knopf('Testen', proxyTesten)),
      proxyMeldung,
      // Gleiche Schritte wie im Kopf von proxy/worker.js
      hilfe('So richtest du den Dienst ein (kostenlos)', el('ol', null,
        el('li', null, 'Auf dash.cloudflare.com kostenlos registrieren und anmelden (keine Zahlungsdaten nötig).'),
        el('li', null, 'Links „Workers & Pages“ → „Create“ (Erstellen) → Vorlage „Hello World“ → „Deploy“.'),
        el('li', null, '„Edit code“ (Code bearbeiten) öffnen und den vorhandenen Code komplett durch den gesamten Inhalt der Datei proxy/worker.js aus dem App-Repository ersetzen → „Deploy“.'),
        el('li', null, 'Die angezeigte Adresse https://<name>.<konto>.workers.dev kopieren, oben einfügen, „Speichern“ und „Testen“ tippen. Die Adresse gehört nur hier in die App, nicht ins öffentliche Repository.')),
      location.origin === STANDARD_ORIGIN ? null : el('p', { class: 'nebentext' },
        `Diese App läuft unter ${location.origin}. Damit der Dienst ihr antwortet: im Worker unter „Settings“ → „Variables and Secrets“ eine Text-Variable ERLAUBTE_ORIGINS mit dieser Adresse anlegen (mehrere mit Komma getrennt).`))),
    abschnitt('Planung', el('div', { class: 'karte' },
      zeile('Standard-Portionen', 'Für neue Einträge im Wochenplan', el('span', { class: 'stepper' }, weniger, portionenAusgabe, mehr)),
      el('label', { class: 'einstellung' }, el('span', { class: 'fett' }, 'Woche beginnt am'),
        el('select', { onchange: (ev) => speichern({ wochenstart: Number(ev.target.value) }) },
          WOCHENSTART.map(([w, t]) => el('option', { value: String(w), selected: Number(e.wochenstart) === w }, t)))),
      zeile('Mahlzeiten im Wochenplan', 'Mindestens eine', el('div', { class: 'leiste', style: { flex: '1 1 100%' } }, mahlzeitFelder)))),
    abschnitt('Vorrat',
      el('p', { class: 'nebentext' }, 'Was du immer im Haus hast, steht auf der Einkaufsliste unter „Vorrat“ statt bei den offenen Posten.'),
      vorratChips,
      el('div', { class: 'leiste' },
        el('label', { class: 'feld', style: { flex: '1 1 12rem' } }, el('span', { class: 'nur-sr' }, 'Zum Vorrat hinzufügen'), vorratFeld),
        knopf('Hinzufügen', vorratHinzufuegen, '', SYMBOLE.plus))),
    abschnitt('Vorlesen', sprache
      ? el('div', { class: 'karte' },
        el('label', { class: 'einstellung' }, el('span', { class: 'fett' }, 'Stimme'), stimmenWahl),
        el('label', { class: 'einstellung' }, el('span', { class: 'fett' }, 'Tempo ', tempoText), tempoRegler),
        el('label', { class: 'einstellung checkbox' }, el('span', { class: 'fett' }, 'Schritte im Kochmodus automatisch vorlesen'),
          el('input', { type: 'checkbox', checked: !!e.autoVorlesen, onchange: (ev) => speichern({ autoVorlesen: ev.target.checked }) })),
        el('div', { class: 'leiste' }, knopf('Probe', probe, '', SYMBOLE.lautsprecher)),
        stimmenHinweis)
      : el('p', { class: 'hinweis warnung' }, 'Dieser Browser kann nicht vorlesen.')),
    abschnitt('App', el('div', { class: 'karte' },
      zeile('Version', null, el('span', { class: 'nebentext' }, VERSION === '__VERSION__' ? 'Entwicklung' : VERSION)),
      el('div', { class: 'leiste' }, knopf('Nach Update suchen', nachUpdateSuchen)))),
    abschnitt('Hilfe',
      hilfe('Installieren',
        el('p', null, 'In Chrome: Menü ⋮ → „App installieren“ (oder „Zum Startbildschirm hinzufügen“). Danach gibt es ein App-Symbol und „Einkauf & Koch“ im Teilen-Menü.')),
      hilfe('Teilen aus anderen Apps',
        el('p', null, 'In Chrome oder der Chefkoch-App auf „Teilen“ tippen und „Einkauf & Koch“ wählen. Mit Import-Dienst lädt die App das Rezept über den Link.'),
        el('p', null, 'Ohne Dienst oder wenn eine Seite blockt: Zutaten und Zubereitung markieren → Teilen → „Einkauf & Koch“, dann „Text übernehmen“.')),
      hilfe('Timer & Bildschirm',
        el('p', null, 'Im Kochmodus bleibt der Bildschirm an. Timer klingeln nur, solange die App offen und der Bildschirm an ist – das ist eine Grenze von Web-Apps.'),
        el('p', null, 'Vor dem Kochen einmal „Ton testen“ drücken und die Lautstärke aufdrehen.')),
      hilfe('Daten & Sicherung',
        el('p', null, 'Alle Daten liegen nur auf diesem Gerät. Wer in Chrome die Website-Daten löscht, löscht auch die Rezepte.'),
        el('p', null, 'Darum regelmäßig „Sicherung teilen“ (z. B. nach Google Drive). Auf einem neuen Handy: App öffnen → Mehr → „Sicherung einlesen“.')),
      hilfe('Import-Dienst',
        el('p', null, 'Browser dürfen Rezeptseiten nicht direkt auslesen. Der kleine Dienst bei Cloudflare holt nur die Rezeptdaten (Zutaten, Schritte, Portionen) von bekannten Rezeptseiten – kostenlos und nur für diese App.'))));

  zeigeSicherungStatus();
  zeigeSpeicher();
  zeigeVorrat();

  // Sicherung in einem anderen Tab gemacht oder Rezepte geändert → Status nachziehen
  let verzoegerung = null;
  const abmelden = db.beobachte(({ store }) => {
    if (store !== 'settings' && store !== 'recipes') return;
    clearTimeout(verzoegerung);
    verzoegerung = setTimeout(async () => {
      e.letzteSicherung = (await db.holeEinstellungen()).letzteSicherung;
      zeigeSicherungStatus();
    }, 100);
  });

  return () => {
    clearTimeout(verzoegerung);
    abmelden();
    for (const f of aufraeumer) f();
  };
}
