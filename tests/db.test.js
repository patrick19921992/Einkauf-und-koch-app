// Tests für die reinen Sicherungs-Funktionen aus js/db.js (ohne IndexedDB).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bereinigeDatensatz, importEntscheidung, fuehreEinstellungenZusammen, STANDARD_EINSTELLUNGEN,
} from '../js/db.js';

const GRENZE = Date.UTC(2026, 9, 16, 12);

const gutesRezept = () => ({
  id: 'r1', createdAt: 100, updatedAt: 200, deleted: false,
  title: 'Linsensuppe', sourceUrl: 'https://www.chefkoch.de/rezepte/1/x.html', sourceSite: 'chefkoch.de', imageUrl: '',
  servings: 4, prepMin: 10, cookMin: 30, totalMin: 40, tags: ['Suppe', 'schnell'], notes: 'Mit Essig.', favorite: true,
  ingredients: [
    { id: 'z1', group: null, raw: '200 g Linsen', qty: 200, qty2: null, unit: 'g', size: null, name: 'Linsen', note: null, vague: false },
    { id: 'z2', group: 'Zum Servieren', raw: '1-2 EL Essig', qty: 1, qty2: 2, unit: 'EL', size: null, name: 'Essig', note: null, vague: false },
  ],
  steps: [{ id: 's1', group: null, text: 'Linsen kochen.' }],
});

test('bereinigeDatensatz: gültige Datensätze bleiben unverändert', () => {
  assert.deepEqual(bereinigeDatensatz('recipes', gutesRezept(), GRENZE), gutesRezept());
  const eintrag = { id: 'p1', createdAt: 1, updatedAt: 2, deleted: false, date: '2026-10-15', slot: 'mittag', recipeId: 'r1',
    title: 'Linsensuppe', servings: 2, note: '', cooked: false, tripId: null };
  assert.deepEqual(bereinigeDatensatz('planEntries', eintrag, GRENZE), eintrag);
  const runde = { id: 't1', createdAt: 1, updatedAt: 2, deleted: false, from: '2026-10-12', to: '2026-10-18', closedAt: 5 };
  assert.deepEqual(bereinigeDatensatz('trips', runde, GRENZE), runde);
  const zustand = { id: 't1|milch', createdAt: 1, updatedAt: 2, deleted: true, kind: 'state', tripId: 't1', mergeKey: 'milch',
    abgehakt: { ml: 500 }, erledigt: true, versteckt: false };
  assert.deepEqual(bereinigeDatensatz('shoppingItems', zustand, GRENZE), zustand);
  const alias = { id: 'tomaten passiert', createdAt: 1, updatedAt: 2, deleted: false, kanonisch: null, section: 'konserven' };
  assert.deepEqual(bereinigeDatensatz('aliases', alias, GRENZE), alias);
  // einfache Zusatzfelder (neuere Version) bleiben, Objekte darin nicht
  const mehr = bereinigeDatensatz('recipes', { ...gutesRezept(), zuletztGekocht: 5, extra: { a: 1 } }, GRENZE);
  assert.equal(mehr.zuletztGekocht, 5);
  assert.equal('extra' in mehr, false);
});

