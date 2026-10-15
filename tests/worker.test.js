import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  ERLAUBTE_HOSTS, ZWISCHEN_HOSTS, ERLAUBTE_ORIGINS, hostErlaubt, pruefeZielUrl, corsHeaders,
  sammleJsonLd, erlaubteOrigins,
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

test('Nur GET erlaubt', async () => {
  const antwort = await worker.fetch(anfrage('?ping=1', { methode: 'POST' }), {});
  assert.equal(antwort.status, 405);
  assert.equal((await json(antwort)).fehler, 'methode');
  assert.match(antwort.headers.get('Allow'), /GET/);
});

test('Origin-Prüfung: fremde oder fehlende Origin → 403, Zusatz per env', async () => {
  const aufrufe = falschesFetch({ [REZEPT]: html(SEITE) });
  for (const origin of ['https://evil.example', 'https://patrick19921992.github.io.evil.example', 'null', null]) {
    const antwort = await worker.fetch(anfrage('?url=' + encodeURIComponent(REZEPT), { origin }), {});
    assert.equal(antwort.status, 403, String(origin));
    assert.equal((await json(antwort)).fehler, 'origin');
    assert.equal(antwort.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(aufrufe.length, 0);

  const env = { ERLAUBTE_ORIGINS: 'http://localhost:8080' };
  const lokal = await worker.fetch(anfrage('?ping=1', { origin: 'http://localhost:8080' }), env);
  assert.equal(lokal.status, 200);
  assert.equal(lokal.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
  const ohneEnv = await worker.fetch(anfrage('?ping=1', { origin: 'http://localhost:8080' }));
  assert.equal(ohneEnv.status, 403);
});

test('ping antwortet ohne Abruf', async () => {
  const aufrufe = falschesFetch({});
  const antwort = await worker.fetch(anfrage('?ping=1'), {});
  assert.equal(antwort.status, 200);
  assert.deepEqual(await json(antwort), { ok: true, version: '1' });
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
