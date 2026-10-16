import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KI_SCHEMA, KI_ANLEITUNG, KiFehler, kiAnfrage, holeKiRezepte, pruefeKiRezept, pruefeKiRezepte, bewerteKiRezept,
  kiRezeptZuRezept, kiId,
} from '../js/ki.js';
import worker, { KI_SCHEMA as WORKER_SCHEMA } from '../proxy/worker.js';
import { parseZeile } from '../js/zutaten.js';
import { passtZumProfil, rezeptMeta } from '../js/planer.js';

const DIENST = 'https://ek-import.beispiel.workers.dev';
const APP = 'https://patrick19921992.github.io';

// Gültige KI-Antwort (vegan) als Vorlage
const CURRY = Object.freeze({
  title: 'Linsen-Curry mit Reis',
  servings: 2,
  totalMin: 30,
  mahlzeit: 'haupt',
  protein: ['vegan'],
  zutaten: ['150 g Reis', '100 g rote Linsen', '1 Zwiebel', '1 Dose gehackte Tomaten (400 g)', '200 ml Kokosmilch',
    '1 EL Currypulver', '1 EL Öl', 'Salz', 'Pfeffer'],
  schritte: ['Reis nach Packungsangabe 15 Minuten kochen.', 'Zwiebel würfeln und in Öl 3 Minuten andünsten.',
    'Linsen, Tomaten, Kokosmilch und Curry zugeben und 12 Minuten köcheln lassen. Abschmecken.'],
});
const mit = (extra) => ({ ...CURRY, ...extra });

// fetchFn-Attrappe: merkt sich Aufrufe und antwortet mit status + body
function falschesFetch(status, body, { header = { 'Content-Type': 'application/json' } } = {}) {
  const aufrufe = [];
  const fetchFn = async (url, init) => {
    aufrufe.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: header });
  };
  return { aufrufe, fetchFn };
}

async function fehlerVon(versprechen) {
  try {
    await versprechen;
  } catch (e) {
    return e;
  }
  assert.fail('KiFehler erwartet');
}

test('KI_SCHEMA ist dasselbe wie im Worker und eingefroren', () => {
  assert.deepEqual(KI_SCHEMA, WORKER_SCHEMA);
  assert.ok(Object.isFrozen(KI_SCHEMA));
  assert.ok(Object.isFrozen(KI_SCHEMA.properties.rezepte.items.properties.protein.items.enum));
  assert.deepEqual(KI_SCHEMA.properties.rezepte.items.required,
    ['title', 'servings', 'totalMin', 'mahlzeit', 'protein', 'zutaten', 'schritte']);
});

test('kiAnfrage: nur die nötigen Vorlieben, Grenzen eingehalten', () => {
  const body = kiAnfrage({
    protein: ['vegan', 'quatsch', 'fisch'], ohne: ['Pilze', 'Koriander'], allergene: ['ei', 'xyz'], kochzeit: 'schnell',
    personen: 20, tage: 7, laeden: ['aldi'], budget: 50,
  }, { anzahl: 3, mahlzeit: 'frueh', vermeiden: ['Spaghetti Bolognese', ' spaghetti  bolognese ', '', null, 'x'.repeat(100)] });
  assert.deepEqual(body, {
    profil: { protein: ['fisch', 'vegan'], ohne: ['pilz', 'koriander'], allergene: ['ei'], kochzeit: 'schnell', personen: 12 },
    anzahl: 3,
    mahlzeit: 'frueh',
    vermeiden: ['Spaghetti Bolognese', 'x'.repeat(80)],
  });
  // Standardwerte und Begrenzungen
  const std = kiAnfrage({});
  assert.deepEqual(std.profil.protein, ['schwein', 'rind', 'gefluegel', 'fisch', 'vegetarisch', 'vegan']);
  assert.equal(std.anzahl, 2);
  assert.equal(std.mahlzeit, 'haupt');
  assert.deepEqual(std.vermeiden, []);
  assert.equal(kiAnfrage({}, { anzahl: 9 }).anzahl, 4);
  assert.equal(kiAnfrage({}, { anzahl: 0 }).anzahl, 1);
  assert.equal(kiAnfrage({}, { anzahl: 'viele' }).anzahl, 1);
  assert.equal(kiAnfrage({}, { mahlzeit: 'snack' }).mahlzeit, 'haupt');
  const viele = kiAnfrage({}, { vermeiden: Array.from({ length: 50 }, (_, i) => `Gericht ${i}`) });
  assert.equal(viele.vermeiden.length, 30);
  assert.equal(viele.vermeiden[29], 'Gericht 29');
  // lange Titel mit Umlauten: die Anfrage bleibt sicher unter 8 KB
  const lang = kiAnfrage({ ohne: Array.from({ length: 30 }, (_, i) => `Zutat${i}${'ä'.repeat(40)}`) },
    { vermeiden: Array.from({ length: 30 }, (_, i) => `${i} ${'€'.repeat(90)}`) });
  assert.ok(new TextEncoder().encode(JSON.stringify(lang)).length <= 7000);
  assert.ok(lang.vermeiden.length > 0 && lang.vermeiden.length < 30);
  assert.equal(lang.profil.ohne.length, 20);
});

