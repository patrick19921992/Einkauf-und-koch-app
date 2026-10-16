import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  ERLAUBTE_HOSTS, ZWISCHEN_HOSTS, ERLAUBTE_ORIGINS, hostErlaubt, pruefeZielUrl, corsHeaders,
  sammleJsonLd, erlaubteOrigins, KI_SCHEMA, pruefeKiBody, kiPrompt, leseKiAntwort,
} from '../proxy/worker.js';

const APP = 'https://patrick19921992.github.io';
const DIENST = 'https://ek-import.beispiel.workers.dev/';
const REZEPT = 'https://www.chefkoch.de/rezepte/123/Spaghetti.html';
const LD = '{"@context":"https://schema.org","@type":"Recipe","name":"Spaghetti","recipeIngredient":["400 g Spaghetti"]}';
const SEITE = '<!doctype html><html><head><title>Spaghetti &amp; Soße | Test</title>'
  + `<script type="application/ld+json">${LD}</script></head>`
  + '<body><svg><title>Symbol</title></svg><p>Viel Text</p>'
  + '<script>var x = "<html>";</script></body></html>';

// Echtes fetch nach jedem Test zurücksetzen, HTMLRewriter-Attrappe entfernen.
const echtesFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = echtesFetch;
  delete globalThis.HTMLRewriter;
});

// Ersetzt globalThis.fetch; routen: url → Funktion, die eine neue Response liefert.
function falschesFetch(routen) {
  const aufrufe = [];
  globalThis.fetch = async (url, init = {}) => {
    aufrufe.push({ url: String(url), init });
    const route = routen[String(url)];
    if (!route) throw new TypeError(`unerwartete Anfrage: ${url}`);
    return route(init);
  };
  return aufrufe;
}

// Attrappe für env.AI: liefert `antwort` (Objekt, Funktion oder Fehler) und merkt sich die Aufrufe.
function kiAttrappe(antwort) {
  const aufrufe = [];
  return {
    aufrufe,
    async run(modell, eingabe) {
      aufrufe.push({ modell, eingabe });
      if (antwort instanceof Error) throw antwort;
      return typeof antwort === 'function' ? antwort(modell, eingabe) : antwort;
    },
  };
}

const html = (text, status = 200, header = {}) => () => new Response(text, {
  status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...header },
});
const weiter = (ziel, status = 302) => () => new Response(null, { status, headers: { Location: ziel } });

function anfrage(query, { origin = APP, methode = 'GET' } = {}) {
  const headers = origin ? { Origin: origin } : {};
  return new Request(DIENST + query, { method: methode, headers });
}
const mitUrl = (u) => anfrage('?url=' + encodeURIComponent(u));

async function json(antwort) {
  assert.match(antwort.headers.get('Content-Type'), /application\/json/);
  return JSON.parse(await antwort.text());
}

// Grob nachgebauter HTMLRewriter: liefert Text in kleinen Stücken wie workerd.
class RewriterAttrappe {
  constructor() { this.regeln = []; }
  on(selektor, handler) { this.regeln.push({ selektor, handler }); return this; }
  transform(antwort) {
    const regeln = this.regeln;
    return new Response(new ReadableStream({
      async start(steuerung) {
        try {
          const text = await antwort.text();
          for (const { selektor, handler } of regeln) {
            const re = selektor.startsWith('script')
              ? /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi
              : /<title[^>]*>([\s\S]*?)<\/title>/gi;
            for (const m of text.matchAll(re)) {
              handler.element?.({});
              for (let i = 0; i < m[1].length; i += 7) {
                handler.text?.({ text: m[1].slice(i, i + 7), lastInTextNode: false });
              }
              handler.text?.({ text: '', lastInTextNode: true });
            }
          }
          steuerung.enqueue(new TextEncoder().encode(text));
          steuerung.close();
        } catch (e) {
          steuerung.error(e);
        }
      },
    }));
  }
}

test('Listen enthalten die erwarteten Einträge', () => {
  for (const d of ['chefkoch.de', 'rewe.de', 'lecker.de', 'migusto.migros.ch', 'malteskitchen.de']) {
    assert.ok(ERLAUBTE_HOSTS.includes(d), d);
  }
  assert.ok(!ERLAUBTE_HOSTS.includes('tasty.co'));
  assert.deepEqual([...ZWISCHEN_HOSTS], ['share.google', 'search.app', 'goo.gl', 'g.co', 't.co', 'bit.ly']);
  assert.deepEqual([...ERLAUBTE_ORIGINS], [APP]);
});

