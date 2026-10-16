// Import-Dienst für „Einkauf & Koch“ – ein Cloudflare Worker im kostenlosen Plan.
//
// Wozu? Der Browser darf Rezeptseiten (chefkoch.de, rewe.de, …) wegen CORS nicht direkt lesen.
// Dieser Worker holt die Seite, sucht darin nur die Rezeptdaten (JSON-LD) und den Titel und
// schickt nur diese an die App zurück – nie die ganze Seite. Geheimnisse braucht er keine.
//
// Einrichten (einmalig, alles im Browser, kein Programm nötig):
//   1. Auf https://dash.cloudflare.com kostenlos registrieren und anmelden.
//   2. Links „Workers & Pages“ → „Create“ (Erstellen) → Vorlage „Hello World“ → „Deploy“.
//   3. „Edit code“ (Code bearbeiten) öffnen, den vorhandenen Code komplett ersetzen durch den
//      gesamten Inhalt dieser Datei → „Deploy“.
//   4. Die angezeigte Adresse https://<name>.<konto>.workers.dev kopieren und in der App unter
//      Mehr → Import-Dienst eintragen, „Speichern“ und „Testen“ tippen.
//   Die Adresse gehört nur in die App auf dem Gerät, nicht ins öffentliche Repo.
//
// Weitere erlaubte Herkunft (z. B. die App lokal am PC): im Worker unter „Settings“ →
// „Variables and Secrets“ eine Text-Variable ERLAUBTE_ORIGINS anlegen, mehrere Einträge mit
// Komma getrennt, z. B. „http://localhost:8080, https://beispiel.github.io“. Die Standard-Origin
// unten bleibt immer erlaubt. Weitere Rezeptseiten: Domain in ERLAUBTE_HOSTS ergänzen → „Deploy“.
//
// Schutz: nur GET/OPTIONS, nur die App-Origin, nur https-Adressen der Erlaubt-Liste (auch nach
// jeder Weiterleitung geprüft), höchstens 3 MB pro Seite. Der Free-Plan kann nichts kosten.

const VERSION = '1';
const MAX_BYTES = 3 * 1024 * 1024;        // Seitengröße
const MAX_BLOECKE = 10;                   // JSON-LD-Blöcke in der Antwort
const MAX_BLOCK_ZEICHEN = 500 * 1024;     // je Block
const MAX_KANDIDATEN = 40;                // gesammelte Blöcke vor der Auswahl
const MAX_WEITERLEITUNGEN = 5;
const MAX_URL_LAENGE = 2048;
const ZEITLIMIT_MS = 12000;
const WEITERLEITUNG = new Set([301, 302, 303, 307, 308]);
const BLOCKIERT = new Set([401, 403, 451]);

const ANFRAGE_HEADER = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/156.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9',
};

/** Rezeptseiten, die abgerufen werden dürfen (inkl. Subdomains wie www.). */
export const ERLAUBTE_HOSTS = Object.freeze([
  'chefkoch.de', 'rewe.de', 'lecker.de', 'eatsmarter.de', 'kitchenstories.com',
  'essen-und-trinken.de', 'kochbar.de', 'springlane.de', 'edeka.de', 'emmikochteinfach.de',
  'sallys-blog.de', 'gutekueche.de', 'einfachbacken.de', 'einfachkochen.de', 'lidl-kochen.de',
  'hellofresh.de', 'brigitte.de', 'zuckerjagdwurst.com', 'biancazapatka.com', 'elavegan.com',
  'kuechengoetter.de', 'ichkoche.at', 'bettybossi.ch', 'migusto.migros.ch', 'kochkarussell.com',
  'malteskitchen.de',
]);

/** Kurzlink-Dienste: nur als Zwischenstation einer Weiterleitung erlaubt, nie als Ziel. */
export const ZWISCHEN_HOSTS = Object.freeze(['share.google', 'search.app', 'goo.gl', 'g.co', 't.co', 'bit.ly']);

/** Herkunft der App; weitere per Umgebungsvariable ERLAUBTE_ORIGINS. */
export const ERLAUBTE_ORIGINS = Object.freeze(['https://patrick19921992.github.io']);

// ---------------------------------------------------------------- Prüfungen (rein)

/** true, wenn host genau eine Domain der Liste ist oder eine Subdomain davon. */
export function hostErlaubt(host, liste) {
  const h = String(host ?? '').toLowerCase();
  if (!h || !Array.isArray(liste)) return false;
  return liste.some((d) => h === d || h.endsWith('.' + d));
}

// Liefert { url } oder { fehler: 'url' | 'host' }.
function pruefe(text) {
  if (typeof text !== 'string' && !(text instanceof URL)) return { fehler: 'url' };
  const roh = String(text).trim();
  if (!roh || roh.length > MAX_URL_LAENGE) return { fehler: 'url' };
  let u;
  try { u = new URL(roh); } catch { return { fehler: 'url' }; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port !== '') return { fehler: 'url' };
  if (!hostErlaubt(u.hostname, ERLAUBTE_HOSTS) && !hostErlaubt(u.hostname, ZWISCHEN_HOSTS)) {
    return { fehler: 'host' };
  }
  u.hash = '';
  return { url: u };
}

