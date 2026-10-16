// Automatisch planen: Vorlieben abfragen, daraus einen Plan mit geschätzten Kosten vorschlagen,
// einzelne Gerichte tauschen und den Plan in die Woche übernehmen. Auf Wunsch neue Ideen von der KI.
// Der letzte nicht übernommene Plan bleibt in dieser Sitzung erhalten (sessionStorage).
// Die Läden gehören zum Haushalt (wie unter Mehr und in der Einkaufsliste): gespeichert in planerProfil.laeden.

import { el, symbol, SYMBOLE, setzeTitel, toast, dialog, auswahl, navigiere, fehlerAnzeige } from './app.js';
import * as db from './db.js';
import { heute, istSchluessel, plusTage, formatDatum, formatZeitraum, wochentagLang, relativerName } from './datum.js';
import { skaliere, formatZutat, parseZahl } from './zutaten.js';
import {
  PROTEINE, ALLERGENE, MAHLZEITEN, STANDARD_PROFIL, normalisiereProfil, plane, tausche, zeitText, passtZumProfil, rezeptMeta,
} from './planer.js';
import { LAEDEN, PREIS_STAND, formatEuroGerundet } from './preise.js';
import { kiAnfrage, holeKiRezepte, pruefeKiRezepte, kiRezeptZuRezept, KiFehler } from './ki.js';
import { ladeGrundrezepte } from './daten/rezepte.js';

const SITZUNG = 'ekapp-planer';
const START_TAGE = 14;            // Start: heute bis in 13 Tagen
const MAX_KI = 12;                // so viele KI-Ideen merkt sich die Sitzung
const KOCHZEITEN = [{ id: 'schnell', name: 'Schnell (≤ 25 Min.)' }, { id: 'normal', name: 'Normal (≤ 45 Min.)' }, { id: 'egal', name: 'Egal' }];
const SLOT_NAME = Object.fromEntries(MAHLZEITEN.map((m) => [m.id, m.name]));
const LADEN_NAME = Object.fromEntries(LAEDEN.map((l) => [l.id, l.name]));
const STAND_TEXT = PREIS_STAND.replace(/^(\d{4})-(\d{2})$/, '$2/$1'); // '2026-10' → '10/2026'
const PREIS_HINWEIS = `Preise sind Schätzwerte (Stand ${STAND_TEXT}). Eigene Preise kannst du in der Einkaufsliste eintragen.`;

// Kurze Meldungen bei KI-Fehlern; der ausführliche Text steht als Hinweis beim Plan
const KI_KURZ = {
  'ki-fehlt': 'KI ist im Import-Dienst noch nicht eingerichtet – Anleitung unter Mehr.',
  limit: 'KI-Kontingent für heute aufgebraucht – der Plan nutzt die vorhandenen Rezepte.',
  sonst: 'Keine neuen KI-Ideen – der Plan nutzt die vorhandenen Rezepte.',
};
const KI_EINRICHTEN = new Set(['ki-fehlt', 'kein-proxy', 'origin']); // Hinweis mit Weg zu Mehr → Import-Dienst
const WOCHE_SLOTS = ['frueh', 'mittag', 'abend', 'snack'];

const mehrzahl = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;
const istKi = (id) => String(id ?? '').startsWith('ki-');
const pause = () => new Promise((r) => setTimeout(r, 30)); // Statustext zeichnen lassen, bevor gerechnet wird
const gleicheLaeden = (a, b) => [...(a || [])].sort().join() === [...(b || [])].sort().join();
// wie die Woche: unbekannte Mahlzeit zählt als Abendessen
const slotVon = (p) => (WOCHE_SLOTS.includes(p.slot) ? p.slot : 'abend');

/** 'A', 'A und B', 'A, B und C' */
function aufzaehlung(liste) {
  return liste.length < 2 ? liste.join('') : `${liste.slice(0, -1).join(', ')} und ${liste.at(-1)}`;
}

/** Titel geplanter Einträge in Anführungszeichen, schon Eingekauftes zuerst und markiert; höchstens `max`. */
function titelListe(eintraege, max = 3) {
  const titel = [...eintraege].sort((a, b) => Boolean(b.tripId) - Boolean(a.tripId))
    .map((p) => `„${String(p.title || 'Ohne Titel').slice(0, 60)}“${p.tripId ? ' (schon eingekauft)' : ''}`);
  return titel.length > max + 1 ? `${titel.slice(0, max).join(', ')} und ${titel.length - max} weitere` : aufzaehlung(titel);
}

// KI laut Ping des Import-Dienstes: true/false, null = unbekannt (offline, keine Antwort). „Verfügbar“ merkt sich
// die Seite; „nicht eingerichtet“ wird bei jedem Öffnen neu gefragt (vielleicht ist es inzwischen eingerichtet).
const kiVerfuegbar = new Set();
async function kiPing(proxyUrl) {
  const basis = String(proxyUrl || '').trim();
  if (!basis || globalThis.navigator?.onLine === false) return null;
  if (kiVerfuegbar.has(basis)) return true;
  try {
    const ziel = new URL(/^https?:\/\//i.test(basis) ? basis : `https://${basis}`);
    ziel.searchParams.set('ping', '1');
    const antwort = await fetch(ziel.href, {
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000),
    });
    const json = antwort.ok ? await antwort.json() : null;
    if (json?.ok !== true) return null;
    // ohne Feld `ki` ist der Worker noch die alte Version ohne KI
    if (json.ki === true) kiVerfuegbar.add(basis);
    return json.ki === true;
  } catch {
    return null;
  }
}

/**
 * Was „Übernehmen“ mit schon geplanten Einträgen im Zeitraum macht:
 * frei – Plan-Einträge für leere Plätze (Tag + Mahlzeit); belegt – für schon belegte Plätze;
 * ersetzt – davon die, die „Ersetzen“ einträgt; ersetzbar – vorhandene Einträge, die „Ersetzen“ entfernt.
 * Gekochtes und Notizen (ohne Rezept) bleiben immer; ihr Platz bekommt kein zweites Gericht.
 */