test('hostErlaubt: genau oder Subdomain, nie mit fremdem Präfix', () => {
  assert.equal(hostErlaubt('chefkoch.de', ERLAUBTE_HOSTS), true);
  assert.equal(hostErlaubt('www.chefkoch.de', ERLAUBTE_HOSTS), true);
  assert.equal(hostErlaubt('WWW.Chefkoch.DE', ERLAUBTE_HOSTS), true);
  assert.equal(hostErlaubt('m.www.rewe.de', ERLAUBTE_HOSTS), true);
  assert.equal(hostErlaubt('evilchefkoch.de', ERLAUBTE_HOSTS), false);
  assert.equal(hostErlaubt('chefkoch.de.evil.com', ERLAUBTE_HOSTS), false);
  assert.equal(hostErlaubt('chefkoch.de.', ERLAUBTE_HOSTS), false);
  assert.equal(hostErlaubt('', ERLAUBTE_HOSTS), false);
  assert.equal(hostErlaubt(null, ERLAUBTE_HOSTS), false);
  assert.equal(hostErlaubt('share.google', ERLAUBTE_HOSTS), false);
  assert.equal(hostErlaubt('share.google', ZWISCHEN_HOSTS), true);
});

test('pruefeZielUrl: nur https, ohne Zugangsdaten und Port, Host erlaubt', () => {
  const u = pruefeZielUrl(` ${REZEPT}#kommentare `);
  assert.ok(u instanceof URL);
  assert.equal(u.href, REZEPT);
  assert.equal(pruefeZielUrl('https://www.chefkoch.de:443/x').href, 'https://www.chefkoch.de/x');
  assert.equal(pruefeZielUrl('http://www.chefkoch.de/rezepte/1'), null);
  assert.equal(pruefeZielUrl('https://nutzer:pw@www.chefkoch.de/rezepte/1'), null);
  assert.equal(pruefeZielUrl('https://nutzer@www.chefkoch.de/rezepte/1'), null);
  assert.equal(pruefeZielUrl('https://www.chefkoch.de:8443/rezepte/1'), null);
  assert.equal(pruefeZielUrl('https://share.google/AbC123').hostname, 'share.google');
  assert.equal(pruefeZielUrl('https://search.app/xyz').hostname, 'search.app');
  assert.equal(pruefeZielUrl('https://www.example.com/rezept'), null);
  assert.equal(pruefeZielUrl('https://evilchefkoch.de/'), null);
  assert.equal(pruefeZielUrl('https://127.0.0.1/'), null);
  assert.equal(pruefeZielUrl('javascript:alert(1)'), null);
  assert.equal(pruefeZielUrl('kein link'), null);
  assert.equal(pruefeZielUrl(''), null);
  assert.equal(pruefeZielUrl(undefined), null);
  assert.equal(pruefeZielUrl(`https://www.chefkoch.de/${'a'.repeat(3000)}`), null);
});

test('corsHeaders und erlaubteOrigins', () => {
  const h = corsHeaders(APP);
  assert.equal(h['Access-Control-Allow-Origin'], APP);
  assert.equal(h.Vary, 'Origin');
  assert.match(h['Access-Control-Allow-Methods'], /GET/);
  assert.match(h['Access-Control-Allow-Methods'], /POST/);
  assert.match(h['Access-Control-Allow-Headers'], /Content-Type/);
  assert.deepEqual(erlaubteOrigins(), [APP]);
  assert.deepEqual(erlaubteOrigins({ ERLAUBTE_ORIGINS: ' http://localhost:8080, https://Zweit.example/ ,*, null' }),
    [APP, 'http://localhost:8080', 'https://zweit.example']);
  assert.deepEqual(erlaubteOrigins({ ERLAUBTE_ORIGINS: ['https://a.example'] }), [APP, 'https://a.example']);
});

test('sammleJsonLd: Blöcke und Titel per Regex', () => {
  const ergebnis = sammleJsonLd(SEITE);
  assert.deepEqual(ergebnis, { title: 'Spaghetti & Soße | Test', jsonld: [LD] });

  const varianten = '<title>\n  Kuchen &#228;&#xFC; &auml; &lt;3\n</title>'
    + "<script id='a' type='application/ld+json'>\n {\"a\":1} \n</script>"
    + '<script type=application/ld+json data-x="1">{"b":2}</script>'
    + '<SCRIPT TYPE="Application/LD+JSON">{"c":3}</SCRIPT >'
    + '<script type="application/ld+json">   </script>'
    + '<script type="text/javascript">{"d":4}</script>'
    + '<script src="x.js"></script>';
  assert.deepEqual(sammleJsonLd(varianten), { title: 'Kuchen äü ä <3', jsonld: ['{"a":1}', '{"b":2}', '{"c":3}'] });
  assert.deepEqual(sammleJsonLd(''), { title: '', jsonld: [] });
  assert.deepEqual(sammleJsonLd(null), { title: '', jsonld: [] });
});