/** Prüft eine Ziel-Adresse: nur https, ohne Zugangsdaten und Port, Host erlaubt. → URL | null */
export function pruefeZielUrl(text) {
  return pruefe(text).url || null;
}

/** CORS-Header für eine bereits geprüfte Origin. */
export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function normalisiereOrigin(o) {
  return String(o ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

/** Standard-Origins plus die aus env.ERLAUBTE_ORIGINS (Komma-Liste oder Array). */
export function erlaubteOrigins(env = {}) {
  const zusatz = env?.ERLAUBTE_ORIGINS;
  const liste = Array.isArray(zusatz) ? zusatz : String(zusatz ?? '').split(/[,\s]+/);
  const extra = liste.map(normalisiereOrigin).filter((o) => o && o !== 'null' && o !== '*');
  return [...ERLAUBTE_ORIGINS, ...extra];
}

// ---------------------------------------------------------------- Auswertung

const ENTITAETEN = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü',
  Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', ndash: '–', mdash: '—',
  bdquo: '„', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', hellip: '…',
};

// Titel: Entities dekodieren, Leerraum zusammenfassen, kürzen.
function saeubereTitel(roh) {
  return String(roh ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : m;
      }
      return Object.hasOwn(ENTITAETEN, e) ? ENTITAETEN[e] : m;
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// Höchstens 10 Blöcke; bei mehr haben Blöcke mit „Recipe“ Vorrang, Reihenfolge bleibt.
function waehleBloecke(kandidaten) {
  const saubere = kandidaten.map((s) => String(s).trim())
    .filter((s) => s && s.length <= MAX_BLOCK_ZEICHEN);
  if (saubere.length <= MAX_BLOECKE) return saubere;
  return saubere.map((s, i) => ({ s, i, p: /recipe/i.test(s) ? 0 : 1 }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .slice(0, MAX_BLOECKE)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

/** Ersatz für HTMLRewriter (z. B. in Node): JSON-LD-Blöcke und Titel per Regex. */
export function sammleJsonLd(html) {
  const text = String(html ?? '');
  const kandidaten = [];
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']?\s*application\/ld\+json\b/i.test(m[1])) continue;
    if (m[2].length > MAX_BLOCK_ZEICHEN) continue;
    kandidaten.push(m[2]);
    if (kandidaten.length >= MAX_KANDIDATEN) break;
  }
  const titel = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text);
  return { title: saeubereTitel(titel ? titel[1] : ''), jsonld: waehleBloecke(kandidaten) };
}

// Fehler mit fertiger JSON-Antwort.
class DienstFehler extends Error {
  constructor(status, daten) {
    super(daten.fehler);
    this.status = status;
    this.daten = daten;
  }
}

// Zählt Bytes beim Durchreichen und bricht über der Grenze ab.
function zaehlStrom(zustand) {
  let gelesen = 0;
  return new TransformStream({
    transform(stueck, steuerung) {
      gelesen += stueck.byteLength ?? 0;
      if (gelesen > MAX_BYTES) {
        zustand.zuGross = true;
        steuerung.error(new Error('zu-gross'));
        return;
      }
      steuerung.enqueue(stueck);
    },
  });
}

async function leseAlles(strom) {
  const leser = strom.getReader();
  const teile = [];
  let laenge = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    teile.push(value);
    laenge += value.byteLength;
  }
  const alles = new Uint8Array(laenge);
  let pos = 0;
  for (const t of teile) { alles.set(t, pos); pos += t.byteLength; }
  return alles;
}

function dekodiere(bytes, typ) {
  const zeichensatz = /charset\s*=\s*["']?([\w-]+)/i.exec(typ)?.[1] || 'utf-8';
  try { return new TextDecoder(zeichensatz).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

// Cloudflare: HTMLRewriter arbeitet gestreamt und spart CPU-Zeit.
async function mitRewriter(strom, typ) {
  const bloecke = [];
  let aktuell = null;
  let titel = '';
  let titelNr = 0;
  const rewriter = new globalThis.HTMLRewriter()
    .on('script[type="application/ld+json" i]', {
      element() {
        aktuell = bloecke.length < MAX_KANDIDATEN ? { text: '', zuLang: false } : null;
        if (aktuell) bloecke.push(aktuell);
      },
      text(t) {
        if (!aktuell || aktuell.zuLang) return;
        aktuell.text += t.text;
        if (aktuell.text.length > MAX_BLOCK_ZEICHEN) { aktuell.zuLang = true; aktuell.text = ''; }
      },
    })
    .on('title', {
      element() { titelNr += 1; },                 // nur der erste Titel (nicht die in SVGs)
      text(t) { if (titelNr === 1 && titel.length < 2000) titel += t.text; },
    });
  const ausgabe = rewriter.transform(new Response(strom, { headers: { 'Content-Type': typ } }));
  const leser = ausgabe.body.getReader();
  while (!(await leser.read()).done) { /* nur durchlaufen lassen */ }
  return {
    title: saeubereTitel(titel),
    jsonld: waehleBloecke(bloecke.filter((b) => !b.zuLang).map((b) => b.text)),
  };
}

async function werteAus(antwort) {
  const typ = antwort.headers.get('Content-Type') || 'text/html; charset=utf-8';
  if (!antwort.body) return { title: '', jsonld: [] };
  const zustand = { zuGross: false };
  const strom = antwort.body.pipeThrough(zaehlStrom(zustand));
  try {
    if (typeof globalThis.HTMLRewriter === 'function') return await mitRewriter(strom, typ);
    return sammleJsonLd(dekodiere(await leseAlles(strom), typ));
  } catch (e) {
    if (zustand.zuGross) throw new DienstFehler(413, { fehler: 'zu-gross' });
    throw e;
  }
}

function verwerfe(antwort) {
  try { antwort.body?.cancel().catch(() => {}); } catch { /* egal */ }
}

// Holt die Seite und folgt Weiterleitungen selbst; jedes Ziel wird erneut geprüft.
async function holeSeite(start, signal) {
  let url = start;
  for (let schritt = 0; ; schritt += 1) {
    const antwort = await fetch(url.href, { method: 'GET', redirect: 'manual', headers: ANFRAGE_HEADER, signal });
    const ziel = antwort.headers.get('Location');
    if (!WEITERLEITUNG.has(antwort.status) || !ziel) return { antwort, url };
    verwerfe(antwort);
    if (schritt >= MAX_WEITERLEITUNGEN) throw new DienstFehler(502, { fehler: 'weiterleitungen' });
    let naechste;
    try { naechste = new URL(ziel, url); } catch { throw new DienstFehler(400, { fehler: 'url' }); }
    const p = pruefe(naechste.href);
    if (!p.url) throw new DienstFehler(400, { fehler: p.fehler, host: naechste.hostname });
    url = p.url;
  }
}

async function ladeUndWerteAus(start, signal) {
  const { antwort, url } = await holeSeite(start, signal);
  const fehler = (status, daten) => { verwerfe(antwort); return new DienstFehler(status, daten); };
  if (!hostErlaubt(url.hostname, ERLAUBTE_HOSTS)) throw fehler(400, { fehler: 'host', host: url.hostname });
  if (BLOCKIERT.has(antwort.status)) throw fehler(403, { fehler: 'blockiert', status: antwort.status });
  if (!antwort.ok) throw fehler(502, { fehler: 'upstream', status: antwort.status });
  const typ = antwort.headers.get('Content-Type');
  if (typ && !/html|xml|text\//i.test(typ)) throw fehler(415, { fehler: 'kein-html' });
  if (Number(antwort.headers.get('Content-Length')) > MAX_BYTES) throw fehler(413, { fehler: 'zu-gross' });
  const { title, jsonld } = await werteAus(antwort);
  return { url: url.href, title, jsonld };
}

// ---------------------------------------------------------------- Antworten

function antwortJson(daten, status, origin = null, extra = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...extra,
  });
  if (origin) for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(JSON.stringify(daten), { status, headers });
}

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin');
    const erlaubt = origin && erlaubteOrigins(env).includes(normalisiereOrigin(origin)) ? origin : null;
    if (request.method === 'OPTIONS') {
      if (!erlaubt) return antwortJson({ fehler: 'origin' }, 403);
      return new Response(null, { status: 204, headers: corsHeaders(erlaubt) });
    }
    if (request.method !== 'GET') {
      return antwortJson({ fehler: 'methode' }, 405, erlaubt, { Allow: 'GET, OPTIONS' });
    }
    if (!erlaubt) {
      // Die Absage selbst darf jede Seite lesen (sie verrät nichts): so kann die App den Grund anzeigen
      // (z. B. „ERLAUBTE_ORIGINS ergänzen“) statt nur „nicht erreichbar“. Rezeptdaten gibt es nur für erlaubte Origins.
      return antwortJson({
        fehler: 'origin',
        meldung: 'Der Import-Dienst läuft, antwortet aber nur der App „Einkauf & Koch“.',
      }, 403, null, { 'Access-Control-Allow-Origin': '*' });
    }
    const parameter = new URL(request.url).searchParams;
    if (parameter.get('ping') === '1') return antwortJson({ ok: true, version: VERSION }, 200, erlaubt);
    const p = pruefe(parameter.get('url') ?? '');
    if (!p.url) return antwortJson({ fehler: p.fehler }, 400, erlaubt);

    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), ZEITLIMIT_MS);
    try {
      return antwortJson(await ladeUndWerteAus(p.url, abbruch.signal), 200, erlaubt);
    } catch (e) {
      if (e instanceof DienstFehler) return antwortJson(e.daten, e.status, erlaubt);
      if (abbruch.signal.aborted) return antwortJson({ fehler: 'zeitueberschreitung' }, 504, erlaubt);
      return antwortJson({ fehler: 'netz' }, 502, erlaubt);
    } finally {
      clearTimeout(uhr);
    }
  },
};