test('bereinigeDatensatz: Rezept mit falschen Typen wird repariert', () => {
  const r = bereinigeDatensatz('recipes', {
    id: 'r1', title: { de: 'X' }, tags: 'Pasta, schnell', ingredients: { a: 1 }, steps: 'Wasser kochen\n\nNudeln rein',
    servings: '4 Portionen', prepMin: '15', cookMin: -5, totalMin: Infinity, imageUrl: 5, sourceUrl: ['x'], favorite: 'ja', updatedAt: 1,
  }, GRENZE);
  assert.equal(r.title, 'Ohne Titel');
  assert.deepEqual(r.tags, ['Pasta', 'schnell']);
  assert.deepEqual(r.ingredients, []);
  assert.deepEqual(r.steps.map((s) => [s.text, s.group, typeof s.id]), [['Wasser kochen', null, 'string'], ['Nudeln rein', null, 'string']]);
  assert.deepEqual([r.servings, r.prepMin, r.cookMin, r.totalMin], [null, 15, null, null]);
  assert.equal(r.imageUrl, '5');
  assert.equal(r.sourceUrl, '');
  assert.equal(r.favorite, false);
  assert.equal(r.deleted, false);

  const z = bereinigeDatensatz('recipes', {
    id: 'r2', title: 'Kaputt', tags: [5, null, ' ', 'Pasta', 'Pasta'],
    ingredients: [null, 5, 'Salz', [], { raw: 5, name: 7, qty: 'viel', qty2: '2,5', unit: { a: 1 }, group: 3, vague: 1 }, { raw: '', name: '' },
      { raw: '1 Prise Salz' }],
    steps: [null, { text: 5, group: [] }, { text: '' }, 'Rühren'],
  }, GRENZE);
  assert.deepEqual(z.tags, ['5', 'Pasta']);
  assert.equal(z.ingredients.length, 2);
  assert.deepEqual({ ...z.ingredients[0], id: 'x' },
    { id: 'x', group: '3', raw: '5', qty: null, qty2: 2.5, unit: null, size: null, name: '7', note: null, vague: false });
  assert.equal(z.ingredients[1].name, '1 Prise Salz');
  assert.deepEqual(z.steps.map((s) => [s.text, s.group]), [['5', null], ['Rühren', null]]);
});

test('bereinigeDatensatz: __proto__ und andere Fallen', () => {
  const r = bereinigeDatensatz('recipes', JSON.parse('{"id":"r1","title":"Proto","__proto__":{"tags":"x"},"ingredients":[],"steps":[]}'), GRENZE);
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
  assert.equal(Object.hasOwn(r, '__proto__'), false);
  assert.deepEqual(r.tags, []);
  const zustand = bereinigeDatensatz('shoppingItems', JSON.parse(
    '{"id":"t|x","kind":"state","tripId":"t","mergeKey":"x","abgehakt":{"g":200,"__proto__":{"a":1},"constructor":5,"ml":"viel"}}'), GRENZE);
  assert.deepEqual(Object.entries(zustand.abgehakt), [['g', 200]]);
  assert.equal(bereinigeDatensatz('aliases', { id: '__proto__', kanonisch: 'x' }, GRENZE), null);
  assert.equal(bereinigeDatensatz('aliases', { id: 'constructor' }, GRENZE), null);
  assert.equal(bereinigeDatensatz('recipes', { id: 5, title: 'X' }, GRENZE), null);
  assert.equal(bereinigeDatensatz('recipes', { id: '', title: 'X' }, GRENZE), null);
  assert.equal(bereinigeDatensatz('recipes', ['r1'], GRENZE), null);
  assert.equal(bereinigeDatensatz('settings', { id: 'haushalt' }, GRENZE), null);
  assert.equal(bereinigeDatensatz('toString', { id: 'x' }, GRENZE), null);
});

test('bereinigeDatensatz: Wochenplan, Runden, Einkaufsliste, Korrekturen', () => {
  const p = bereinigeDatensatz('planEntries', { id: 'p1', date: '2026-10-15', slot: 'constructor', recipeId: 5, title: { a: 1 },
    servings: 'viel', note: null, cooked: 'ja', tripId: {} }, GRENZE);
  assert.deepEqual({ ...p }, { id: 'p1', date: '2026-10-15', slot: 'abend', recipeId: null, title: '', servings: null, note: '',
    cooked: false, tripId: null, createdAt: 0, updatedAt: 0, deleted: false });
  for (const date of [20261015, '2026-02-30', '15.10.2026', ['2026-10-15'], null]) {
    assert.equal(bereinigeDatensatz('planEntries', { id: 'p1', date, slot: 'abend' }, GRENZE), null, String(date));
  }
  assert.equal(bereinigeDatensatz('trips', { id: 't1', from: 5, to: null, closedAt: null }, GRENZE), null);
  const runde = bereinigeDatensatz('trips', { id: 't1', from: '2026-10-18', to: '2026-10-12', closedAt: 'gestern' }, GRENZE);
  assert.deepEqual([runde.from, runde.to, runde.closedAt], ['2026-10-12', '2026-10-18', null]);

  const m = bereinigeDatensatz('shoppingItems', { id: 'm1', kind: 'manual', name: 'Milch', qty: 'viel', unit: { a: 1 }, note: 5, checked: 'ja' }, GRENZE);
  assert.deepEqual([m.name, m.qty, m.qty2, m.unit, m.note, m.section, m.checked], ['Milch', null, null, null, '5', null, false]);
  assert.equal(bereinigeDatensatz('shoppingItems', { id: 'm2', kind: 'manual', name: '  ' }, GRENZE), null);
  assert.equal(bereinigeDatensatz('shoppingItems', { id: 'm3', kind: 'fremd', name: 'Milch' }, GRENZE), null);
  assert.equal(bereinigeDatensatz('shoppingItems', { id: 'x', kind: 'state', tripId: 't', mergeKey: 5 }, GRENZE), null);

  const a = bereinigeDatensatz('aliases', { id: 'milch', kanonisch: 5, section: { a: 1 } }, GRENZE);
  assert.deepEqual([a.kanonisch, a.section], ['5', null]);
});