test('sammleJsonLd: höchstens 10 Blöcke, Rezept-Blöcke haben Vorrang, zu große fallen weg', () => {
  const block = (i) => `<script type="application/ld+json">{"@type":"Thing","n":${i}}</script>`;
  let seite = '';
  for (let i = 0; i < 12; i += 1) seite += block(i);
  seite += `<script type="application/ld+json">${LD}</script>`;
  const { jsonld } = sammleJsonLd(seite);
  assert.equal(jsonld.length, 10);
  assert.equal(jsonld[9], LD);
  assert.equal(jsonld[0], '{"@type":"Thing","n":0}');

  const riesig = `<script type="application/ld+json">"${'x'.repeat(600 * 1024)}"</script>`;
  assert.deepEqual(sammleJsonLd(riesig + block(1)).jsonld, ['{"@type":"Thing","n":1}']);
});

test('Modul nutzt keine Worker-Globals beim Import', () => {
  assert.equal(typeof globalThis.HTMLRewriter, 'undefined');
  assert.equal(typeof worker.fetch, 'function');
});

test('OPTIONS: Preflight nur für erlaubte Origin', async () => {
  const aufrufe = falschesFetch({});
  const ok = await worker.fetch(anfrage('?url=x', { methode: 'OPTIONS' }), {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), APP);
  assert.equal(ok.headers.get('Vary'), 'Origin');
  const nein = await worker.fetch(anfrage('', { methode: 'OPTIONS', origin: 'https://evil.example' }), {});
  assert.equal(nein.status, 403);
  assert.equal(nein.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(aufrufe.length, 0);
});

test('Methoden: GET, POST nur für KI-Ideen', async () => {
  let antwort = await worker.fetch(anfrage('?ping=1', { methode: 'POST' }), {});
  assert.equal(antwort.status, 405);
  assert.equal((await json(antwort)).fehler, 'methode');
  assert.equal(antwort.headers.get('Allow'), 'GET, OPTIONS');
  antwort = await worker.fetch(anfrage('?aktion=ki-rezepte'), { AI: kiAttrappe({}) });
  assert.equal(antwort.status, 405);
  assert.equal(antwort.headers.get('Allow'), 'POST, OPTIONS');
  antwort = await worker.fetch(anfrage('?url=x', { methode: 'PUT' }), {});
  assert.equal(antwort.status, 405);
  assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
});

test('Origin-Prüfung: fremde oder fehlende Origin → 403, Zusatz per env', async () => {
  const aufrufe = falschesFetch({ [REZEPT]: html(SEITE) });
  for (const origin of ['https://evil.example', 'https://patrick19921992.github.io.evil.example', 'null', null]) {
    const antwort = await worker.fetch(anfrage('?url=' + encodeURIComponent(REZEPT), { origin }), {});
    assert.equal(antwort.status, 403, String(origin));
    const daten = await json(antwort);
    assert.equal(daten.fehler, 'origin');
    assert.deepEqual(Object.keys(daten).sort(), ['fehler', 'meldung']);
    // Die Absage ist lesbar (App kann den Grund zeigen), sonst gibt es keine CORS-Freigaben
    assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(antwort.headers.get('Access-Control-Allow-Methods'), null);
    assert.equal(antwort.headers.get('Access-Control-Allow-Credentials'), null);
  }
  assert.equal(aufrufe.length, 0);

  const env = { ERLAUBTE_ORIGINS: 'http://localhost:8080' };
  const lokal = await worker.fetch(anfrage('?ping=1', { origin: 'http://localhost:8080' }), env);
  assert.equal(lokal.status, 200);
  assert.equal(lokal.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
  const ohneEnv = await worker.fetch(anfrage('?ping=1', { origin: 'http://localhost:8080' }));
  assert.equal(ohneEnv.status, 403);
  assert.equal((await json(ohneEnv)).fehler, 'origin');
  assert.equal(ohneEnv.headers.get('Access-Control-Allow-Origin'), '*');
});

test('ping antwortet ohne Abruf und meldet, ob die KI eingerichtet ist', async () => {
  const aufrufe = falschesFetch({});
  const ki = kiAttrappe({});
  assert.deepEqual(await json(await worker.fetch(anfrage('?ping=1'), { AI: ki })), { ok: true, version: '2', ki: true });
  assert.deepEqual(await json(await worker.fetch(anfrage('?ping=1'))), { ok: true, version: '2', ki: false });
  assert.equal(ki.aufrufe.length, 0);
  const antwort = await worker.fetch(anfrage('?ping=1'), {});
  assert.equal(antwort.status, 200);
  assert.deepEqual(await json(antwort), { ok: true, version: '2', ki: false });
  assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  assert.equal(antwort.headers.get('Cache-Control'), 'no-store');
  assert.equal(aufrufe.length, 0);
});

test('Ungültige oder nicht erlaubte url → 400 ohne Abruf', async () => {
  const aufrufe = falschesFetch({});
  const fall = async (query, fehler) => {
    const antwort = await worker.fetch(anfrage(query), {});
    assert.equal(antwort.status, 400, query);
    assert.equal((await json(antwort)).fehler, fehler, query);
    assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  };
  await fall('', 'url');
  await fall('?url=', 'url');
  await fall('?url=' + encodeURIComponent('http://www.chefkoch.de/rezepte/1'), 'url');
  await fall('?url=' + encodeURIComponent('https://www.chefkoch.de:8080/'), 'url');
  await fall('?url=' + encodeURIComponent('https://www.example.com/rezept'), 'host');
  assert.equal(aufrufe.length, 0);
});

test('Erfolg: nur url, title und jsonld – nie rohes HTML', async () => {
  const aufrufe = falschesFetch({ [REZEPT]: html(SEITE) });
  const antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 200);
  assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  assert.equal(antwort.headers.get('Vary'), 'Origin');
  assert.equal(antwort.headers.get('Cache-Control'), 'no-store');
  const text = await antwort.text();
  assert.doesNotMatch(text, /<html|<body|Viel Text/);
  assert.deepEqual(JSON.parse(text), { url: REZEPT, title: 'Spaghetti & Soße | Test', jsonld: [LD] });

  assert.equal(aufrufe.length, 1);
  const { init } = aufrufe[0];
  assert.equal(init.redirect, 'manual');
  assert.equal(init.method, 'GET');
  assert.match(init.headers['User-Agent'], /Android.*Chrome\/\d+/);
  assert.match(init.headers.Accept, /text\/html/);
  assert.equal(init.headers['Accept-Language'], 'de-DE,de;q=0.9');
});

test('Weiterleitung share.google → chefkoch wird gefolgt (auch relativ)', async () => {
  const kurz = 'https://share.google/AbC123';
  const zwischen = 'https://www.chefkoch.de/rezepte/123';
  const aufrufe = falschesFetch({
    [kurz]: weiter(zwischen, 302),
    [zwischen]: weiter('/rezepte/123/Spaghetti.html', 301),
    [REZEPT]: html(SEITE),
  });
  const antwort = await worker.fetch(mitUrl(kurz), {});
  assert.equal(antwort.status, 200);
  const daten = await json(antwort);
  assert.equal(daten.url, REZEPT);
  assert.deepEqual(daten.jsonld, [LD]);
  assert.deepEqual(aufrufe.map((a) => a.url), [kurz, zwischen, REZEPT]);
  assert.ok(aufrufe.every((a) => a.init.redirect === 'manual'));
});

test('Weiterleitung auf nicht erlaubten Host oder http wird abgelehnt', async () => {
  const kurz = 'https://share.google/Boese';
  let aufrufe = falschesFetch({ [kurz]: weiter('https://evil.example/rezept') });
  let antwort = await worker.fetch(mitUrl(kurz), {});
  assert.equal(antwort.status, 400);
  assert.deepEqual(await json(antwort), { fehler: 'host', host: 'evil.example' });
  assert.deepEqual(aufrufe.map((a) => a.url), [kurz]);

  aufrufe = falschesFetch({ [REZEPT]: weiter('http://www.chefkoch.de/unsicher') });
  antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 400);
  assert.equal((await json(antwort)).fehler, 'url');
  assert.equal(aufrufe.length, 1);
});