function belegung(planEintraege, vorhanden) {
  const nachPlatz = new Map();
  for (const p of vorhanden) {
    const platz = `${p.date}|${slotVon(p)}`;
    if (!nachPlatz.has(platz)) nachPlatz.set(platz, []);
    nachPlatz.get(platz).push(p);
  }
  const b = { frei: [], belegt: [], ersetzt: [], ersetzbar: [] };
  for (const e of planEintraege) {
    const dort = nachPlatz.get(`${e.datum}|${e.slot}`);
    if (!dort) {
      b.frei.push(e);
      continue;
    }
    b.belegt.push(e);
    if (dort.some((p) => p.cooked || !p.recipeId)) continue;
    b.ersetzt.push(e);
    b.ersetzbar.push(...dort);
  }
  return b;
}

/**
 * Macht „Übernehmen“ rückgängig: neue Einträge weg, ersetzte zurück, dabei angelegte Rezepte wieder heraus.
 * Läuft auch noch, wenn der Planer schon verlassen ist (Meldung in der Woche).
 */
async function uebernahmeRueckgaengig({ eintragIds, wegIds, rezepte, zurueck, sitzung, start }) {
  try {
    const neu = (await Promise.all(eintragIds.map((id) => db.hole('planEntries', id)))).filter(Boolean);
    await db.speichereViele('planEntries', neu.map((p) => ({ ...p, deleted: true })));
    for (const id of wegIds) await db.wiederherstellen('planEntries', id);
    // inzwischen anders verplante oder geänderte Rezepte bleiben
    const verplant = new Set((await db.alle('planEntries')).map((p) => p.recipeId).filter(Boolean));
    for (const [id, stand] of rezepte) {
      const r = await db.hole('recipes', id);
      // ganz entfernen statt Lösch-Markierung: die gilt sonst als „nicht mehr vorschlagen“
      if (r && r.updatedAt === stand && !verplant.has(id)) await db.entferne('recipes', id);
    }
    for (const id of zurueck) if (!verplant.has(id)) await db.loesche('recipes', id);
    schreibeSitzung(sitzung);
    toast('Rückgängig gemacht.', { aktion: { text: 'Zum Plan', onclick: () => navigiere(`#/planer?start=${start}`) } });
  } catch (e) {
    console.error(e);
    toast('Rückgängig hat nicht geklappt.');
  }
}