test('bereinigeDatensatz: Zeitstempel aus der Zukunft werden gekürzt', () => {
  const r = bereinigeDatensatz('recipes', { id: 'r1', title: 'X', updatedAt: 8.64e15, createdAt: 8.64e15, deleted: true }, GRENZE);
  assert.equal(r.updatedAt, GRENZE);
  assert.equal(r.createdAt, GRENZE);
  assert.equal(r.deleted, true);
  const ohne = bereinigeDatensatz('recipes', { id: 'r1', title: 'X', updatedAt: '5', createdAt: -3, deleted: 'ja' }, GRENZE);
  assert.deepEqual([ohne.updatedAt, ohne.createdAt, ohne.deleted], [5, 5, false]);
  assert.equal(bereinigeDatensatz('recipes', { id: 'r1', title: 'X', updatedAt: NaN }, GRENZE).updatedAt, 0);
});

test('importEntscheidung: neuer Stand gewinnt, Löschungen werden eigens gemeldet', () => {
  const lokal = { id: 'a', updatedAt: 10, deleted: false };
  const lokalWeg = { id: 'a', updatedAt: 10, deleted: true };
  assert.equal(importEntscheidung(undefined, { updatedAt: 1, deleted: false }), 'neu');
  assert.equal(importEntscheidung(undefined, { updatedAt: 1, deleted: true }), 'markierung');
  assert.equal(importEntscheidung(lokal, { updatedAt: 10, deleted: false }), 'uebersprungen');
  assert.equal(importEntscheidung(lokal, { updatedAt: 9, deleted: true }), 'uebersprungen');
  assert.equal(importEntscheidung(lokal, { updatedAt: 11, deleted: false }), 'aktualisiert');
  assert.equal(importEntscheidung(lokal, { updatedAt: 11, deleted: true }), 'geloescht');
  assert.equal(importEntscheidung(lokalWeg, { updatedAt: 11, deleted: false }), 'neu');
  assert.equal(importEntscheidung(lokalWeg, { updatedAt: 11, deleted: true }), 'markierung');
});