test('Kurzlink als Endziel ist nicht erlaubt', async () => {
  falschesFetch({ 'https://search.app/xyz': html(SEITE) });
  const antwort = await worker.fetch(mitUrl('https://search.app/xyz'), {});
  assert.equal(antwort.status, 400);
  assert.deepEqual(await json(antwort), { fehler: 'host', host: 'search.app' });
});

test('Höchstens 5 Weiterleitungen', async () => {
  const a = 'https://www.chefkoch.de/a';
  const b = 'https://www.chefkoch.de/b';
  const aufrufe = falschesFetch({ [a]: weiter(b), [b]: weiter(a) });
  const antwort = await worker.fetch(mitUrl(a), {});
  assert.equal(antwort.status, 502);
  assert.equal((await json(antwort)).fehler, 'weiterleitungen');
  assert.equal(aufrufe.length, 6);
});

test('Fehler der Rezeptseite', async () => {
  const fall = async (status, erwartetStatus, erwartet) => {
    falschesFetch({ [REZEPT]: html('<h1>Nein</h1>', status) });
    const antwort = await worker.fetch(mitUrl(REZEPT), {});
    assert.equal(antwort.status, erwartetStatus, String(status));
    assert.deepEqual(await json(antwort), erwartet);
    assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  };
  await fall(403, 403, { fehler: 'blockiert', status: 403 });
  await fall(401, 403, { fehler: 'blockiert', status: 401 });
  await fall(451, 403, { fehler: 'blockiert', status: 451 });
  await fall(404, 502, { fehler: 'upstream', status: 404 });
  await fall(500, 502, { fehler: 'upstream', status: 500 });
  await fall(429, 502, { fehler: 'upstream', status: 429 });
});