/** Liste in zufälliger Reihenfolge (Kopie). */
function mische(liste) {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function leseSitzung() {
  try {
    const d = JSON.parse(sessionStorage.getItem(SITZUNG) || 'null');
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

function schreibeSitzung(daten) {
  try {
    if (daten) sessionStorage.setItem(SITZUNG, JSON.stringify(daten));
    else sessionStorage.removeItem(SITZUNG);
  } catch {
    // ohne Sitzungsspeicher ist der Plan nach dem Verlassen weg
  }
}

// Formular ↔ Profil: Freitext („Lieber nicht“, Budget) bleibt so stehen, wie er getippt wurde
function formAusProfil(p, start) {
  return { ...p, start, ohneText: p.ohne.join(', '), budgetText: p.budget != null ? String(p.budget).replace('.', ',') : '' };
}
function profilAusForm(f) {
  return normalisiereProfil({ ...f, ohne: f.ohneText, budget: f.budgetText });
}

/** Zutat in Mengen-Spalte und Rest teilen: { menge: '200 g', name: 'Mehl' }. */
function zutatSpalten(z) {
  const voll = formatZutat(z) || String(z?.raw ?? '');
  const name = [String(z?.name ?? '').trim(), z?.note ? `(${z.note})` : ''].filter(Boolean).join(' ');
  if (name && voll.length > name.length && voll.endsWith(name)) return { menge: voll.slice(0, -name.length).trim(), name };
  return { menge: '', name: voll };
}

function zutatenKnoten(zutaten, faktor) {
  const knoten = [];
  let gruppe = null;
  let liste = null;
  for (const z of zutaten || []) {
    if (!liste || (z.group || null) !== gruppe) {
      gruppe = z.group || null;
      if (gruppe) knoten.push(el('h4', { class: 'zutat-gruppe' }, gruppe));
      knoten.push((liste = el('ul', { class: 'zutaten-liste' })));
    }
    const { menge, name } = zutatSpalten(faktor === 1 ? z : skaliere(z, faktor));
    liste.append(el('li', { class: 'zutat' }, el('span', { class: 'menge' }, menge), el('span', null, name)));
  }
  return knoten.length ? knoten : [el('p', { class: 'nebentext' }, 'Keine Zutaten eingetragen.')];
}

/** Stepper − / Zahl / + zwischen min und max. */
function stepper(name, wert, min, max, aendern) {
  let aktuell = wert;
  const ausgabe = el('output', { 'aria-live': 'polite' }, String(aktuell));
  const minus = el('button', { type: 'button', 'aria-label': `${name}: weniger` }, '−');
  const plus = el('button', { type: 'button', 'aria-label': `${name}: mehr` }, '+');
  const setze = (n) => {
    aktuell = Math.min(max, Math.max(min, n));
    ausgabe.textContent = String(aktuell);
    minus.disabled = aktuell <= min;
    plus.disabled = aktuell >= max;
  };
  minus.addEventListener('click', () => { setze(aktuell - 1); aendern(aktuell); });
  plus.addEventListener('click', () => { setze(aktuell + 1); aendern(aktuell); });
  setze(aktuell);
  return el('span', { class: 'stepper', role: 'group', 'aria-label': name }, minus, ausgabe, plus);
}

/** Chip-Gruppe; istAn(id) sagt, ob ein Chip aktiv ist, klick(id) ändert den Zustand. */
function chipGruppe(name, optionen, istAn, klick) {
  const knoepfe = optionen.map((o) => el('button', {
    type: 'button', class: 'chip', dataset: { id: o.id }, onclick: () => { klick(o.id); abgleichen(); },
  }, o.name));
  function abgleichen() {
    for (const k of knoepfe) {
      const an = istAn(k.dataset.id);
      k.classList.toggle('aktiv', an);
      k.setAttribute('aria-pressed', String(an));
    }
  }
  abgleichen();
  return el('div', { class: 'chips', role: 'group', 'aria-label': name }, knoepfe);
}

/** Schaltet id in der Liste um; hält min/max ein (sonst Meldung) → neue Liste. */
function umschalten(liste, id, { min = 0, max = Infinity, zuWenig = '', zuViel = '' } = {}) {
  if (liste.includes(id)) {
    if (liste.length <= min) {
      toast(zuWenig);
      return liste;
    }
    return liste.filter((x) => x !== id);
  }
  if (liste.length >= max) {
    toast(zuViel);
    return liste;
  }
  return [...liste, id];
}

export async function zeige(container, route) {
  setzeTitel('Automatisch planen');
  const heuteKey = heute();
  let einst = await db.holeEinstellungen();
  const proxyUrl = String(einst.proxyUrl || '').trim();
  let aktiv = true;
  let laeuft = false;

  // Start: angefragter Tag (z. B. Wochenanfang aus der Woche), nie in der Vergangenheit
  const startOptionen = Array.from({ length: START_TAGE }, (_, i) => plusTage(heuteKey, i));
  const klemmeStart = (s) => {
    const wert = istSchluessel(s) && s > heuteKey ? s : heuteKey;
    if (!startOptionen.includes(wert)) startOptionen.push(wert);
    return wert;
  };
  const angefragt = istSchluessel(route.query.get('start')) ? klemmeStart(route.query.get('start')) : null;

  const sitzung = leseSitzung();
  const gespeichert = einst.planerProfil && typeof einst.planerProfil === 'object' ? einst.planerProfil : {};
  const basis = { ...STANDARD_PROFIL, personen: einst.standardPortionen, mahlzeiten: einst.mahlzeiten.filter((m) => SLOT_NAME[m]) };
  // Läden immer aus den Einstellungen (unter Mehr geändert gilt sofort, auch bei gemerktem Formular)
  const laeden = Array.isArray(gespeichert.laeden) && LAEDEN.some((l) => gespeichert.laeden.includes(l.id))
    ? { laeden: gespeichert.laeden } : {};
  const zustand = {
    form: formAusProfil(normalisiereProfil({ ...basis, ...gespeichert, ...(sitzung?.form || {}), ...laeden }),
      angefragt ?? klemmeStart(sitzung?.form?.start)),
    plan: sitzung?.plan && istSchluessel(sitzung.plan.start) && Array.isArray(sitzung.plan.eintraege) ? sitzung.plan : null,
    ki: Array.isArray(sitzung?.ki) ? sitzung.ki.filter((r) => r && istKi(r.id) && Array.isArray(r.ingredients)) : [],
    // ausführliche Meldung, warum es keine KI-Ideen gab (steht beim Plan)
    kiMeldung: typeof sitzung?.kiMeldung?.text === 'string'
      ? { text: sitzung.kiMeldung.text.slice(0, 800), mehr: sitzung.kiMeldung.mehr === true } : null,
    rezepte: new Map(),
    gespeichert: new Set(), // ids der Rezepte in der Rezeptliste (nicht gelöscht)
  };
  // Text der Freitextfelder aus der Sitzung behalten
  if (sitzung?.form) Object.assign(zustand.form, { ohneText: String(sitzung.form.ohneText ?? ''), budgetText: String(sitzung.form.budgetText ?? '') });
  // andere Woche gewünscht oder Plan von gestern: neu planen
  if (zustand.plan && ((angefragt && angefragt !== zustand.plan.start) || zustand.plan.start < heuteKey)) zustand.plan = null;
  if (!zustand.plan) zustand.kiMeldung = null;
  const merke = () => schreibeSitzung({ form: zustand.form, plan: zustand.plan, ki: zustand.ki, kiMeldung: zustand.kiMeldung });
  let kiDa = null;            // KI im Import-Dienst eingerichtet? (Ping; null = unbekannt)
  let kiPingLaeuft = false;
  let aktualisiereKi = null;  // zeichnet die KI-Option im Formular neu

  // Kandidaten: Grundsammlung + eigene Rezepte (+ KI-Ideen mit kleinem Vorzug, damit sie auch vorkommen).
  // Gespeicherte Fassungen gehen vor; gelöschte Grundrezepte und KI-Ideen schlägt der Planer nicht mehr vor.
  async function rezeptPool() {
    const gespeicherteRezepte = await db.alle('recipes', { mitGeloeschten: true });
    const geloescht = new Set(gespeicherteRezepte.filter((r) => r.deleted).map((r) => r.id));
    const pool = new Map();
    for (const r of ladeGrundrezepte()) if (!geloescht.has(r.id)) pool.set(r.id, r);
    for (const r of zustand.ki) if (!geloescht.has(r.id)) pool.set(r.id, { ...r, favorite: true });
    for (const r of gespeicherteRezepte) if (!r.deleted) pool.set(r.id, r);
    zustand.rezepte = pool;
    zustand.gespeichert = new Set(gespeicherteRezepte.filter((r) => !r.deleted).map((r) => r.id));
    return [...pool.values()];
  }

  async function frischeEinstellungen() {
    einst = await db.holeEinstellungen();
    return { eigenePreise: einst.eigenePreise, vorrat: einst.vorrat };
  }

  // Läden im Formular geändert: gleich für den Haushalt speichern (Mehr und Einkaufsliste rechnen damit)
  let laedenKette = Promise.resolve();
  function speichereLaeden(liste) {
    laedenKette = laedenKette.then(async () => {
      const e = await db.holeEinstellungen();
      const profil = e.planerProfil && typeof e.planerProfil === 'object' ? e.planerProfil : {};
      await db.speichereEinstellungen({ planerProfil: { ...profil, laeden: [...liste] } });
    }).catch((e) => console.error(e));
  }

  // Gemerkter Plan mit anderen Läden als jetzt eingestellt: mit denselben Vorlieben und Würfeln neu rechnen
  async function passeLaedenAn() {
    const plan = zustand.plan;
    if (!plan || gleicheLaeden(plan.laeden, zustand.form.laeden)) return;
    const pool = await rezeptPool();
    const preise = await frischeEinstellungen();
    const profil = { ...(plan.profil || profilAusForm(zustand.form)), start: plan.start, laeden: zustand.form.laeden };
    zustand.plan = plane({ rezepte: pool, profil, ...preise, seed: plan.seed, heute: heuteKey });
    merke();
    if (aktiv) toast(`Läden geändert – Plan für ${aufzaehlung(zustand.plan.laeden.map((id) => LADEN_NAME[id] || id))} neu berechnet.`);
  }

  function pruefeKi() {
    if (kiPingLaeuft || kiDa !== null || !proxyUrl) return;
    kiPingLaeuft = true;
    kiPing(proxyUrl).then((w) => {
      kiPingLaeuft = false;
      if (kiDa === null) kiDa = w;
      if (aktiv) aktualisiereKi?.();
    });
  }

  // ------------------------------------------------------------ KI-Ideen
  async function holeIdeen(profil, pool, melde) {
    const hauptPlaetze = profil.tage * profil.mahlzeiten.filter((m) => m !== 'frueh').length;
    const mahlzeit = hauptPlaetze > 0 ? 'haupt' : 'frueh';
    const anzahl = Math.min(3, hauptPlaetze || profil.tage);
    // bekannte Gerichte dieser Art nicht noch einmal vorschlagen lassen (bisherige Ideen zuerst);
    // Titel eigener Rezepte bleiben auf dem Gerät
    const bekannt = pool.filter((r) => r.herkunft === 'grund' && rezeptMeta(r).mahlzeit === mahlzeit && passtZumProfil(r, profil).ok)
      .map((r) => r.title);
    const vermeiden = [...zustand.ki.map((r) => r.title), ...mische(bekannt)];
    melde('KI sucht neue Ideen …');
    try {
      const roh = await holeKiRezepte(proxyUrl, kiAnfrage(profil, { anzahl, mahlzeit, vermeiden }));
      const { rezepte } = pruefeKiRezepte(roh, profil, { vorhanden: pool.filter((r) => !istKi(r.id)).map((r) => r.title) });
      const neu = rezepte.filter((r) => r.mahlzeit === mahlzeit).map(kiRezeptZuRezept);
      zustand.ki = [...neu, ...zustand.ki.filter((r) => !neu.some((n) => n.id === r.id))].slice(0, MAX_KI);
      if (!neu.length) {
        zustand.kiMeldung = { text: 'Die Ideen der KI passten diesmal nicht zu deinen Vorlieben.', mehr: false };
        if (aktiv) toast(KI_KURZ.sonst);
      }
    } catch (e) {
      if (!(e instanceof KiFehler)) console.error(e);
      const code = e instanceof KiFehler ? e.code : null;
      zustand.kiMeldung = { text: e instanceof KiFehler ? e.message : 'Die KI-Anfrage hat nicht geklappt.', mehr: KI_EINRICHTEN.has(code) };
      // nicht eingerichtet oder Tageskontingent aufgebraucht: nicht bei jedem Plan wieder fragen
      if (code === 'ki-fehlt' || code === 'limit') zustand.form.kiIdeen = false;
      if (code === 'ki-fehlt') {
        kiDa = false;
        kiVerfuegbar.delete(proxyUrl);
      }
      if (aktiv) toast(KI_KURZ[code] ?? KI_KURZ.sonst);
    }
  }

  // ------------------------------------------------------------ Planen
  async function erstellen({ seed, mitKi, melde = () => {} }) {
    if (laeuft) return;
    laeuft = true;
    try {
      const profil = zustand.plan && !mitKi ? normalisiereProfil({ ...zustand.plan.profil, start: zustand.plan.start })
        : profilAusForm(zustand.form);
      if (mitKi) {
        zustand.kiMeldung = null;
        await db.speichereEinstellungen({ planerProfil: { ...profil, start: null } }).catch((e) => console.error(e));
      }
      let pool = await rezeptPool();
      if (mitKi && profil.kiIdeen && proxyUrl && kiDa !== false) {
        await holeIdeen(profil, pool, melde);
        pool = await rezeptPool();
      }
      melde('Plane …');
      await pause();
      const preise = await frischeEinstellungen();
      zustand.plan = plane({ rezepte: pool, profil, ...preise, seed, heute: heuteKey });
      merke();
      if (!aktiv) return;
      zeichneErgebnis();
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      if (aktiv) toast('Planen hat nicht geklappt.');
      melde('');
    } finally {
      laeuft = false;
    }
  }

  // → true, wenn getauscht wurde; still: keine Meldung, wenn nichts anderes passt
  async function tauschen(index, { still = false } = {}) {
    if (laeuft || !zustand.plan) return false;
    laeuft = true;
    try {
      const alt = zustand.plan.eintraege[index];
      const pool = await rezeptPool();
      const preise = await frischeEinstellungen();
      const neu = tausche(zustand.plan, index, { rezepte: pool, profil: zustand.plan.profil, ...preise });
      const ersatz = neu.eintraege.find((e) => e.datum === alt.datum && e.slot === alt.slot);
      if (neu === zustand.plan || !ersatz || ersatz.rezeptId === alt.rezeptId) {
        if (!still) toast('Keine andere passende Idee gefunden.');
        return false;
      }
      zustand.plan = neu;
      merke();
      if (aktiv) zeichneErgebnis(`t:${alt.datum}:${alt.slot}`);
      return true;
    } catch (e) {
      console.error(e);
      toast('Tauschen hat nicht geklappt.');
      return false;
    } finally {
      laeuft = false;
    }
  }

  // Grundrezept oder KI-Idee, die nicht in der Rezeptliste steht → Vorlage, sonst null
  function vorlage(id) {
    if (zustand.gespeichert.has(id)) return null;
    return ladeGrundrezepte().find((r) => r.id === id) ?? zustand.ki.find((r) => r.id === id) ?? null;
  }

  // „Nicht mehr vorschlagen“: eine Lösch-Markierung merkt es sich (bleibt auch beim Aufräumen, siehe db.bereinige)
  async function ausblenden(index, quelle) {
    const titel = quelle.title || 'Das Gericht';
    try {
      await db.speichere('recipes', { ...structuredClone(quelle), deleted: true });
    } catch (e) {
      console.error(e);
      toast('Das hat nicht geklappt.');
      return;
    }
    const getauscht = await tauschen(index, { still: true });
    toast(getauscht ? `„${titel}“ wird nicht mehr vorgeschlagen.`
      : `„${titel}“ wird nicht mehr vorgeschlagen – in diesem Plan bleibt es, weil nichts anderes passt.`, {
      aktion: {
        text: 'Rückgängig',
        onclick: async () => {
          const d = await db.hole('recipes', quelle.id, { mitGeloeschten: true });
          if (d?.deleted) await db.entferne('recipes', quelle.id);
        },
      },
    });
  }

  async function ansehen(eintrag, index) {
    const r = zustand.rezepte.get(eintrag.rezeptId);
    if (!r) {
      toast('Das Rezept ist nicht mehr da.');
      return;
    }
    const portionen = eintrag.portionen;
    const faktor = Number(r.servings) > 0 ? portionen / Number(r.servings) : 1;
    const ki = istKi(r.id) || r.herkunft === 'ki';
    const herkunft = ki ? 'KI-Idee' : r.herkunft === 'grund' ? 'Grundsammlung' : 'Eigenes Rezept';
    const quelle = vorlage(r.id);
    const w = await dialog({
      titel: r.title || 'Rezept',
      fokus: false,
      inhalt: [
        el('p', { class: 'meta' }, [zeitText(rezeptMeta(r).totalMin), `für ${mehrzahl(portionen, 'Person', 'Personen')}`, herkunft].filter(Boolean).join(' · ')),
        ki ? el('p', { class: 'ki-hinweis' }, symbol(SYMBOLE.automatisch), 'KI-Idee – bitte vor dem Kochen prüfen.') : null,
        el('h3', null, 'Zutaten'),
        zutatenKnoten(r.ingredients, faktor),
        el('h3', null, 'Zubereitung'),
        r.steps?.length
          ? el('ol', { class: 'schritte' }, r.steps.map((s) => el('li', { class: 'schritt' }, s.text)))
          : el('p', { class: 'nebentext' }, 'Keine Zubereitungsschritte eingetragen.'),
      ],
      knoepfe: [
        ...(quelle ? [{ text: 'Nicht mehr vorschlagen', wert: 'ausblenden', art: 'flach' }] : []),
        { text: 'Schließen', wert: null, art: 'primaer' },
      ],
    });
    if (w === 'ausblenden' && aktiv && zustand.plan?.eintraege[index] === eintrag) await ausblenden(index, quelle);
  }

  // ------------------------------------------------------------ Übernehmen
  async function uebernehmen() {
    const plan = zustand.plan;
    if (laeuft || !plan) return;
    if (!plan.eintraege.length) {
      toast('Der Plan ist leer – ändere die Vorlieben und plane neu.');
      return;
    }
    laeuft = true;
    try {
      const vorhanden = (await db.alle('planEntries')).filter((p) => p.date >= plan.start && p.date <= plan.ende);
      const b = belegung(plan.eintraege, vorhanden);
      let rein = b.frei;
      let weg = [];
      if (b.ersetzbar.length) {
        // belegte Plätze: nur Freies füllen (Standard) oder geplante Gerichte ersetzen – Gekochtes und Notizen bleiben
        const bleiben = b.belegt.length - b.ersetzt.length;
        const w = await auswahl(`${mehrzahl(b.belegt.length, 'Mahlzeit ist', 'Mahlzeiten sind')} schon belegt`, [
          {
            text: 'Nur freie Mahlzeiten füllen', wert: 'frei',
            beschreibung: `${b.frei.length ? `${mehrzahl(b.frei.length, 'Gericht kommt', 'Gerichte kommen')} dazu` : 'Es kommt nichts dazu'}, `
              + 'alles schon Geplante bleibt.',
          },
          {
            text: 'Ersetzen', wert: 'ersetzen',
            beschreibung: `Entfernt ${titelListe(b.ersetzbar)}.`
              + (bleiben ? ` ${mehrzahl(bleiben, 'Mahlzeit', 'Mahlzeiten')} mit Gekochtem oder Notiz ${bleiben === 1 ? 'bleibt' : 'bleiben'}.` : ''),
          },
        ]);
        if (!w) return;
        if (w === 'ersetzen') {
          rein = [...b.frei, ...b.ersetzt];
          weg = b.ersetzbar;
        }
      }
      if (!rein.length) {
        toast('Alle Mahlzeiten im Zeitraum sind schon belegt – nichts übernommen.');
        return;
      }
      const eintraege = plan.eintraege.filter((e) => rein.includes(e));
      // benutzte Grund- und KI-Rezepte speichern, die noch nicht da sind; gelöschte eigene Fassungen zurückholen
      // (nie die Grundfassung über eine gelöschte schreiben)
      const grund = new Map(ladeGrundrezepte().map((r) => [r.id, r]));
      const ki = new Map(zustand.ki.map((r) => [r.id, r]));
      const neueRezepte = [];
      const zurueck = [];
      const fehlt = new Set();
      for (const id of new Set(eintraege.map((e) => e.rezeptId))) {
        const d = await db.hole('recipes', id, { mitGeloeschten: true });
        if (d && !d.deleted) continue;
        if (d) {
          await db.wiederherstellen('recipes', id);
          zurueck.push(id);
          continue;
        }
        const quelle = grund.get(id) ?? ki.get(id);
        if (quelle) neueRezepte.push(structuredClone(quelle));
        else fehlt.add(id);
      }
      const angelegt = await db.speichereViele('recipes', neueRezepte);
      await db.speichereViele('planEntries', weg.map((p) => ({ ...p, deleted: true })));
      const gespeichert = await db.speichereViele('planEntries', eintraege.map((e) => ({
        date: e.datum, slot: e.slot, recipeId: fehlt.has(e.rezeptId) ? null : e.rezeptId, title: e.titel,
        servings: e.portionen, note: '', cooked: false, tripId: null,
      })));
      const vorher = { form: zustand.form, plan, ki: zustand.ki, kiMeldung: zustand.kiMeldung };
      zustand.plan = null;
      schreibeSitzung(null);
      const uebersprungen = plan.eintraege.length - eintraege.length;
      toast(uebersprungen ? `Plan übernommen – ${mehrzahl(uebersprungen, 'belegte Mahlzeit', 'belegte Mahlzeiten')} übersprungen.`
        : 'Plan übernommen.', {
        dauer: 8000,
        aktionen: [
          {
            text: 'Rückgängig',
            onclick: () => uebernahmeRueckgaengig({
              eintragIds: gespeichert.map((p) => p.id), wegIds: weg.map((p) => p.id),
              rezepte: angelegt.map((r) => [r.id, r.updatedAt]), zurueck, sitzung: vorher, start: plan.start,
            }),
          },
          { text: 'Zur Einkaufsliste', onclick: () => navigiere(`#/einkauf?von=${plan.start}&bis=${plan.ende}`) },
        ],
      });
      // ersetzen: „Zurück“ in der Woche führt nicht wieder in den (jetzt leeren) Planer
      navigiere(`#/woche/${plan.start}`, { ersetzen: true });
    } catch (e) {
      console.error(e);
      toast('Übernehmen hat nicht geklappt.');
    } finally {
      laeuft = false;
    }
  }

  // ------------------------------------------------------------ Formular
  function karte(titel, ...inhalt) {
    return el('section', { class: 'karte' }, el('h2', null, titel), ...inhalt);
  }

  function zeichneFormular() {
    const f = zustand.form;
    const aendern = (teil) => {
      Object.assign(f, teil);
      merke();
    };
    const status = el('p', { class: 'nebentext mittig', role: 'status', 'aria-live': 'polite' });
    const ohneFeld = el('input', {
      type: 'text', value: f.ohneText, placeholder: 'z. B. Pilze, Koriander', autocomplete: 'off', enterkeyhint: 'done',
      oninput: () => aendern({ ohneText: ohneFeld.value }),
    });
    const budgetFeld = el('input', {
      type: 'text', inputmode: 'decimal', value: f.budgetText, placeholder: 'z. B. 60', autocomplete: 'off', enterkeyhint: 'done',
      oninput: () => aendern({ budgetText: budgetFeld.value }),
    });
    const startFeld = el('select', { onchange: () => aendern({ start: startFeld.value }) },
      startOptionen.map((d) => {
        const rel = relativerName(d, heuteKey);
        const text = formatDatum(d, { wochentag: true });
        return el('option', { value: d }, rel ? `${rel} (${text})` : text);
      }));
    startFeld.value = f.start;
    const knopf = el('button', {
      type: 'button', class: 'knopf gross primaer',
      onclick: async () => {
        const budget = f.budgetText.trim();
        if (budget && !(parseZahl(budget) > 0)) {
          toast('Bitte das Budget als Zahl in Euro eingeben, z. B. 60.');
          budgetFeld.focus();
          return;
        }
        knopf.disabled = true;
        await erstellen({
          seed: Math.floor(Math.random() * 1e9), mitKi: true,
          melde: (text) => { status.textContent = text; },
        });
        // nur erreicht, wenn das Formular noch steht (z. B. nach einem Fehler)
        knopf.disabled = false;
        status.textContent = '';
      },
    }, symbol(SYMBOLE.automatisch), 'Plan erstellen');

    // KI-Option: aus ohne Import-Dienst oder wenn der Dienst meldet, dass die KI fehlt (Ping läuft im Hintergrund)
    const kiBox = el('input', { type: 'checkbox', onchange: (ev) => aendern({ kiIdeen: ev.target.checked }) });
    const kiText = el('p', { class: 'nebentext' });
    aktualisiereKi = () => {
      const aus = !proxyUrl || kiDa === false;
      kiBox.disabled = aus;
      kiBox.checked = f.kiIdeen && !aus;
      const mehr = el('a', { href: '#/mehr' }, 'Mehr → Import-Dienst');
      if (!proxyUrl) kiText.replaceChildren('Dafür brauchst du den Import-Dienst: ', mehr, '.');
      else if (kiDa === false) kiText.replaceChildren('Im Import-Dienst ist die KI noch nicht eingerichtet – Anleitung unter ', mehr, '.');
      else kiText.replaceChildren('KI-Ideen sind Vorschläge – bitte vor dem Kochen prüfen.');
    };
    aktualisiereKi();
    pruefeKi();
    container.replaceChildren(el('div', { class: 'planer-form' },
      karte('Was esst ihr gern?',
        chipGruppe('Was esst ihr gern?', PROTEINE, (id) => f.protein.includes(id), (id) => aendern({
          protein: umschalten(f.protein, id, { min: 1, zuWenig: 'Wähl mindestens eine Sache aus.' }) })),
        el('p', { class: 'nebentext' }, 'Vegetarisch schließt vegane Gerichte ein.')),
      karte('Lieber nicht',
        chipGruppe('Allergien und Unverträglichkeiten', ALLERGENE, (id) => f.allergene.includes(id),
          (id) => aendern({ allergene: umschalten(f.allergene, id) })),
        el('label', { class: 'feld' }, el('span', null, 'Weitere Zutaten (mit Komma getrennt)'), ohneFeld),
        el('p', { class: 'nebentext' }, 'Keine Garantie bei Allergien – Zutaten bitte prüfen.')),
      karte('Kochzeit',
        chipGruppe('Kochzeit', KOCHZEITEN, (id) => f.kochzeit === id, (id) => aendern({ kochzeit: id }))),
      karte('Personen und Tage',
        el('div', { class: 'feld-zeile' }, el('span', null, 'Personen'), stepper('Personen', f.personen, 1, 12, (n) => aendern({ personen: n }))),
        el('div', { class: 'feld-zeile' }, el('span', null, 'Tage'), stepper('Tage', f.tage, 1, 14, (n) => aendern({ tage: n }))),
        el('label', { class: 'feld-zeile' }, el('span', null, 'Start'), startFeld)),
      karte('Mahlzeiten',
        chipGruppe('Mahlzeiten', MAHLZEITEN, (id) => f.mahlzeiten.includes(id), (id) => aendern({
          mahlzeiten: umschalten(f.mahlzeiten, id, { min: 1, zuWenig: 'Wähl mindestens eine Mahlzeit aus.' }) }))),
      karte('Supermärkte',
        chipGruppe('Supermärkte', LAEDEN, (id) => f.laeden.includes(id), (id) => {
          const neu = umschalten(f.laeden, id, { min: 1, max: 3, zuWenig: 'Mindestens ein Laden', zuViel: 'Höchstens 3 Läden' });
          if (neu === f.laeden) return;
          aendern({ laeden: neu });
          speichereLaeden(neu);
        }),
        el('p', { class: 'nebentext' }, 'Bei mehreren Läden zählt je Zutat der günstigste.')),
      karte('Budget',
        el('label', { class: 'feld' }, el('span', null, '€ für den ganzen Zeitraum (optional)'), budgetFeld),
        el('p', { class: 'nebentext' }, PREIS_HINWEIS)),
      karte('Optionen',
        el('label', { class: 'checkbox' },
          el('input', { type: 'checkbox', checked: f.eigeneRezepte, onchange: (ev) => aendern({ eigeneRezepte: ev.target.checked }) }),
          el('span', null, 'Meine eigenen Rezepte mit einplanen')),
        el('label', { class: 'checkbox' }, kiBox, el('span', null, 'Neue Ideen von der KI (bis zu 3 neue Rezepte)')),
        kiText),
      el('div', { class: 'stapel' },
        knopf,
        status,
        zustand.plan ? el('button', {
          type: 'button', class: 'knopf flach',
          onclick: async () => {
            await passeLaedenAn().catch((e) => console.error(e));
            if (aktiv) zeichneErgebnis();
          },
        }, 'Zurück zum letzten Plan') : null)));
  }

  // ------------------------------------------------------------ Ergebnis
  function zusammenfassung(plan) {
    const k = plan.kosten || {};
    const laeden = (plan.laeden || []).filter((id) => Number(k.proLaden?.[id]) > 0.004);
    const budgetText = plan.imBudget ? 'im Budget' : `≈ ${Math.max(1, Math.round(plan.ueberBudget))} € über Budget`;
    return el('section', { class: 'karte planer-zusammenfassung' },
      el('div', { class: 'leiste verteilt' },
        el('h2', null,
          el('span', { class: 'betrag' }, formatEuroGerundet(k.gesamt ?? 0)),
          el('span', { class: 'nebentext' }, ` für ${mehrzahl(plan.tage, 'Tag', 'Tage')} · ${mehrzahl(plan.personen, 'Person', 'Personen')}`)),
        el('button', {
          type: 'button', class: 'knopf klein',
          onclick: () => { zeichneFormular(); window.scrollTo(0, 0); },
        }, symbol(SYMBOLE.bearbeiten), 'Ändern')),
      plan.budget != null ? el('div', { class: 'leiste' },
        el('span', { class: ['badge', plan.imBudget ? 'budget-ok' : 'budget-drueber'] }, budgetText),
        el('span', { class: 'nebentext' }, `Budget: ${String(plan.budget).replace('.', ',')} €`)) : null,
      laeden.length ? el('p', { class: 'planer-laeden' }, laeden.map((id) =>
        el('span', null, el('span', { class: 'laden' }, LADEN_NAME[id] || id), ` ${formatEuroGerundet(k.proLaden[id])}`))) : null,
      el('p', { class: 'nebentext' }, `${formatZeitraum(plan.start, plan.ende)} · Preise geschätzt · Stand ${STAND_TEXT}`),
      el('p', { class: 'nebentext' }, 'Je Gericht stehen die Mehrkosten im gemeinsamen Einkauf – angebrochene Packungen werden weiterverwendet.'));
  }

  function warnungen(plan) {
    const texte = [...(plan.hinweise || [])];
    const gruende = new Map();
    for (const f of plan.fehlend || []) gruende.set(f.grund, (gruende.get(f.grund) || 0) + 1);
    for (const [grund, n] of gruende) texte.push(`${grund} (${mehrzahl(n, 'Mahlzeit', 'Mahlzeiten')} ohne Gericht).`);
    if (!plan.eintraege.length) texte.push('Mit diesen Vorlieben passt kein Gericht. Tippe auf „Ändern“ und lockere die Auswahl.');
    return texte.length ? el('div', { class: 'hinweis warnung', role: 'status' }, texte.map((t) => el('p', null, t))) : null;
  }

  // Warum es keine KI-Ideen gab – bleibt beim Plan stehen (zum Nachlesen und Kopieren der Anleitung)
  function kiHinweis() {
    const m = zustand.kiMeldung;
    if (!m?.text) return null;
    return el('div', { class: 'hinweis' },
      el('p', null, el('span', { class: 'fett' }, 'Keine neuen KI-Ideen: '), m.text),
      m.mehr ? el('p', null, el('a', { href: '#/mehr' }, 'Mehr → Import-Dienst öffnen')) : null);
  }

  function eintragZeile(e, index, mitMahlzeit) {
    const rezept = zustand.rezepte.get(e.rezeptId);
    const ki = istKi(e.rezeptId) || rezept?.herkunft === 'ki';
    const kosten = Number(e.kosten) > 0.004 ? formatEuroGerundet(e.kosten) : 'keine Mehrkosten';
    return el('div', { class: 'planer-eintrag' },
      el('div', { class: 'haupt' },
        mitMahlzeit ? el('span', { class: 'mahlzeit-titel' }, SLOT_NAME[e.slot] || e.slot) : null,
        el('span', { class: 'titel' }, e.titel),
        ki ? el('span', { class: 'ki-hinweis' }, symbol(SYMBOLE.automatisch), 'KI-Idee – bitte vor dem Kochen prüfen') : null),
      el('span', { class: 'nebentext' }, [zeitText(e.minuten), kosten].filter(Boolean).join(' · ')),
      el('div', { class: 'leiste' },
        el('button', {
          type: 'button', class: 'knopf klein', 'aria-label': `Tauschen: ${e.titel}`, dataset: { fokus: `t:${e.datum}:${e.slot}` },
          onclick: () => tauschen(index),
        }, symbol(SYMBOLE.tauschen), 'Tauschen'),
        el('button', {
          type: 'button', class: 'knopf klein flach', 'aria-label': `Ansehen: ${e.titel}`, onclick: () => ansehen(e, index),
        }, symbol(SYMBOLE.ansehen), 'Ansehen')));
  }

  function tagKarte(plan, datum, mitMahlzeit) {
    const rel = relativerName(datum, heuteKey);
    const zeilen = [];
    for (const m of MAHLZEITEN) {
      plan.eintraege.forEach((e, i) => {
        if (e.datum === datum && e.slot === m.id) zeilen.push(eintragZeile(e, i, mitMahlzeit));
      });
      if ((plan.fehlend || []).some((f) => f.datum === datum && f.slot === m.id)) {
        zeilen.push(el('div', { class: 'planer-eintrag' }, el('div', { class: 'haupt' },
          mitMahlzeit ? el('span', { class: 'mahlzeit-titel' }, m.name) : null,
          el('span', { class: 'gedimmt' }, 'Kein passendes Gericht'))));
      }
    }
    return el('section', { class: ['tag', 'planer-tag', datum === heuteKey && 'heute'] },
      el('h3', { class: 'tag-kopf' },
        el('span', null, wochentagLang(datum)),
        el('span', { class: 'nebentext' }, formatDatum(datum)),
        rel ? el('span', { class: ['badge', rel === 'Heute' ? 'gruen' : 'grau'] }, rel) : null),
      zeilen);
  }

  function zeichneErgebnis(fokus = null) {
    const plan = zustand.plan;
    aktualisiereKi = null;
    if (!plan) {
      zeichneFormular();
      return;
    }
    const slots = new Set([...plan.eintraege, ...(plan.fehlend || [])].map((e) => e.slot));
    const tage = Array.from({ length: plan.tage }, (_, i) => plusTage(plan.start, i));
    const neuPlanen = el('button', {
      type: 'button', class: 'knopf',
      onclick: () => erstellen({ seed: (Number(plan.seed) || 0) + 1, mitKi: false, melde: (t) => { neuPlanen.disabled = Boolean(t); } }),
    }, symbol(SYMBOLE.automatisch), 'Neu planen');
    const leer = !plan.eintraege.length; // nichts passt: keine leeren Tage zeigen, sondern zum Ändern führen
    container.replaceChildren(...[
      zusammenfassung(plan),
      warnungen(plan),
      kiHinweis(),
      ...(leer ? [] : tage.map((d) => tagKarte(plan, d, slots.size > 1))),
      el('div', { class: 'aktionen-leiste planer-aktionen' }, leer
        ? el('button', { type: 'button', class: 'knopf primaer', onclick: () => { zeichneFormular(); window.scrollTo(0, 0); } },
          symbol(SYMBOLE.bearbeiten), 'Vorlieben ändern')
        : [neuPlanen, el('button', { type: 'button', class: 'knopf primaer', onclick: uebernehmen }, symbol(SYMBOLE.haken), 'Übernehmen')]),
    ].filter(Boolean));
    if (fokus) {
      const ziel = [...container.querySelectorAll('[data-fokus]')].find((x) => x.dataset.fokus === fokus);
      ziel?.focus({ preventScroll: true });
    }
  }

  try {
    if (zustand.plan) {
      await rezeptPool(); // für „Ansehen“ und die KI-Kennzeichnung
      await passeLaedenAn();
      zeichneErgebnis();
    } else {
      zeichneFormular();
    }
  } catch (e) {
    console.error(e);
    container.replaceChildren(fehlerAnzeige('Der Planer konnte nicht geladen werden.', e));
  }
  return () => {
    aktiv = false;
  };
}