test('kiAnfrage → Worker akzeptiert den Body unverändert', async () => {
  const body = kiAnfrage({ protein: ['vegetarisch'], ohne: ['pilz'], allergene: ['nuesse'] }, { anzahl: 2, vermeiden: ['A', 'B'] });
  let eingabe = null;
  const env = { AI: { run: async (m, e) => { eingabe = e; return { response: { rezepte: [] } }; } } };
  const antwort = await worker.fetch(new Request(`${DIENST}/?aktion=ki-rezepte`, {
    method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  assert.equal(antwort.status, 200);
  assert.match(eingabe.messages[1].content, /Nur vegetarische Gerichte/);
  assert.match(eingabe.messages[1].content, /A; B/);
});

test('holeKiRezepte: POST an ?aktion=ki-rezepte, liefert die rohe Liste', async () => {
  const { aufrufe, fetchFn } = falschesFetch(200, { rezepte: [CURRY] });
  const body = kiAnfrage({ protein: ['vegan'] });
  assert.deepEqual(await holeKiRezepte(DIENST, body, { fetchFn }), [CURRY]);
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, `${DIENST}?aktion=ki-rezepte`);
  const { init } = aufrufe[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(JSON.parse(init.body), body);
  assert.ok(init.signal instanceof AbortSignal);

  // Adresse ohne https:// und mit vorhandener Query
  const zwei = falschesFetch(200, { rezepte: [] });
  await holeKiRezepte('ek.beispiel.workers.dev/?x=1', body, { fetchFn: zwei.fetchFn });
  assert.equal(zwei.aufrufe[0].url, 'https://ek.beispiel.workers.dev/?x=1&aktion=ki-rezepte');
});

test('holeKiRezepte: alle Fehler als KiFehler mit deutscher Meldung', async () => {
  const body = kiAnfrage({});
  const fall = async (code, versprechen, muster) => {
    const e = await fehlerVon(versprechen);
    assert.ok(e instanceof KiFehler, code);
    assert.ok(e instanceof Error);
    assert.equal(e.name, 'KiFehler');
    assert.equal(e.code, code);
    assert.ok(e.message.length > 20, e.message);
    if (muster) assert.match(e.message, muster);
    return e;
  };
  const mitAntwort = (status, daten, header) => holeKiRezepte(DIENST, body, { fetchFn: falschesFetch(status, daten, header).fetchFn });

  await fall('kein-proxy', holeKiRezepte('', body, { fetchFn: falschesFetch(200, {}).fetchFn }), /Import-Dienst/);
  await fall('kein-proxy', holeKiRezepte('   ', body), /Mehr → Import-Dienst/);
  await fall('kein-proxy', holeKiRezepte('https://exa mple', body), /ungültig/);

  const kiFehlt = await fall('ki-fehlt', mitAntwort(501, { fehler: 'ki-fehlt' }));
  for (const teil of ['Cloudflare Dashboard', 'Settings → Bindings → Add → Workers AI', 'Variable name „AI“', 'Deploy']) {
    assert.ok(kiFehlt.message.includes(teil), teil);
  }
  assert.ok(kiFehlt.message.includes(KI_ANLEITUNG));
  await fall('ki-fehlt', mitAntwort(501, 'Not Implemented', { 'Content-Type': 'text/plain' }), /Workers AI/);
  // alter Worker ohne KI-Endpunkt
  const alt = await fall('ki-fehlt', mitAntwort(405, { fehler: 'methode' }), /proxy\/worker\.js/);
  assert.equal(alt.grund, 'veraltet');

  await fall('limit', mitAntwort(429, { fehler: 'limit' }), /heute.*aufgebraucht/);
  await fall('limit', mitAntwort(429, ''), /10\.000 Neurons/);
  await fall('origin', mitAntwort(403, { fehler: 'origin', meldung: 'x' }), /ERLAUBTE_ORIGINS/);
  await fall('ungueltig', mitAntwort(502, { fehler: 'ki-format' }), /keine brauchbare Antwort/);
  await fall('netz', mitAntwort(502, { fehler: 'ki' }), /später/);
  await fall('netz', mitAntwort(500, '<html>Fehler</html>', { 'Content-Type': 'text/html' }), /HTTP 500/);
  await fall('ungueltig', mitAntwort(400, { fehler: 'ungueltig' }), /abgelehnt/);
  await fall('ungueltig', mitAntwort(413, { fehler: 'zu-gross' }));
  await fall('ungueltig', mitAntwort(200, '<!doctype html><p>Hallo</p>', { 'Content-Type': 'text/html' }), /keine gültige Antwort/);
  await fall('ungueltig', mitAntwort(200, { ok: true }));
  await fall('ungueltig', mitAntwort(200, { rezepte: 'viele' }));
  await fall('ungueltig', mitAntwort(400, { fehler: 'constructor' }), /abgelehnt/);

  // Netzfehler (auch CORS-Absage) und Zeitüberschreitung
  const netz = await fall('netz', holeKiRezepte(DIENST, body, { fetchFn: async () => { throw new TypeError('Failed to fetch'); } }),
    /nicht erreichbar/);
  assert.equal(netz.grund, 'nicht-erreichbar');
  const langsam = (url, init) => new Promise((_, nein) => {
    init.signal.addEventListener('abort', () => nein(new DOMException('abgebrochen', 'AbortError')));
  });
  const zeit = await fall('netz', holeKiRezepte(DIENST, body, { fetchFn: langsam, timeoutMs: 20 }), /zu lange/);
  assert.equal(zeit.grund, 'zeit');
});

test('KiFehler: eigener Text und Standardtexte je Code', () => {
  assert.equal(new KiFehler('netz', 'Eigener Text').message, 'Eigener Text');
  for (const code of ['kein-proxy', 'ki-fehlt', 'limit', 'origin', 'netz', 'ungueltig']) {
    const e = new KiFehler(code);
    assert.equal(e.code, code);
    assert.ok(e.message.length > 20, code);
    assert.doesNotMatch(e.message, /undefined|\$\{/);
  }
});

test('pruefeKiRezept: gültiges Rezept im Rohformat, gut lesbar', () => {
  const r = pruefeKiRezept(CURRY, { protein: ['vegan'] }, 0);
  assert.deepEqual(r, {
    id: kiId(CURRY.title), title: CURRY.title, servings: 2, prepMin: null, cookMin: null, totalMin: 30, mahlzeit: 'haupt',
    protein: ['vegan'], tags: [], zutaten: CURRY.zutaten, schritte: CURRY.schritte, herkunft: 'ki',
  });
  assert.match(r.id, /^ki-[0-9a-f]{8}$/);
  for (const zeile of r.zutaten) {
    const z = parseZeile(zeile);
    assert.ok(z && z.name, zeile);
    assert.ok(z.qty != null || z.vague, zeile);
  }
  // vegan passt auch zu „vegetarisch“
  assert.ok(pruefeKiRezept(CURRY, { protein: ['vegetarisch'] }));
  // gleicher Titel → gleiche id (Groß/Klein und Leerraum egal), anderer Titel → andere id
  assert.equal(kiId(' linsen-curry  MIT reis '), r.id);
  assert.notEqual(kiId('Linsen-Curry mit Nudeln'), r.id);
});

test('pruefeKiRezept: Ernährung muss passen (Speck bei vegetarisch, Käse bei vegan …)', () => {
  const vegetarisch = { protein: ['vegetarisch'] };
  const speck = [...CURRY.zutaten, '100 g Speckwürfel'];
  // Speck in einem angeblich vegetarischen Gericht
  assert.equal(pruefeKiRezept(mit({ protein: ['vegetarisch'], zutaten: speck }), vegetarisch), null);
  assert.match(bewerteKiRezept(mit({ protein: ['vegetarisch'], zutaten: speck }), vegetarisch).grund, /fleischlos/);
  // ehrlich als Schwein angegeben: passt nur, wenn Schwein gewählt ist
  assert.equal(pruefeKiRezept(mit({ protein: ['schwein'], zutaten: speck }), vegetarisch), null);
  assert.deepEqual(pruefeKiRezept(mit({ protein: ['schwein'], zutaten: speck }), { protein: ['schwein'] }).protein, ['schwein']);
  // Speck in einem Hähnchengericht: beides zählt
  const haehnchen = mit({ protein: ['gefluegel'], zutaten: ['300 g Hähnchenbrustfilet', ...speck] });
  assert.equal(pruefeKiRezept(haehnchen, { protein: ['gefluegel'] }), null);
  assert.deepEqual(pruefeKiRezept(haehnchen, { protein: ['gefluegel', 'schwein'] }).protein, ['schwein', 'gefluegel']);
  // Fleisch behauptet, aber nichts erkannt: die Angabe zählt trotzdem (vorsichtig)
  assert.deepEqual(pruefeKiRezept(mit({ protein: ['rind'] }), { protein: ['rind'] }).protein, ['rind']);
  assert.equal(pruefeKiRezept(mit({ protein: ['rind'] }), { protein: ['vegan', 'vegetarisch'] }), null);
  assert.equal(pruefeKiRezept(mit({ protein: ['vegan', 'rind'] }), { protein: ['rind', 'vegan'] }), null);

  // Käse, Butter, Ei, Honig im „veganen“ Gericht
  for (const zutat of ['50 g geriebener Käse', '1 EL Butter', '2 Eier', '1 TL Honig', '100 g Joghurt']) {
    const roh = mit({ zutaten: [...CURRY.zutaten, zutat] });
    assert.equal(pruefeKiRezept(roh, { protein: ['vegan'] }), null, zutat);
    assert.match(bewerteKiRezept(roh, { protein: ['vegan'] }).grund, /vegan/, zutat);
    // als vegetarisch angegeben ist es für Vegetarier in Ordnung, für Veganer nicht
    assert.deepEqual(pruefeKiRezept({ ...roh, protein: ['vegetarisch'] }, vegetarisch).protein, ['vegetarisch'], zutat);
    assert.equal(pruefeKiRezept({ ...roh, protein: ['vegetarisch'] }, { protein: ['vegan'] }), null, zutat);
  }
  // Verstecktes Tierisches in fleischlosen Gerichten
  for (const zutat of ['2 EL Austernsauce', '1 Pck. Gelatine', '500 ml Hühnerbrühe', '1 EL Worcestersauce', '1 EL Fischsauce',
    '500 ml Fleischbrühe', '4 Sardellenfilets']) {
    for (const protein of [['vegetarisch'], ['vegan']]) {
      assert.equal(pruefeKiRezept(mit({ protein, zutaten: [...CURRY.zutaten, zutat] }), { protein: ['vegetarisch', 'vegan'] }),
        null, `${zutat} ${protein}`);
    }
  }
  // Gemüsebrühe, Kokosmilch, Erdnussbutter sind vegan
  const ok = mit({ zutaten: [...CURRY.zutaten, '300 ml Gemüsebrühe', '1 EL Erdnussbutter'] });
  assert.deepEqual(pruefeKiRezept(ok, { protein: ['vegan'] }).protein, ['vegan']);
  // „vegetarisch“ behauptet, aber erkannt vegan → bleibt vorsichtig vegetarisch
  assert.deepEqual(pruefeKiRezept(mit({ protein: ['vegetarisch'] }), vegetarisch).protein, ['vegetarisch']);
  // keine Angabe → erkannt
  assert.deepEqual(pruefeKiRezept(mit({ protein: [] }), { protein: ['vegan'] }).protein, ['vegan']);
  assert.deepEqual(pruefeKiRezept(mit({ protein: 'quatsch' }), { protein: ['vegan'] }).protein, ['vegan']);
});

test('pruefeKiRezept: Allergene und „Lieber nicht“ (Zutaten und Titel)', () => {
  const vegan = (extra = {}) => ({ protein: ['vegan'], ...extra });
  assert.equal(pruefeKiRezept(CURRY, vegan({ ohne: ['Zwiebeln'] })), null);
  assert.match(bewerteKiRezept(CURRY, vegan({ ohne: ['Zwiebeln'] })).grund, /zwiebel/i);
  assert.equal(pruefeKiRezept(CURRY, vegan({ ohne: ['koriander'] })).title, CURRY.title);
  assert.equal(pruefeKiRezept(mit({ zutaten: [...CURRY.zutaten, '200 g Champignons'] }), vegan({ ohne: ['Pilze'] })), null);
  assert.equal(pruefeKiRezept(mit({ title: 'Pilz-Curry mit Reis' }), vegan({ ohne: ['Pilze'] })), null);
  assert.equal(pruefeKiRezept(mit({ zutaten: [...CURRY.zutaten, '50 g Cashewkerne'] }), vegan({ allergene: ['nuesse'] })), null);
  assert.equal(pruefeKiRezept(mit({ title: 'Walnuss-Curry' }), vegan({ allergene: ['nuesse'] })), null);
  assert.equal(pruefeKiRezept(mit({ zutaten: [...CURRY.zutaten, '200 g Tofu'] }), vegan({ allergene: ['soja'] })), null);
  assert.equal(pruefeKiRezept(mit({ zutaten: ['250 g Spaghetti', ...CURRY.zutaten] }), vegan({ allergene: ['gluten'] })), null);
  // Ausnahmen gelten auch im Titel: Kokosmilch ist keine Milch, „Reis“ enthält kein „Ei“
  assert.ok(pruefeKiRezept(mit({ title: 'Kokosmilch-Curry mit Reis' }), vegan({ allergene: ['laktose', 'ei'] })));
  // Kochzeit prüft erst der Planer
  assert.ok(pruefeKiRezept(mit({ totalMin: 90 }), vegan({ kochzeit: 'schnell' })));
});

test('pruefeKiRezept: unvollständige oder kaputte Antworten → null', () => {
  const p = { protein: ['vegan'] };
  for (const [name, roh] of [
    ['kein Objekt', null], ['Text', 'Curry'], ['Liste', [CURRY]],
    ['ohne Titel', mit({ title: '   ' })], ['Titel kein Text', mit({ title: 42 })],
    ['ohne Portionen', mit({ servings: undefined })], ['Portionen Unsinn', mit({ servings: 'viele' })],
    ['ohne Zeit', mit({ totalMin: null })],
    ['Zutaten kein Array', mit({ zutaten: '150 g Reis, 1 Zwiebel' })], ['ohne Schritte', mit({ schritte: undefined })],
    ['zu wenige Zutaten', mit({ zutaten: ['150 g Reis', 'Salz'] })],
    ['Zutaten keine Texte', mit({ zutaten: [1, 2, 3, '150 g Reis'] })],
    ['nur Überschriften', mit({ zutaten: ['Für den Reis:', 'Für die Sauce:', 'Dazu:', '150 g Reis'] })],
    ['Zutat ohne Namen', mit({ zutaten: [...CURRY.zutaten, '200 g'] })],
    ['nur Einheit', mit({ zutaten: [...CURRY.zutaten, '2 EL'] })],
    ['nur Zahl', mit({ zutaten: [...CURRY.zutaten, '200'] })],
    ['zu wenige Schritte', mit({ schritte: ['Alles 20 Minuten kochen.'] })],
    ['leere Schritte', mit({ schritte: ['  ', '', 'Kochen.'] })],
  ]) {
    assert.equal(pruefeKiRezept(roh, p), null, name);
    assert.ok(bewerteKiRezept(roh, p).grund, name);
  }
});

test('pruefeKiRezept: säubert und begrenzt Texte und Zahlen', () => {
  const r = pruefeKiRezept({
    title: `  „Curry\u0007\u200b mit\n Reis ${'x'.repeat(200)}“ `,
    servings: '4 Portionen',
    totalMin: 999,
    mahlzeit: 'abendessen',
    protein: ['vegan'],
    zutaten: ['- 150 g Reis', '• 1 Zwiebel', `1 rote Paprika ${'y'.repeat(300)}`, 'Zutaten:', '', 'Salz',
      ...Array.from({ length: 40 }, (_, i) => `${i + 1} g Curry`)],
    schritte: ['1. Reis 15 Minuten kochen.', `Schritt 2: Gemüse ${'z'.repeat(600)}`, '3) Servieren.',
      ...Array.from({ length: 20 }, () => 'Rühren.')],
    extra: 'weg',
  }, { protein: ['vegan'] });
  assert.ok(r);
  assert.ok(r.title.startsWith('Curry mit Reis xxx'), r.title);
  assert.equal(r.title.length, 80);
  assert.equal(r.servings, 4);
  assert.equal(r.totalMin, 240);
  assert.equal(r.mahlzeit, 'haupt');
  assert.equal(r.zutaten[0], '150 g Reis');
  assert.equal(r.zutaten[1], '1 Zwiebel');
  assert.equal(r.zutaten[2].length, 120);
  assert.ok(!r.zutaten.includes('Zutaten:'));
  assert.ok(r.zutaten.length <= 30);
  assert.ok(r.zutaten.every((z) => z.length <= 120 && !/[\u0000-\u001f]/.test(z)));
  assert.equal(r.schritte[0], 'Reis 15 Minuten kochen.');
  assert.ok(r.schritte[1].startsWith('Gemüse zzz'));
  assert.equal(r.schritte[1].length, 400);
  assert.equal(r.schritte[2], 'Servieren.');
  assert.equal(r.schritte.length, 12);
  assert.equal('extra' in r, false);
  // Grenzen nach unten, Frühstück bleibt Frühstück
  const klein = pruefeKiRezept(mit({ servings: 0, totalMin: 1, mahlzeit: 'frueh' }), { protein: ['vegan'] });
  assert.deepEqual([klein.servings, klein.totalMin, klein.mahlzeit], [1, 5, 'frueh']);
  assert.equal(pruefeKiRezept(mit({ servings: 30 }), { protein: ['vegan'] }).servings, 12);
});

test('pruefeKiRezepte: doppelte und schon vorhandene Titel fallen weg, Gründe bleiben', () => {
  const liste = [CURRY, mit({ title: ' linsen-curry MIT reis' }), mit({ title: 'Spaghetti mit Tomatensauce' }),
    mit({ title: 'Speck-Curry', protein: ['vegetarisch'], zutaten: [...CURRY.zutaten, '100 g Speck'] }),
    mit({ title: 'Kichererbsen-Curry' }), 'kaputt'];
  const { rezepte, verworfen } = pruefeKiRezepte(liste, { protein: ['vegan', 'vegetarisch'] },
    { vorhanden: ['Spaghetti mit Tomatensauce'] });
  assert.deepEqual(rezepte.map((r) => r.title), ['Linsen-Curry mit Reis', 'Kichererbsen-Curry']);
  assert.deepEqual(verworfen.map((v) => v.index), [1, 2, 3, 5]);
  assert.equal(verworfen[0].grund, 'Gibt es schon');
  assert.equal(verworfen[2].titel, 'Speck-Curry');
  assert.match(verworfen[2].grund, /fleischlos/);
  assert.deepEqual(pruefeKiRezepte(null, {}), { rezepte: [], verworfen: [] });
});

test('kiRezeptZuRezept: Datenbank-Schema mit festen ids, nutzbar für den Planer', () => {
  const roh = pruefeKiRezept(CURRY, { protein: ['vegan'] });
  const r = kiRezeptZuRezept(roh);
  assert.equal(r.id, roh.id);
  assert.equal(r.title, CURRY.title);
  assert.equal(r.servings, 2);
  assert.equal(r.totalMin, 30);
  assert.equal(r.sourceSite, 'KI-Idee');
  assert.equal(r.sourceUrl, null);
  assert.equal(r.imageUrl, null);
  assert.equal(r.notes, 'KI-Idee – bitte vor dem Kochen prüfen.');
  assert.equal(r.favorite, false);
  assert.equal(r.herkunft, 'ki');
  assert.equal(r.mahlzeit, 'haupt');
  assert.deepEqual(r.protein, ['vegan']);
  assert.deepEqual(r.tags, []);
  assert.equal(r.ingredients.length, CURRY.zutaten.length);
  assert.deepEqual(r.ingredients.map((z) => z.id), CURRY.zutaten.map((_, i) => `${roh.id}-z${i}`));
  assert.deepEqual(r.ingredients[0], { id: `${roh.id}-z0`, group: null, raw: '150 g Reis', qty: 150, qty2: null, unit: 'g',
    size: null, name: 'Reis', note: null, vague: false });
  assert.equal(r.ingredients[3].unit, 'Dose');
  assert.ok(r.ingredients.at(-1).vague);
  assert.deepEqual(r.steps, CURRY.schritte.map((text, i) => ({ id: `${roh.id}-s${i}`, group: null, text })));
  // deterministisch: zweimal gleich
  assert.deepEqual(kiRezeptZuRezept(roh), r);
  // der Planer liest Mahlzeit, Protein und Zeit aus den Feldern
  assert.deepEqual(rezeptMeta(r), { mahlzeit: 'haupt', protein: ['vegan'], totalMin: 30 });
  // Kopien, keine geteilten Arrays
  r.protein.push('x');
  r.tags.push('y');
  assert.deepEqual([roh.protein, roh.tags], [['vegan'], []]);
  assert.equal(passtZumProfil(kiRezeptZuRezept(roh), { protein: ['vegetarisch'], kochzeit: 'normal' }).ok, true);
  // ohne id: aus dem Titel
  assert.equal(kiRezeptZuRezept({ title: 'Test', zutaten: [], schritte: [] }).id, kiId('Test'));
});

test('Ganzer Weg: kiAnfrage → Worker (Attrappe) → holeKiRezepte → pruefeKiRezepte → Rezept', async () => {
  const antwort = {
    rezepte: [
      CURRY,
      mit({ title: 'Nudeln mit Speck', protein: ['vegetarisch'], zutaten: ['250 g Nudeln', '100 g Speck', '1 Zwiebel'] }),
      mit({ title: 'Kartoffel-Gemüse-Pfanne', protein: ['vegan'], zutaten: ['800 g Kartoffeln', '1 Zucchini', '1 Zwiebel', '2 EL Öl', 'Salz'] }),
    ],
  };
  const env = { AI: { run: async () => ({ choices: [{ message: { content: JSON.stringify(antwort) } }] }) } };
  const fetchFn = (url, init) => worker.fetch(new Request(url, { ...init, headers: { ...init.headers, Origin: APP } }), env);
  const profil = { protein: ['vegan', 'vegetarisch'], personen: 2 };
  const roh = await holeKiRezepte(DIENST, kiAnfrage(profil, { anzahl: 3 }), { fetchFn });
  assert.equal(roh.length, 3);
  const { rezepte, verworfen } = pruefeKiRezepte(roh, profil);
  assert.deepEqual(rezepte.map((r) => r.title), ['Linsen-Curry mit Reis', 'Kartoffel-Gemüse-Pfanne']);
  assert.equal(verworfen.length, 1);
  const db = rezepte.map(kiRezeptZuRezept);
  assert.ok(db.every((r) => r.id.startsWith('ki-') && r.ingredients.length >= 3 && r.steps.length >= 2));

  // ohne Binding: verständliche Anleitung
  const ohne = (url, init) => worker.fetch(new Request(url, { ...init, headers: { ...init.headers, Origin: APP } }), {});
  const e = await fehlerVon(holeKiRezepte(DIENST, kiAnfrage(profil), { fetchFn: ohne }));
  assert.equal(e.code, 'ki-fehlt');
  assert.match(e.message, /Bindings → Add → Workers AI/);
});