test('Netzfehler → 502 netz, kein HTML → 415', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  let antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 502);
  assert.deepEqual(await json(antwort), { fehler: 'netz' });

  falschesFetch({ [REZEPT]: () => new Response('PNG', { headers: { 'Content-Type': 'image/png' } }) });
  antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 415);
  assert.equal((await json(antwort)).fehler, 'kein-html');
});

// Liefert n MB in 1-MB-Stücken ohne Content-Length.
function grosserStrom(mb) {
  let rest = mb;
  return new ReadableStream({
    pull(steuerung) {
      if (rest-- <= 0) { steuerung.close(); return; }
      steuerung.enqueue(new Uint8Array(1024 * 1024).fill(32));
    },
  });
}

test('Größenlimit 3 MB: per Content-Length und beim Streamen', async () => {
  falschesFetch({ [REZEPT]: html('klein', 200, { 'Content-Length': String(5 * 1024 * 1024) }) });
  let antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 413);
  assert.deepEqual(await json(antwort), { fehler: 'zu-gross' });

  falschesFetch({ [REZEPT]: () => new Response(grosserStrom(4), { headers: { 'Content-Type': 'text/html' } }) });
  antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 413);

  falschesFetch({ [REZEPT]: () => new Response(grosserStrom(2), { headers: { 'Content-Type': 'text/html' } }) });
  antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 200);
  assert.deepEqual((await json(antwort)).jsonld, []);
});

test('Mit HTMLRewriter (Attrappe): gleiches Ergebnis, nur erster Titel, Limit greift', async () => {
  globalThis.HTMLRewriter = RewriterAttrappe;
  const seite = SEITE + '<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>';
  falschesFetch({ [REZEPT]: html(seite) });
  let antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 200);
  assert.deepEqual(await json(antwort), {
    url: REZEPT, title: 'Spaghetti & Soße | Test', jsonld: [LD, '{"@type":"BreadcrumbList"}'],
  });

  falschesFetch({ [REZEPT]: () => new Response(grosserStrom(4), { headers: { 'Content-Type': 'text/html' } }) });
  antwort = await worker.fetch(mitUrl(REZEPT), {});
  assert.equal(antwort.status, 413);
  assert.deepEqual(await json(antwort), { fehler: 'zu-gross' });
});

// ---------------------------------------------------------------- KI-Rezeptideen

const KI_BODY = {
  profil: { protein: ['vegetarisch', 'vegan'], ohne: ['pilz'], allergene: ['nuesse'], kochzeit: 'schnell', personen: 2 },
  anzahl: 2, mahlzeit: 'haupt', vermeiden: ['Spaghetti mit Tomatensauce'],
};
const KI_REZEPT = {
  title: 'Linsen-Curry mit Reis', servings: 2, totalMin: 25, mahlzeit: 'haupt', protein: ['vegan'],
  zutaten: ['150 g Reis', '100 g rote Linsen', '1 Zwiebel', '400 ml Kokosmilch', '1 EL Currypulver', 'Salz'],
  schritte: ['Reis 15 Minuten kochen.', 'Zwiebel würfeln, mit Linsen und Kokosmilch 12 Minuten köcheln.'],
};