test('fuehreEinstellungenZusammen: pro Einstellung gewinnt der neuere Stand', () => {
  // Gerät A hat Vorrat, Reihenfolge und Mahlzeiten geändert und gesichert
  const a = { id: 'haushalt', createdAt: 1, updatedAt: 300, vorrat: ['salz', 'pfeffer', 'wasser', 'öl', 'zucker'],
    abteilungsReihenfolge: ['fleisch', 'obst-gemuese'], mahlzeiten: ['mittag', 'abend'],
    geaendert: { vorrat: 100, abteilungsReihenfolge: 200, mahlzeiten: 300 } };
  // Gerät B hat danach nur den Wochenstart geändert
  const b = { id: 'haushalt', createdAt: 2, updatedAt: 400, wochenstart: 0, geaendert: { wochenstart: 400 } };
  const { datensatz, uebernommen } = fuehreEinstellungenZusammen(b, a, GRENZE);
  assert.deepEqual(uebernommen, ['mahlzeiten', 'abteilungsReihenfolge', 'vorrat']);
  assert.equal(datensatz.wochenstart, 0);
  assert.deepEqual(datensatz.vorrat, a.vorrat);
  assert.deepEqual(datensatz.abteilungsReihenfolge, a.abteilungsReihenfolge);
  assert.deepEqual(datensatz.mahlzeiten, a.mahlzeiten);
  assert.deepEqual(datensatz.geaendert, { wochenstart: 400, vorrat: 100, abteilungsReihenfolge: 200, mahlzeiten: 300 });
  assert.equal(datensatz.updatedAt, 400);
  assert.equal(datensatz.createdAt, 2);

  // Rückweg: B in A einlesen bringt nur den Wochenstart
  const zurueck = fuehreEinstellungenZusammen(a, b, GRENZE);
  assert.deepEqual(zurueck.uebernommen, ['wochenstart']);
  assert.deepEqual(zurueck.datensatz.vorrat, a.vorrat);
  // Dieselbe Sicherung noch einmal: nichts zu tun
  assert.deepEqual(fuehreEinstellungenZusammen(datensatz, a, GRENZE), { datensatz: null, uebernommen: [] });
});

test('fuehreEinstellungenZusammen: ältere Datensätze, Zukunft, ungültige Werte', () => {
  // ohne `geaendert` zählt das updatedAt des Datensatzes für jede gespeicherte Einstellung
  const alt = { id: 'haushalt', updatedAt: 500, vorrat: ['salz'] };
  const neuer = { id: 'haushalt', updatedAt: 600, vorrat: ['salz', 'zucker'], wochenstart: 6 };
  assert.deepEqual(fuehreEinstellungenZusammen(alt, neuer, GRENZE).uebernommen, ['wochenstart', 'vorrat']);
  assert.deepEqual(fuehreEinstellungenZusammen(neuer, alt, GRENZE).datensatz, null);
  // Nie gesetzte Einstellung (Standard) verliert gegen jede gesetzte
  const leer = fuehreEinstellungenZusammen(undefined, { id: 'haushalt', updatedAt: 5, standardPortionen: 2 }, GRENZE);
  assert.deepEqual(leer.uebernommen, ['standardPortionen']);
  assert.equal(leer.datensatz.standardPortionen, 2);
  // gleicher Wert wie der Standard: übernommen, aber nicht als Änderung gezählt
  const gleich = fuehreEinstellungenZusammen(undefined, { updatedAt: 5, vorrat: [...STANDARD_EINSTELLUNGEN.vorrat] }, GRENZE);
  assert.deepEqual(gleich.uebernommen, []);
  assert.deepEqual(gleich.datensatz.geaendert, { vorrat: 5 });
  // Zeit aus der Zukunft gilt nur bis zur Grenze: eine spätere lokale Änderung gewinnt wieder
  const zukunft = { id: 'haushalt', vorrat: ['x'], geaendert: { vorrat: 8.64e15 } };
  assert.equal(fuehreEinstellungenZusammen(undefined, zukunft, GRENZE).datensatz.geaendert.vorrat, GRENZE);
  const spaeter = { id: 'haushalt', vorrat: ['salz'], geaendert: { vorrat: GRENZE + 1 } };
  assert.equal(fuehreEinstellungenZusammen(spaeter, zukunft, GRENZE).datensatz, null);
  // ungültige Werte zählen nicht
  const kaputt = { id: 'haushalt', updatedAt: 900, vorrat: 'salz', mahlzeiten: ['nachts'], wochenstart: 3, standardPortionen: '3' };
  const k = fuehreEinstellungenZusammen(alt, kaputt, GRENZE);
  assert.deepEqual(k.uebernommen, ['standardPortionen']);
  assert.equal(k.datensatz.standardPortionen, 3);
  assert.deepEqual(k.datensatz.vorrat, ['salz']);
  for (const e of [null, 'x', []]) assert.deepEqual(fuehreEinstellungenZusammen(alt, e, GRENZE), { datensatz: null, uebernommen: [] });
});