function kiPost(body, { origin = APP, typ = 'application/json', query = '?aktion=ki-rezepte' } = {}) {
  const headers = { 'Content-Type': typ };
  if (origin) headers.Origin = origin;
  return new Request(DIENST + query, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

test('OPTIONS: Preflight erlaubt POST mit Content-Type', async () => {
  const antwort = await worker.fetch(new Request(DIENST + '?aktion=ki-rezepte', {
    method: 'OPTIONS',
    headers: { Origin: APP, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  }), {});
  assert.equal(antwort.status, 204);
  assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  assert.deepEqual(antwort.headers.get('Access-Control-Allow-Methods').split(/,\s*/).sort(), ['GET', 'OPTIONS', 'POST']);
  assert.match(antwort.headers.get('Access-Control-Allow-Headers'), /content-type/i);
  const fremd = await worker.fetch(new Request(DIENST + '?aktion=ki-rezepte', {
    method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  }), {});
  assert.equal(fremd.status, 403);
  assert.equal(fremd.headers.get('Access-Control-Allow-Methods'), null);
});

test('KI: fremde oder fehlende Origin → 403, die KI wird nicht gefragt', async () => {
  const ki = kiAttrappe({ response: { rezepte: [KI_REZEPT] } });
  for (const origin of ['https://evil.example', null]) {
    const antwort = await worker.fetch(kiPost(KI_BODY, { origin }), { AI: ki });
    assert.equal(antwort.status, 403, String(origin));
    assert.equal((await json(antwort)).fehler, 'origin');
    assert.equal(antwort.headers.get('Access-Control-Allow-Methods'), null);
  }
  assert.equal(ki.aufrufe.length, 0);
});

test('KI: ohne Workers-AI-Binding → 501 ki-fehlt', async () => {
  for (const env of [{}, undefined, { AI: null }]) {
    const antwort = await worker.fetch(kiPost(KI_BODY), env);
    assert.equal(antwort.status, 501);
    assert.deepEqual(await json(antwort), { fehler: 'ki-fehlt' });
    assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  }
});

test('KI: Erfolg mit Objekt-Antwort, Aufruf wie vorgesehen', async () => {
  const ki = kiAttrappe({ response: { rezepte: [{ ...KI_REZEPT, extra: 'weg' }, KI_REZEPT, KI_REZEPT] } });
  const antwort = await worker.fetch(kiPost(KI_BODY), { AI: ki });
  assert.equal(antwort.status, 200);
  assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  assert.equal(antwort.headers.get('Cache-Control'), 'no-store');
  // nur die Felder des Schemas, höchstens `anzahl` Rezepte
  assert.deepEqual(await json(antwort), { rezepte: [KI_REZEPT, KI_REZEPT] });

  assert.equal(ki.aufrufe.length, 1);
  const { modell, eingabe } = ki.aufrufe[0];
  assert.equal(modell, '@cf/google/gemma-4-26b-a4b-it');
  assert.deepEqual(eingabe.messages.map((m) => m.role), ['system', 'user']);
  assert.deepEqual(eingabe.messages, kiPrompt(pruefeKiBody(KI_BODY)));
  assert.deepEqual(eingabe.response_format, { type: 'json_schema', json_schema: { name: 'rezepte', schema: KI_SCHEMA, strict: true } });
  assert.equal(eingabe.max_completion_tokens, 3600);
  assert.deepEqual(eingabe.chat_template_kwargs, { enable_thinking: false });

  // anderes Modell per Umgebungsvariable
  const ki2 = kiAttrappe({ response: { rezepte: [] } });
  const leer = await worker.fetch(kiPost({ ...KI_BODY, anzahl: 4 }), { AI: ki2, KI_MODELL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
  assert.deepEqual(await json(leer), { rezepte: [] });
  assert.equal(ki2.aufrufe[0].modell, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(ki2.aufrufe[0].eingabe.max_completion_tokens, 7200);
});

test('KI: Erfolg mit JSON-Text (auch im OpenAI-Format und mit ```-Zaun)', async () => {
  const text = JSON.stringify({ rezepte: [KI_REZEPT] });
  for (const ergebnis of [
    { response: text },
    { response: `  ${text}\n` },
    { choices: [{ message: { role: 'assistant', content: '```json\n' + text + '\n```' } }] },
    { choices: [{ message: { content: 'Hier sind deine Rezepte: ' + text + ' Guten Appetit!' } }] },
  ]) {
    const antwort = await worker.fetch(kiPost({ ...KI_BODY, anzahl: 1 }), { AI: kiAttrappe(ergebnis) });
    assert.equal(antwort.status, 200, JSON.stringify(ergebnis).slice(0, 60));
    assert.deepEqual(await json(antwort), { rezepte: [KI_REZEPT] });
  }
});

test('KI: Tageskontingent → 429 limit, ohne rohe Fehlermeldung', async () => {
  for (const fehler of [
    new Error('4006: you have used up your daily free allocation of 10,000 neurons, please upgrade'),
    Object.assign(new Error('AiError'), { code: 4006 }),
    new Error('Neuron limit exceeded'),
  ]) {
    const antwort = await worker.fetch(kiPost(KI_BODY), { AI: kiAttrappe(fehler) });
    assert.equal(antwort.status, 429);
    const text = await antwort.text();
    assert.deepEqual(JSON.parse(text), { fehler: 'limit' });
    assert.doesNotMatch(text, /neurons|upgrade/i);
  }
});

test('KI: kaputtes JSON → 502 ki-format, andere Fehler → 502 ki; Modelltext wird nie zurückgegeben', async () => {
  for (const ergebnis of [{ response: 'Geheimer Modelltext {"rezepte": [ kaputt' }, { response: { nichts: 1 } },
    { choices: [{ message: { content: null } }] }, null, 'Nur Text']) {
    const antwort = await worker.fetch(kiPost(KI_BODY), { AI: kiAttrappe(ergebnis) });
    assert.equal(antwort.status, 502);
    const text = await antwort.text();
    assert.deepEqual(JSON.parse(text), { fehler: 'ki-format' });
    assert.doesNotMatch(text, /Geheimer|kaputt/);
  }
  let antwort = await worker.fetch(kiPost(KI_BODY), { AI: kiAttrappe(new Error("JSON Mode couldn't be met")) });
  assert.deepEqual([antwort.status, await json(antwort)], [502, { fehler: 'ki-format' }]);
  antwort = await worker.fetch(kiPost(KI_BODY), { AI: kiAttrappe(new Error('3043: Internal server error (Geheimnis)')) });
  assert.equal(antwort.status, 502);
  assert.equal(await antwort.text(), '{"fehler":"ki"}');
  antwort = await worker.fetch(kiPost(KI_BODY), { AI: {} });          // Binding ohne run
  assert.deepEqual([antwort.status, await json(antwort)], [502, { fehler: 'ki' }]);
});

test('KI: Body höchstens 8 KB, nur JSON, Felder werden geprüft', async () => {
  const ki = kiAttrappe({ response: { rezepte: [] } });
  const fall = async (request, status, fehler) => {
    const antwort = await worker.fetch(request, { AI: ki });
    assert.equal(antwort.status, status, fehler);
    assert.deepEqual(await json(antwort), { fehler });
    assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), APP);
  };
  const gross = { ...KI_BODY, fuell: 'x'.repeat(9000) };
  await fall(kiPost(gross), 413, 'zu-gross');
  // per Content-Length und beim Lesen eines Stroms ohne Längenangabe
  const mitLaenge = new Request(DIENST + '?aktion=ki-rezepte', {
    method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json', 'Content-Length': '9000' }, body: '{}',
  });
  await fall(mitLaenge, 413, 'zu-gross');
  const strom = new Request(DIENST + '?aktion=ki-rezepte', {
    method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json' }, duplex: 'half',
    body: new ReadableStream({ start(s) { for (let i = 0; i < 3; i += 1) s.enqueue(new Uint8Array(4000).fill(32)); s.close(); } }),
  });
  await fall(strom, 413, 'zu-gross');
  await fall(kiPost(KI_BODY, { typ: 'text/plain' }), 415, 'kein-json');
  await fall(kiPost('{kein json'), 400, 'ungueltig');
  await fall(kiPost(''), 400, 'ungueltig');
  await fall(kiPost([KI_BODY]), 400, 'ungueltig');
  await fall(kiPost({ ...KI_BODY, profil: { ...KI_BODY.profil, protein: 'vegan' } }), 400, 'ungueltig');
  await fall(kiPost({ ...KI_BODY, profil: { ...KI_BODY.profil, protein: ['tofu'] } }), 400, 'ungueltig');
  await fall(kiPost({ ...KI_BODY, anzahl: '2' }), 400, 'ungueltig');
  assert.equal(ki.aufrufe.length, 0);
  // knapp unter 8 KB geht
  const knapp = { ...KI_BODY, fuell: 'x'.repeat(7800) };
  const antwort = await worker.fetch(kiPost(knapp), { AI: ki });
  assert.equal(antwort.status, 200);
  assert.equal(ki.aufrufe.length, 1);
});

test('pruefeKiBody: nur bekannte Felder, unbekannte ids weg, Zahlen begrenzt', () => {
  assert.deepEqual(pruefeKiBody({
    profil: { protein: ['vegan', 'tofu', 'rind', 'vegan'], ohne: ['pilz', 7, ' Koriander\n ', 'pilz', ''], allergene: ['ei', 'erdbeere'],
      kochzeit: 'blitz', personen: 30, geheim: 1 },
    anzahl: 0, mahlzeit: 'frueh', vermeiden: ['A "B"', 'x'.repeat(100), null], extra: true,
  }), {
    profil: { protein: ['rind', 'vegan'], ohne: ['pilz', 'Koriander'], allergene: ['ei'], kochzeit: 'normal', personen: 12 },
    anzahl: 1, mahlzeit: 'frueh', vermeiden: ['A B', 'x'.repeat(80)],
  });
  // Standardwerte für fehlende Felder, anzahl 1–4 gerundet
  assert.deepEqual(pruefeKiBody({ profil: { protein: ['fisch'] }, anzahl: 9.4 }), {
    profil: { protein: ['fisch'], ohne: [], allergene: [], kochzeit: 'normal', personen: 2 },
    anzahl: 4, mahlzeit: 'haupt', vermeiden: [],
  });
  assert.equal(pruefeKiBody({ profil: { protein: ['fisch'] }, anzahl: 2.6 }).anzahl, 3);
  assert.equal(pruefeKiBody({ profil: { protein: ['fisch'], personen: 0 } }).profil.personen, 1);
  assert.equal(pruefeKiBody({ profil: { protein: ['fisch'], kochzeit: ['schnell'] } }).profil.kochzeit, 'normal');
  assert.equal(pruefeKiBody({ profil: { protein: ['fisch'] }, vermeiden: Array.from({ length: 50 }, (_, i) => `T${i}`) }).vermeiden.length, 30);
  // falsche Typen → null
  for (const falsch of [null, 'x', [], {}, { profil: [] }, { profil: { protein: 'vegan' } }, { profil: { protein: [] } },
    { profil: { protein: ['vegan'], ohne: 'pilz' } }, { profil: { protein: ['vegan'], allergene: 'ei' } },
    { profil: { protein: ['vegan'], personen: '2' } }, { profil: { protein: ['vegan'] }, anzahl: null },
    { profil: { protein: ['vegan'] }, anzahl: Infinity }, { profil: { protein: ['vegan'] }, mahlzeit: 'snack' },
    { profil: { protein: ['vegan'] }, vermeiden: 'Titel' }]) {
    assert.equal(pruefeKiBody(falsch), null, JSON.stringify(falsch));
  }
});

test('kiPrompt: Vorgaben stehen im Prompt', () => {
  const [system, nutzer] = kiPrompt(pruefeKiBody(KI_BODY));
  assert.equal(system.role, 'system');
  assert.match(system.content, /Hobbyk/);
  assert.match(system.content, /Discounter/);
  assert.match(system.content, /JSON/);
  assert.match(system.content, /„10 Minuten“/);
  assert.match(system.content, /Gemüsebrühe/);
  assert.equal(nutzer.role, 'user');
  assert.match(nutzer.content, /2 Hauptgerichte für 2 Personen/);
  assert.match(nutzer.content, /Nur vegetarische Gerichte/);
  assert.match(nutzer.content, /Höchstens 25 Minuten/);
  assert.match(nutzer.content, /Nüsse/);
  assert.match(nutzer.content, /nicht verwenden: pilz/);
  assert.match(nutzer.content, /Spaghetti mit Tomatensauce/);

  const vegan = kiPrompt(pruefeKiBody({ profil: { protein: ['vegan'], kochzeit: 'schnell', personen: 1 }, anzahl: 1, mahlzeit: 'frueh' }))[1].content;
  assert.match(vegan, /1 Frühstücksidee für 1 Person\b/);
  assert.match(vegan, /Nur vegane Gerichte/);
  assert.match(vegan, /Höchstens 15 Minuten/);
  assert.doesNotMatch(vegan, /Diese Gerichte gibt es schon/);

  const fleisch = kiPrompt(pruefeKiBody({ profil: { protein: ['gefluegel', 'vegetarisch'], kochzeit: 'egal' } }))[1].content;
  assert.match(fleisch, /Erlaubt als Hauptzutat: Geflügel, oder vegetarisch/);
  assert.match(fleisch, /Nicht verwenden: Schwein, Rind, Fisch \(auch kein Speck/);
  assert.doesNotMatch(fleisch, /Höchstens/);
  assert.doesNotMatch(fleisch, /Jedes Gericht/);
  const alles = kiPrompt(pruefeKiBody({ profil: { protein: ['schwein', 'rind', 'gefluegel', 'fisch'] } }))[1].content;
  assert.doesNotMatch(alles, /Nicht verwenden/);
  assert.match(alles, /Jedes Gericht enthält eine davon/);
  const fisch = kiPrompt(pruefeKiBody({ profil: { protein: ['fisch'] } }))[1].content;
  assert.match(fisch, /Erlaubt als Hauptzutat: Fisch\. Jedes Gericht enthält eine davon\. Nicht verwenden: Schwein, Rind, Geflügel \(auch kein Speck/);
});

test('leseKiAntwort: Objekt, Text, OpenAI-Format; sonst null', () => {
  const liste = [KI_REZEPT];
  assert.deepEqual(leseKiAntwort({ response: { rezepte: liste } }), liste);
  assert.deepEqual(leseKiAntwort({ response: JSON.stringify({ rezepte: liste }) }), liste);
  assert.deepEqual(leseKiAntwort({ response: JSON.stringify(liste) }), liste);
  assert.deepEqual(leseKiAntwort({ choices: [{ message: { content: '```\n' + JSON.stringify({ rezepte: liste }) + '\n```' } }] }), liste);
  assert.deepEqual(leseKiAntwort({ rezepte: liste }), liste);
  for (const nichts of [null, undefined, '', 'Text', { response: '' }, { response: { rezepte: 'x' } }, { choices: [] }, 42]) {
    assert.equal(leseKiAntwort(nichts), null, JSON.stringify(nichts));
  }
});
