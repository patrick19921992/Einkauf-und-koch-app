import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTEINE, ALLERGENE, MAHLZEITEN, STANDARD_PROFIL, normalisiereProfil, erkenneProtein, rezeptMeta, passtZumProfil,
  plane, tausche, kostenDesPlans, zeitText, kochzeitPasst, ohneBedeutung,
} from '../js/planer.js';
import { parseZeilen } from '../js/zutaten.js';
import { formatEuroGerundet } from '../js/preise.js';
import { ladeGrundrezepte } from '../js/daten/rezepte.js';

// Kleine, erfundene Preistabelle und Rezepte: Tests hängen nicht an den echten Daten
const TABELLE = {
  preise: [
    ['nudel', 1.0, 500, 'g'], ['spaghetti', 1.0, 500, 'g'], ['reis', 2.0, 1000, 'g'], ['couscous', 3.0, 500, 'g'],
    ['kartoffel', 2.0, 2000, 'g', { stueckGewicht: 150 }], ['zwiebel', 1.0, 1000, 'g', { stueckGewicht: 100 }],
    ['paprika', 1.0, 1, 'Stück', { stueckGewicht: 150 }], ['brokkoli', 1.5, 500, 'g', { stueckGewicht: 500 }],
    ['champignon', 2.0, 400, 'g'], ['tomate, gehackt', 0.5, 400, 'g', { container: 'Dose' }],
    ['kokosmilch', 1.5, 400, 'ml', { container: 'Dose' }], ['tofu', 2.0, 200, 'g'],
    ['hähnchenbrustfilet', 6.0, 600, 'g'], ['hackfleisch', 4.0, 500, 'g'], ['lachsfilet', 5.0, 250, 'g'],
    ['steak', 20.0, 400, 'g'], ['sahne', 1.0, 200, 'ml'], ['käse', 2.0, 200, 'g'], ['milch', 1.0, 1000, 'ml'],
    ['ei', 2.0, 10, 'Stück', { stueckGewicht: 60 }], ['haferflocken', 1.0, 500, 'g', { dichte: 0.4 }],
    ['banane', 2.0, 1000, 'g', { stueckGewicht: 200, lose: true }],
    ['salz', 0.4, 500, 'g', { vorrat: true }], ['öl', 2.0, 1000, 'ml', { vorrat: true }],
  ],
  ladenFaktor: { aldi: 1, lidl: 1, penny: 1.1, netto: 1.1, kaufland: 1.2, rewe: 1.5, edeka: 2 },
  kategorie: {},
};
const HEUTE = '2026-10-19';

function rezept(id, title, zeilen, extra = {}) {
  return { id, title, servings: 2, prepMin: 10, cookMin: 20, totalMin: 30, tags: [], notes: '', favorite: false,
    herkunft: 'grund', mahlzeit: 'haupt', ingredients: parseZeilen(zeilen.join('\n')), steps: [], ...extra };
}
const HAUPT = [
  rezept('h01', 'Nudeln mit Tomatensauce', ['250 g Nudeln', '1 Dose gehackte Tomaten', '1 Zwiebel', 'Salz'],
    { protein: ['vegan'], tags: ['pasta'] }),
  rezept('h02', 'Hähnchen mit Reis', ['300 g Hähnchenbrustfilet', '150 g Reis', '1 Paprika', '1 EL Öl'],
    { protein: ['gefluegel'], tags: ['reis'] }),
  rezept('h03', 'Spaghetti Bolognese', ['250 g Spaghetti', '250 g Hackfleisch', '1 Dose gehackte Tomaten', '1 Zwiebel'],
    { protein: ['rind', 'schwein'], tags: ['pasta'] }),
  rezept('h04', 'Lachs mit Kartoffeln', ['250 g Lachsfilet', '500 g Kartoffeln', '100 ml Sahne'],
    { protein: ['fisch'], tags: ['kartoffeln'] }),
  rezept('h05', 'Gemüsecurry mit Reis', ['150 g Reis', '1 Dose Kokosmilch (400 ml)', '1 Brokkoli', '1 Paprika'],
    { protein: ['vegan'], tags: ['reis'] }),
  rezept('h06', 'Nudelauflauf mit Käse', ['250 g Nudeln', '100 g Käse', '100 ml Sahne'], { protein: ['vegetarisch'] }),
  rezept('h07', 'Champignonpfanne mit Reis', ['400 g Champignons', '150 g Reis', '1 Zwiebel'], { protein: ['vegan'] }),
  rezept('h08', 'Tofu-Gemüse-Pfanne', ['200 g Tofu', '1 Brokkoli', '150 g Reis'], { protein: ['vegan'] }),
  rezept('h09', 'Kartoffelpfanne mit Ei', ['600 g Kartoffeln', '4 Eier', '1 Zwiebel'], { protein: ['vegetarisch'] }),
  rezept('h10', 'Hähnchen-Nudeln', ['300 g Hähnchenbrustfilet', '250 g Nudeln', '100 ml Sahne'], { protein: ['gefluegel'] }),
  rezept('h11', 'Lachs-Nudeln', ['125 g Lachsfilet', '250 g Nudeln', '100 ml Sahne'], { protein: ['fisch'] }),
  rezept('h12', 'Hackpfanne mit Kartoffeln', ['250 g Hackfleisch', '600 g Kartoffeln', '1 Paprika'],
    { protein: ['rind', 'schwein'] }),
  rezept('h13', 'Steak mit Ofenkartoffeln', ['400 g Rindersteak', '600 g Kartoffeln'],
    { protein: ['rind'], totalMin: 60, prepMin: 15, cookMin: 45 }),
];
const FRUEH = [
  rezept('f01', 'Porridge mit Banane', ['100 g Haferflocken', '400 ml Milch', '1 Banane'],
    { mahlzeit: 'frueh', protein: ['vegetarisch'], totalMin: 10 }),
  rezept('f02', 'Rührei', ['4 Eier', '50 ml Milch', 'Salz'], { mahlzeit: 'frueh', protein: ['vegetarisch'], totalMin: 10 }),
  rezept('f03', 'Haferflocken mit Banane', ['80 g Haferflocken', '2 Bananen'], { mahlzeit: 'frueh', protein: ['vegan'], totalMin: 5 }),
];
const ALLE = [...HAUPT, ...FRUEH];
const plan = (profil, extra = {}) => plane({ rezepte: ALLE, profil, heute: HEUTE, tabelle: TABELLE, ...extra });
const ids = (p) => p.eintraege.map((e) => e.rezeptId);
const nachId = new Map(ALLE.map((r) => [r.id, r]));

test('Listen: Proteine, Allergene, Mahlzeiten und Standard-Profil', () => {
  assert.deepEqual(PROTEINE.map((p) => p.id), ['schwein', 'rind', 'gefluegel', 'fisch', 'vegetarisch', 'vegan']);
  assert.equal(PROTEINE[2].name, 'Geflügel');
  assert.deepEqual(ALLERGENE.map((a) => a.id), ['nuesse', 'laktose', 'gluten', 'ei', 'soja', 'fisch']);
  assert.ok(ALLERGENE.every((a) => a.name && a.woerter.length > 0));
  assert.deepEqual(MAHLZEITEN, [{ id: 'frueh', name: 'Frühstück', art: 'frueh' },
    { id: 'mittag', name: 'Mittagessen', art: 'haupt' }, { id: 'abend', name: 'Abendessen', art: 'haupt' }]);
  assert.deepEqual({ ...STANDARD_PROFIL, protein: [...STANDARD_PROFIL.protein], ohne: [], allergene: [],
    mahlzeiten: [...STANDARD_PROFIL.mahlzeiten], laeden: [...STANDARD_PROFIL.laeden] }, {
    protein: ['schwein', 'rind', 'gefluegel', 'fisch', 'vegetarisch', 'vegan'], ohne: [], allergene: [], kochzeit: 'normal',
    personen: 2, tage: 7, start: null, mahlzeiten: ['abend'], laeden: ['lidl'], budget: null, eigeneRezepte: true,
    kiIdeen: false });
  assert.ok(Object.isFrozen(STANDARD_PROFIL) && Object.isFrozen(STANDARD_PROFIL.protein));
});

test('normalisiereProfil: Standardwerte, Grenzen und unbekannte ids', () => {
  const leer = normalisiereProfil();
  assert.deepEqual(leer, normalisiereProfil({}));
  assert.deepEqual(leer.protein, [...STANDARD_PROFIL.protein]);
  leer.protein.push('x'); // Kopie, nicht das Original
  assert.equal(STANDARD_PROFIL.protein.length, 6);
  const p = normalisiereProfil({ protein: ['vegan', 'tofu', 'fisch', 'vegan'], ohne: 'Pilze, Koriander,, Pilze',
    allergene: ['gluten', 'nuesse', 'gibtsnicht'], kochzeit: 'blitz', personen: 0, tage: 30, start: '2026-02-30',
    mahlzeiten: ['abend', 'snack', 'frueh'], laeden: ['rewe', 'aldi', 'rewe', 'dm', 'lidl', 'edeka'], budget: '50,5',
    eigeneRezepte: false, kiIdeen: 'ja' });
  assert.deepEqual(p, { protein: ['fisch', 'vegan'], ohne: ['pilz', 'koriander'], allergene: ['nuesse', 'gluten'],
    kochzeit: 'normal', personen: 1, tage: 14, start: null, mahlzeiten: ['frueh', 'abend'],
    laeden: ['rewe', 'aldi', 'lidl'], budget: 50.5, eigeneRezepte: false, kiIdeen: false });
  assert.equal(normalisiereProfil({ personen: 20 }).personen, 12);
  assert.equal(normalisiereProfil({ personen: 'drei' }).personen, 2);
  assert.equal(normalisiereProfil({ tage: 0 }).tage, 1);
  assert.equal(normalisiereProfil({ budget: 0 }).budget, null);
  assert.equal(normalisiereProfil({ budget: -5 }).budget, null);
  assert.equal(normalisiereProfil({ start: '2026-10-20' }).start, '2026-10-20');
  assert.deepEqual(normalisiereProfil({ protein: ['x'], mahlzeiten: [], laeden: ['dm'] }).laeden, ['lidl']);
  assert.deepEqual(normalisiereProfil({ ohne: ['Zwiebeln', ' '] }).ohne, ['zwiebel']);
  assert.deepEqual(normalisiereProfil(null).mahlzeiten, ['abend']);
});

test('zeitText und kochzeitPasst', () => {
  assert.equal(zeitText(25), '25 Min.');
  assert.equal(zeitText(60), '1 Std.');
  assert.equal(zeitText(95), '1 Std. 35 Min.');
  assert.equal(zeitText(null), '');
  assert.equal(zeitText(0), '');
  assert.ok(kochzeitPasst(25, 'schnell'));
  assert.ok(!kochzeitPasst(26, 'schnell', 'haupt'));
  assert.ok(kochzeitPasst(15, 'schnell', 'frueh'));
  assert.ok(!kochzeitPasst(20, 'schnell', 'frueh'));
  assert.ok(kochzeitPasst(45, 'normal'));
  assert.ok(!kochzeitPasst(50, 'normal'));
  assert.ok(kochzeitPasst(25, 'normal', 'frueh'));
  assert.ok(!kochzeitPasst(30, 'normal', 'frueh'));
  assert.ok(kochzeitPasst(240, 'egal'));
});

test('erkenneProtein: Fleisch, Fisch, vegetarisch und vegan aus den Zutaten', () => {
  const p = (...zeilen) => erkenneProtein({ zutaten: zeilen });
  const faelle = {
    gefluegel: ['400 g Hähnchenbrustfilet', '2 Putenschnitzel', '500 ml Hühnerbrühe', '100 g Putenschinken',
      '1 Entenbrust', '1 Suppenhuhn'],
    schwein: ['100 g Speck', '4 Scheiben Schinken', '1 Chorizo', '4 Bratwürste', '200 g Kassler', '100 g Lachsschinken',
      '1 Pck. Gelatine', '2 Wiener Würstchen'],
    rind: ['400 g Rinderhackfleisch', '2 Rumpsteaks', '500 g Gulasch', '1 Lammkeule', '500 ml Fleischbrühe'],
    fisch: ['200 g Lachsfilet', '1 Dose Thunfisch', '2 EL Fischsauce', '200 g Garnelen', '1 TL Worcestershiresauce'],
    vegetarisch: ['200 ml Milch', '2 Eier', '100 g Butter', '1 EL Honig', '100 g Parmesan', '2 EL Pesto',
      '200 g Butterschmalz', '1 Hühnerei'],
    vegan: ['1 Limette', '1 Rolle Flammkuchenteig', '500 ml Gemüsebrühe', '50 g Erdnüsse', '400 ml Kokosmilch',
      '2 EL Erdnussbutter', '200 g Tofu', '200 g Sojahack', '1 Dose gehackte Tomaten', '250 g Milchreis',
      '1 Prise Muskatnuss', '1 Hokkaido', '300 g Muschelnudeln', '1 Blumenkohlsteak', '400 ml Hafermilch',
      '1 Honigmelone', '½ TL Hirschhornsalz', '200 g Fleischtomaten', '100 g Studentenfutter', '2 Ochsenherztomaten',
      '100 g veganer Käse', '2 EL vegane Butter', '1 Glas veganes Pesto', '200 ml Sojasahne'],
  };
  for (const [soll, zeilen] of Object.entries(faelle)) {
    for (const z of zeilen) assert.deepEqual(p(z), [soll], z);
  }
  assert.deepEqual(p('500 g Hackfleisch'), ['rind', 'schwein']);
  assert.deepEqual(p('500 g gemischtes Hackfleisch'), ['rind', 'schwein']);
  assert.deepEqual(p('4 Frikadellen'), ['rind', 'schwein']);
  assert.deepEqual(p('500 g Schweinehackfleisch'), ['schwein']);
  assert.deepEqual(p('300 g Putenhackfleisch'), ['gefluegel']);
  assert.deepEqual(p('Salz', 'Pfeffer', '200 g Nudeln', '1 Zwiebel'), ['vegan']);
  assert.deepEqual(p('200 g Nudeln', '100 g Speck', '2 Eier'), ['schwein']);
  assert.deepEqual(p('200 g Hähnchen', '100 g Garnelen'), ['gefluegel', 'fisch']);
  // db-Rezept mit zerlegten Zutaten; Überschriften zählen nicht
  assert.deepEqual(erkenneProtein({ ingredients: parseZeilen('Für die Soße:\n200 ml Sahne\n1 Zwiebel') }), ['vegetarisch']);
  assert.deepEqual(erkenneProtein({}), ['vegan']);
  assert.deepEqual(erkenneProtein(null), ['vegan']);
});

test('rezeptMeta: eigene Angaben, sonst erkannt; Kuchen und Desserts sind nicht planbar', () => {
  assert.deepEqual(rezeptMeta(HAUPT[2]), { mahlzeit: 'haupt', protein: ['rind', 'schwein'], totalMin: 30 });
  assert.deepEqual(rezeptMeta(FRUEH[2]), { mahlzeit: 'frueh', protein: ['vegan'], totalMin: 5 });
  const eigen = (title, zeilen, extra = {}) => ({ id: 'e', title, servings: 4, ingredients: parseZeilen(zeilen.join('\n')),
    ...extra });
  assert.deepEqual(rezeptMeta(eigen('Omas Gulasch', ['800 g Rindergulasch', '3 Zwiebeln'], { prepMin: 20, cookMin: 100 })),
    { mahlzeit: 'haupt', protein: ['rind'], totalMin: 120 });
  assert.equal(rezeptMeta(eigen('Linsensuppe', ['200 g Linsen'])).totalMin, 30);
  assert.equal(rezeptMeta(eigen('Bircher Müsli', ['100 g Haferflocken', '200 ml Milch'])).mahlzeit, 'frueh');
  assert.equal(rezeptMeta(eigen('Rührei', ['4 Eier'], { tags: ['Frühstück'] })).mahlzeit, 'frueh');
  assert.equal(rezeptMeta(eigen('Schoko-Muffins', ['200 g Mehl'])).mahlzeit, null);
  assert.equal(rezeptMeta(eigen('Erdbeertorte', ['500 g Erdbeeren'])).mahlzeit, null);
  assert.equal(rezeptMeta(eigen('Apfelkuchen', ['300 g Mehl', '150 g Zucker', '4 Äpfel'])).mahlzeit, null);
  assert.equal(rezeptMeta(eigen('Tiramisu', ['250 g Mascarpone'], { tags: ['Dessert'] })).mahlzeit, null);
  assert.equal(rezeptMeta(eigen('Pfannkuchen mit Ahornsirup', ['250 g Mehl', '2 EL Zucker', '3 Eier'])).mahlzeit, 'haupt');
  assert.equal(rezeptMeta(eigen('Tortellini in Sahnesauce', ['500 g Tortellini'])).mahlzeit, 'haupt');
  assert.deepEqual(rezeptMeta(eigen('Linsen', ['200 g Linsen'], { protein: ['vegan', 'quatsch'] })).protein, ['vegan']);
});

test('passtZumProfil: Proteine (vegan auch bei vegetarisch), ohne, Allergene, Kochzeit', () => {
  const nur = (...protein) => ({ protein });
  assert.deepEqual(passtZumProfil(HAUPT[0], nur('vegetarisch')), { ok: true, grund: null });
  assert.deepEqual(passtZumProfil(HAUPT[0], nur('vegan')), { ok: true, grund: null });
  assert.deepEqual(passtZumProfil(HAUPT[5], nur('vegan')), { ok: false, grund: 'Nicht gewählt: Vegetarisch' });
  assert.equal(passtZumProfil(HAUPT[5], nur('vegetarisch')).ok, true);
  assert.equal(passtZumProfil(HAUPT[1], nur('rind', 'schwein', 'vegetarisch')).ok, false);
  // gemischtes Hack braucht Rind und Schwein
  assert.equal(passtZumProfil(HAUPT[2], nur('rind')).ok, false);
  assert.equal(passtZumProfil(HAUPT[2], nur('rind', 'schwein')).ok, true);
  assert.equal(passtZumProfil(HAUPT[2], {}).ok, true);
  // ohne: auch verwandte Wörter ('Pilze' → Champignons) und Allergen-Namen im Freitext
  assert.deepEqual(passtZumProfil(HAUPT[6], { ohne: ['Pilze'] }), { ok: false, grund: 'Enthält pilz' });
  assert.equal(passtZumProfil(HAUPT[6], { ohne: 'Koriander' }).ok, true);
  assert.equal(passtZumProfil(HAUPT[0], { ohne: ['zwiebeln'] }).ok, false);
  assert.equal(passtZumProfil(HAUPT[0], { ohne: ['gluten'] }).ok, false);
  // Allergene
  assert.deepEqual(passtZumProfil(HAUPT[0], { allergene: ['gluten'] }), { ok: false, grund: 'Enthält Gluten' });
  const reisnudeln = rezept('x1', 'Reisnudeln', ['200 g Reisnudeln', '400 ml Kokosmilch', '1 Prise Muskatnuss']);
  assert.equal(passtZumProfil(reisnudeln, { allergene: ['gluten', 'laktose', 'nuesse'] }).ok, true);
  assert.equal(passtZumProfil(HAUPT[5], { allergene: ['laktose'] }).ok, false);
  const vegan = rezept('x2', 'Vegane Pasta', ['200 g Nudeln', '100 g veganer Käse', '2 EL pflanzliche Butter']);
  assert.equal(passtZumProfil(vegan, { allergene: ['laktose'], protein: ['vegan'] }).ok, true);
  assert.equal(passtZumProfil(HAUPT[8], { allergene: ['ei'] }).ok, false);
  assert.equal(passtZumProfil(HAUPT[6], { allergene: ['ei'] }).ok, true); // 'Reis' ist kein 'Ei'
  assert.equal(passtZumProfil(HAUPT[3], { allergene: ['fisch'] }).ok, false);
  assert.equal(passtZumProfil(HAUPT[7], { allergene: ['soja'] }).ok, false);
  // Kochzeit: Hauptgericht ≤ 25 bzw. 45 Min., Frühstück ≤ 15 bzw. 25 Min.
  assert.deepEqual(passtZumProfil(HAUPT[12], { kochzeit: 'normal' }), { ok: false, grund: 'Dauert 1 Std.' });
  assert.equal(passtZumProfil(HAUPT[12], { kochzeit: 'egal' }).ok, true);
  assert.equal(passtZumProfil(HAUPT[0], { kochzeit: 'schnell' }).ok, false);
  assert.equal(passtZumProfil(FRUEH[0], { kochzeit: 'schnell' }).ok, true);
  assert.equal(passtZumProfil({ ...FRUEH[0], totalMin: 20 }, { kochzeit: 'schnell' }).ok, false);
});

test('plane: Plätze je Tag in fester Reihenfolge, Zeitraum, Einträge', () => {
  const p = plan({ tage: 3, mahlzeiten: ['abend', 'frueh'], personen: 3 });
  assert.equal(p.start, HEUTE);
  assert.equal(p.ende, '2026-10-21');
  assert.deepEqual([p.tage, p.personen, p.laeden, p.seed], [3, 3, ['lidl'], 1]);
  assert.deepEqual(p.eintraege.map((e) => `${e.datum} ${e.slot}`), ['2026-10-19 frueh', '2026-10-19 abend',
    '2026-10-20 frueh', '2026-10-20 abend', '2026-10-21 frueh', '2026-10-21 abend']);
  for (const e of p.eintraege) {
    const r = nachId.get(e.rezeptId);
    assert.equal(r.mahlzeit, e.slot === 'frueh' ? 'frueh' : 'haupt');
    assert.deepEqual(Object.keys(e), ['datum', 'slot', 'rezeptId', 'titel', 'portionen', 'minuten', 'kosten']);
    assert.equal(e.titel, r.title);
    assert.equal(e.portionen, 3);
    assert.equal(e.minuten, r.totalMin);
    assert.ok(e.kosten >= 0);
  }
  assert.deepEqual([p.budget, p.imBudget, p.ueberBudget, p.fehlend, p.hinweise], [null, null, 0, [], []]);
  assert.equal(p.kosten.geschaetzt, true);
  // Start aus dem Profil; ungültiges heute → heutiger Tag
  assert.equal(plan({ tage: 1, start: '2026-12-31' }).ende, '2026-12-31');
  assert.equal(plan({ tage: 2, start: '2026-12-31' }).ende, '2027-01-01');
  // JSON-tauglich (wird in sessionStorage gemerkt)
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
});

test('plane: gleicher Startwert → gleicher Plan, anderer Startwert → anderer Plan', () => {
  const profil = { tage: 5, mahlzeiten: ['mittag', 'abend'], laeden: ['lidl', 'rewe'] };
  assert.deepEqual(plan(profil, { seed: 7 }), plan(profil, { seed: 7 }));
  const varianten = new Set([1, 2, 3, 4, 5, 6].map((seed) => ids(plan(profil, { seed })).join()));
  assert.ok(varianten.size >= 3, `nur ${varianten.size} verschiedene Pläne`);
});

test('plane: keine doppelten Hauptgerichte, solange genug Rezepte da sind; sonst Hinweis', () => {
  for (const seed of [1, 2, 3]) {
    const p = plan({ tage: 6, mahlzeiten: ['mittag', 'abend'], kochzeit: 'egal' }, { seed });
    assert.equal(p.eintraege.length, 12);
    assert.equal(new Set(ids(p)).size, 12);
    assert.deepEqual(p.hinweise, []);
  }
  // nur zwei Fischgerichte für vier Abende: wiederholen, aber nicht direkt hintereinander
  const f = plan({ tage: 4, protein: ['fisch'] });
  assert.equal(f.eintraege.length, 4);
  assert.ok(ids(f).every((id) => ['h04', 'h11'].includes(id)));
  assert.ok(ids(f).every((id, i, a) => i === 0 || id !== a[i - 1]));
  assert.deepEqual(f.hinweise, ['Nur 2 passende Hauptgerichte für 4 Mahlzeiten – einige kommen doppelt vor.']);
});

test('plane: Frühstück wiederholt sich frühestens nach zwei Tagen', () => {
  const p = plan({ tage: 6, mahlzeiten: ['frueh'] });
  const tage = new Map();
  p.eintraege.forEach((e, i) => {
    assert.ok(FRUEH.some((r) => r.id === e.rezeptId));
    if (tage.has(e.rezeptId)) assert.ok(i - tage.get(e.rezeptId) >= 2, `${e.rezeptId} an Tag ${i}`);
    tage.set(e.rezeptId, i);
  });
});

test('plane: Profil filtert (Proteine, Allergene, Kochzeit, eigene Rezepte)', () => {
  const veg = plan({ tage: 6, protein: ['vegetarisch'] });
  assert.ok(ids(veg).every((id) => ['vegetarisch', 'vegan'].includes(nachId.get(id).protein[0])));
  const vegan = plan({ tage: 4, protein: ['vegan'], allergene: ['soja'] });
  assert.ok(ids(vegan).every((id) => nachId.get(id).protein[0] === 'vegan' && id !== 'h08'));
  const lang = plan({ tage: 6, mahlzeiten: ['mittag', 'abend'], kochzeit: 'egal' });
  assert.ok(ids(lang).includes('h13') || ids(lang).length === 12);
  assert.ok(!ids(plan({ tage: 6, mahlzeiten: ['mittag', 'abend'] })).includes('h13'));
  // eigene Rezepte (ohne herkunft) nur mit eigeneRezepte; gelöschte nie
  const eigen = { ...rezept('e1', 'Omas Linsen', ['200 g Reis', '2 Zwiebeln']), herkunft: undefined, mahlzeit: undefined,
    protein: undefined };
  const geloescht = { ...rezept('e2', 'Weg', ['200 g Reis', '1 Zwiebel']), deleted: true };
  const mit = plane({ rezepte: [eigen, geloescht], profil: { tage: 2 }, heute: HEUTE, tabelle: TABELLE });
  assert.deepEqual(ids(mit), ['e1', 'e1']);
  const ohne = plane({ rezepte: [eigen], profil: { tage: 2, eigeneRezepte: false }, heute: HEUTE, tabelle: TABELLE });
  assert.equal(ohne.eintraege.length, 0);
  assert.equal(ohne.fehlend.length, 2);
  // gleiche id doppelt (Grundrezept + gespeicherte Kopie) zählt einmal
  const doppelt = plane({ rezepte: [HAUPT[0], { ...HAUPT[0], favorite: true }, HAUPT[5]], profil: { tage: 2 },
    heute: HEUTE, tabelle: TABELLE });
  assert.deepEqual(ids(doppelt).sort(), ['h01', 'h06']);
});

test('plane: fehlend mit Grund, wenn kein Rezept passt', () => {
  const p = plane({ rezepte: HAUPT, profil: { tage: 2, mahlzeiten: ['frueh', 'abend'], protein: ['vegetarisch'],
    kochzeit: 'schnell' }, heute: HEUTE, tabelle: TABELLE });
  const f = 'Keine schnellen vegetarischen Frühstücke';
  const h = 'Keine schnellen vegetarischen Hauptgerichte';
  assert.deepEqual(p.fehlend, [{ datum: '2026-10-19', slot: 'frueh', grund: f }, { datum: '2026-10-19', slot: 'abend', grund: h },
    { datum: '2026-10-20', slot: 'frueh', grund: f }, { datum: '2026-10-20', slot: 'abend', grund: h }]);
  assert.equal(p.eintraege.length, 0);
  assert.equal(p.kosten.gesamt, 0);
  const allergie = plan({ tage: 1, mahlzeiten: ['frueh'], allergene: ['laktose', 'gluten', 'ei'] });
  assert.equal(allergie.fehlend[0].grund, 'Keine passenden Frühstücke ohne Laktose, Gluten, Ei');
  const fisch = plan({ tage: 1, protein: ['fisch'], kochzeit: 'schnell' });
  assert.equal(fisch.fehlend[0].grund, 'Keine schnellen Hauptgerichte mit Fisch');
  assert.equal(plan({ tage: 1, protein: ['vegan'], mahlzeiten: ['frueh'], ohne: ['banane'] }).fehlend[0].grund,
    'Keine veganen Frühstücke ohne banane');
});

test('plane: Kosten = Summe der Grenzkosten = kostenDesPlans, je Laden aufgeteilt', () => {
  const p = plan({ tage: 5, mahlzeiten: ['frueh', 'abend'], personen: 4, laeden: ['rewe', 'lidl'] });
  const summe = p.eintraege.reduce((s, e) => s + e.kosten, 0);
  assert.ok(Math.abs(summe - p.kosten.gesamt) < 0.06, `${summe} ≠ ${p.kosten.gesamt}`);
  const k = kostenDesPlans(p.eintraege, nachId, p.profil, { tabelle: TABELLE });
  assert.equal(k.gesamt, p.kosten.gesamt);
  assert.deepEqual(k.proLaden, p.kosten.proLaden);
  assert.deepEqual(Object.keys(p.kosten.proLaden), ['rewe', 'lidl']);
  assert.equal(p.kosten.proLaden.rewe, 0); // Lidl ist laut Tabelle günstiger
  assert.equal(p.kosten.proLaden.lidl, p.kosten.gesamt);
  // eigener Preis bei Rewe verschiebt diese Zutat zu Rewe
  const eigenePreise = { reis: { rewe: { preis: 0.2, menge: 1, einheit: 'kg' } } };
  const r = plan({ tage: 5, mahlzeiten: ['frueh', 'abend'], personen: 4, laeden: ['rewe', 'lidl'] }, { eigenePreise });
  if (r.eintraege.some((e) => nachId.get(e.rezeptId).ingredients.some((z) => z.name === 'Reis'))) {
    assert.ok(r.kosten.proLaden.rewe > 0);
  }
  // kostenDesPlans versteht auch planEntries (recipeId/servings) und zeigt die Zeilen
  const zeilen = kostenDesPlans([{ recipeId: 'h01', servings: 4 }], [...ALLE], {}, { tabelle: TABELLE }).zeilen;
  assert.deepEqual(zeilen.map((z) => [z.key, z.betrag, z.quelle]), [['nudel', 1, 'tabelle'],
    ['tomate, gehackt', 1, 'tabelle'], ['zwiebel', 1, 'tabelle'], ['salz', 0, 'vorrat']]);
});

test('plane: gemeinsame Zutaten senken die Grenzkosten (Packungen werden aufgebraucht)', () => {
  const a = rezept('a', 'Reis mit Paprika', ['150 g Reis', '1 Paprika']);
  const b = rezept('b', 'Reis mit Zwiebeln', ['150 g Reis', '1 Zwiebel']);
  const c = rezept('c', 'Couscous mit Paprika', ['600 g Couscous', '1 Paprika']);
  const opts = { tabelle: TABELLE };
  const einzeln = kostenDesPlans([{ rezeptId: 'a', portionen: 2 }], [a], {}, opts).gesamt +
    kostenDesPlans([{ rezeptId: 'b', portionen: 2 }], [b], {}, opts).gesamt;
  const zusammen = kostenDesPlans([{ rezeptId: 'a', portionen: 2 }, { rezeptId: 'b', portionen: 2 }], [a, b], {}, opts).gesamt;
  assert.deepEqual([einzeln, zusammen], [6, 4]);
  for (const seed of [1, 2, 3, 4, 5]) {
    const p = plane({ rezepte: [c, a, b], profil: { tage: 2 }, seed, heute: HEUTE, tabelle: TABELLE });
    assert.deepEqual(ids(p).sort(), ['a', 'b'], `seed ${seed}`);
    assert.deepEqual(p.eintraege.map((e) => e.kosten), [3, 1]);
    assert.equal(p.kosten.gesamt, 4);
  }
});

test('plane: Vorrat und eigene Preise kosten weniger', () => {
  const profil = { tage: 4, protein: ['vegan'] };
  const normal = plan(profil);
  const vorrat = plan(profil, { vorrat: ['reis', 'zwiebel', 'nudel'] });
  assert.ok(vorrat.kosten.gesamt < normal.kosten.gesamt);
  const k = kostenDesPlans(vorrat.eintraege, nachId, vorrat.profil, { tabelle: TABELLE, vorrat: ['zwiebel'] });
  for (const z of k.zeilen.filter((x) => x.key === 'zwiebel' || x.key === 'salz')) assert.deepEqual([z.betrag, z.quelle], [0, 'vorrat']);
  const billig = plan(profil, { eigenePreise: { reis: { alle: { preis: 0.01, menge: 1000, einheit: 'g' } } } });
  assert.ok(billig.kosten.gesamt <= normal.kosten.gesamt);
});

test('plane: Budget – günstiger tauschen, sonst Hinweis auf den günstigsten gefundenen Plan', () => {
  const profil = { tage: 6, mahlzeiten: ['mittag', 'abend'], kochzeit: 'egal', personen: 4 };
  const frei = plan(profil);
  const grosszuegig = plan({ ...profil, budget: frei.kosten.gesamt + 5 });
  assert.deepEqual(ids(grosszuegig), ids(frei));
  assert.deepEqual([grosszuegig.imBudget, grosszuegig.ueberBudget, grosszuegig.hinweise], [true, 0, []]);
  const unmoeglich = plan({ ...profil, budget: 5 });
  assert.equal(unmoeglich.imBudget, false);
  assert.ok(unmoeglich.kosten.gesamt <= frei.kosten.gesamt);
  assert.equal(unmoeglich.ueberBudget, Math.round((unmoeglich.kosten.gesamt - 5) * 100) / 100);
  assert.deepEqual(unmoeglich.hinweise, ['Das Budget von 5 € reicht mit diesen Vorlieben nicht: Der günstigste ' +
    `gefundene Plan kostet ${formatEuroGerundet(unmoeglich.kosten.gesamt)}.`]);
  assert.match(unmoeglich.hinweise[0], /kostet ≈ \d+ €\.$/);
  assert.equal(new Set(ids(unmoeglich)).size, 12); // weiter ohne doppelte Gerichte
  // Abwechslung macht den Fisch zum zweiten Gericht; mit knappem Budget wird er gegen Nudeln getauscht
  const v1 = rezept('v1', 'Nudeln mit Zwiebeln', ['250 g Nudeln', '1 Zwiebel'], { protein: ['vegan'], tags: ['pasta'] });
  const v2 = rezept('v2', 'Nudeln mit Tomaten', ['250 g Nudeln', '1 Dose gehackte Tomaten'],
    { protein: ['vegan'], tags: ['pasta'] });
  const f1 = rezept('f1', 'Fischstäbchen mit Zwiebeln', ['5 Fischstäbchen', '1 Zwiebel'], { protein: ['fisch'] });
  const tabelle = { preise: [...TABELLE.preise, ['fischstäbchen', 2.0, 10, 'Stück']] };
  for (const seed of [1, 2, 3, 4]) {
    const args = { rezepte: [v1, v2, f1], heute: HEUTE, tabelle, seed };
    const ohne = plane({ ...args, profil: { tage: 2 } });
    assert.ok(ids(ohne).includes('f1'), `seed ${seed}`);
    const knapp = plane({ ...args, profil: { tage: 2, budget: 3 } });
    assert.deepEqual(ids(knapp).sort(), ['v1', 'v2']);
    assert.deepEqual([knapp.kosten.gesamt, knapp.imBudget, knapp.ueberBudget, knapp.hinweise], [2.5, true, 0, []]);
    assert.ok(knapp.kosten.gesamt < ohne.kosten.gesamt);
  }
});

test('tausche: anderes Gericht, nicht schon im Plan, Kosten neu berechnet, kein Hin und Her', () => {
  const kontext = { rezepte: ALLE, tabelle: TABELLE };
  const p = plan({ tage: 5, laeden: ['lidl', 'rewe'] }, { seed: 3 });
  const t1 = tausche(p, 2, kontext);
  assert.notEqual(t1.eintraege[2].rezeptId, p.eintraege[2].rezeptId);
  assert.ok(!ids(p).includes(t1.eintraege[2].rezeptId));
  assert.deepEqual(ids(t1).filter((_, i) => i !== 2), ids(p).filter((_, i) => i !== 2));
  assert.deepEqual(t1.eintraege.map((e) => e.datum), p.eintraege.map((e) => e.datum));
  assert.equal(t1.kosten.gesamt, kostenDesPlans(t1.eintraege, nachId, t1.profil, { tabelle: TABELLE }).gesamt);
  assert.equal(t1.seed, 3);
  assert.deepEqual(t1.getauscht, [p.eintraege[2].rezeptId]);
  // mehrmals tauschen zeigt jedes Mal ein neues Gericht (auch nach JSON wie aus sessionStorage)
  const t2 = tausche(JSON.parse(JSON.stringify(t1)), 2, kontext);
  const t3 = tausche(t2, 2, kontext);
  const gezeigt = [p, t1, t2, t3].map((x) => x.eintraege[2].rezeptId);
  assert.equal(new Set(gezeigt).size, 4, gezeigt.join());
  assert.equal(tausche(p, 2, kontext).eintraege[2].rezeptId, t1.eintraege[2].rezeptId); // bestimmt
  // ungültiger Index → unverändert
  assert.equal(tausche(p, 99, kontext), p);
  assert.equal(tausche(null, 0, kontext), null);
});

test('tausche: Budget-Status wird neu bewertet; ohne Alternative bleibt der Plan', () => {
  const kontext = { rezepte: ALLE, tabelle: TABELLE };
  const p = plan({ tage: 1, protein: ['fisch'] });
  const t = tausche(p, 0, kontext);
  assert.notEqual(t.eintraege[0].rezeptId, p.eintraege[0].rezeptId);
  // beide Fischgerichte gezeigt → wieder von vorn
  const zurueck = tausche(t, 0, kontext);
  assert.equal(zurueck.eintraege[0].rezeptId, p.eintraege[0].rezeptId);
  const einzig = plane({ rezepte: [HAUPT[3]], profil: { tage: 1 }, heute: HEUTE, tabelle: TABELLE });
  assert.equal(tausche(einzig, 0, { rezepte: [HAUPT[3]], tabelle: TABELLE }), einzig);
  const mitBudget = plan({ tage: 3, budget: 1 });
  const tb = tausche(mitBudget, 1, kontext);
  assert.equal(tb.imBudget, false);
  assert.equal(tb.ueberBudget, Math.round((tb.kosten.gesamt - 1) * 100) / 100);
  // Frühstück: Pause von zwei Tagen gilt auch beim Tauschen
  const f = plan({ tage: 3, mahlzeiten: ['frueh'] });
  const tf = tausche(f, 1, kontext);
  assert.notEqual(tf.eintraege[1].rezeptId, tf.eintraege[0].rezeptId);
  assert.notEqual(tf.eintraege[1].rezeptId, tf.eintraege[2].rezeptId);
});

test('plane: 14 Tage × 3 Mahlzeiten über 150 Rezepte ist schnell', () => {
  // erfundene Rezepte aus einem Zutaten-Vorrat (fester Pseudo-Zufall)
  const zutaten = ['250 g Nudeln', '200 g Reis', '600 g Kartoffeln', '1 Zwiebel', '2 Paprika', '1 Brokkoli',
    '400 g Champignons', '1 Dose gehackte Tomaten', '1 Dose Kokosmilch', '200 g Tofu', '300 g Hähnchenbrustfilet',
    '250 g Hackfleisch', '250 g Lachsfilet', '100 ml Sahne', '100 g Käse', '2 Eier', '200 ml Milch', '1 EL Öl', 'Salz',
    '1 Bund Petersilie', '2 Zehen Knoblauch', '1 TL Paprikapulver', '150 g Couscous', '1 Zucchini', '2 Möhren'];
  let x = 42;
  const zufall = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const viele = Array.from({ length: 150 }, (_, i) => rezept(`p${i}`, `Gericht ${i}`,
    Array.from({ length: 5 + Math.floor(zufall() * 6) }, () => zutaten[Math.floor(zufall() * zutaten.length)]),
    { mahlzeit: i % 6 === 0 ? 'frueh' : 'haupt', protein: undefined, totalMin: i % 6 === 0 ? 10 : 20 + (i % 4) * 5 }));
  const profil = { tage: 14, mahlzeiten: ['frueh', 'mittag', 'abend'], personen: 4, laeden: ['lidl', 'rewe', 'penny'] };
  plane({ rezepte: viele, profil, heute: HEUTE, tabelle: TABELLE }); // Aufwärmen
  for (const budget of [null, 50]) {
    const t = performance.now();
    const p = plane({ rezepte: viele, profil: { ...profil, budget }, heute: HEUTE, tabelle: TABELLE, seed: 5 });
    const ms = performance.now() - t;
    assert.equal(p.eintraege.length + p.fehlend.length, 42);
    assert.ok(ms < 1500, `${Math.round(ms)} ms`);
  }
});

// ---------------------------------------------------------------- Prüfbefunde (Lieber nicht, Erkennung, Vielfalt)

test('erkenneProtein: weitere Fleisch-, Wurst- und Fischwörter, Fleisch unbekannter Art zählt als jedes Fleisch', () => {
  const p = (...zeilen) => erkenneProtein({ zutaten: zeilen });
  const faelle = {
    schwein: ['4 Nackensteaks', '1 kg Rippchen', '6 Krakauer', '4 Frankfurter', '200 g Serrano', '4 Cordon bleu',
      '4 Schaschlikspieße', '200 g Bauchfleisch'],
    rind: ['150 g Pastrami', '8 Merguez', '500 g Wildgulasch', '4 Steaks', '500 g Gulasch'],
    fisch: ['400 g Seehecht', '400 g Tilapiafilet', '400 g Viktoriabarschfilet', '400 g Wels', '4 Sprotten', '1 Aal',
      '200 g Bückling', '200 g Hummer', '1 TL Dashi', '2 EL Austernsauce', '200 g Kalmare'],
    vegetarisch: ['2 EL Ghee', '200 g Paneer', '200 g Tsatsiki', '2 EL Butterreinfett', '500 g Käse-Tortellini',
      '2 Pck. Mie-Nudeln', '200 g Löffelbiskuits', '2 Halloumi-Steaks', '50 g Grana Padano'],
    vegan: ['200 g Sojageschnetzeltes', '4 Tofu-Würstchen', '2 vegane Bratwürste', '1 Blumenkohlsteak',
      '500 g Austernpilze', '500 ml Gemüsefond', '200 g Wildreis', '1 Pck. Bratensoße', '2 Pilz-Gulasch'],
  };
  for (const [soll, zeilen] of Object.entries(faelle)) {
    for (const z of zeilen) assert.deepEqual(p(z), [soll], z);
  }
  for (const z of ['500 g Geschnetzeltes', '4 Minutensteaks', '400 g Leber', '500 ml Bratenfond', '400 g Döner']) {
    assert.deepEqual(p(z), ['rind', 'schwein', 'gefluegel'], z);
  }
  // Ersatz-Wort nur im anderen Teil: das Fleisch zählt trotzdem
  assert.deepEqual(p('500 g Hähnchenbrust in Sojasauce'), ['gefluegel']);
  assert.deepEqual(p('250 g Garnelen in Tofu-Marinade'), ['fisch']);
  assert.deepEqual(p('300 g Rindfleisch mit Seitan'), ['rind']);
  assert.deepEqual(p('200 g Tofu mit Speck'), ['schwein']);
});

test('rezeptMeta: angegebenes Protein gilt nie weniger streng als die Zutaten (bearbeitete Kopien)', () => {
  const mit = (r, zeile) => ({ ...r, ingredients: [...r.ingredients, ...parseZeilen(zeile)] });
  const speck = mit(HAUPT[0], '150 g Speckwürfel'); // vegan angegeben
  assert.deepEqual(rezeptMeta(speck).protein, ['schwein']);
  assert.equal(passtZumProfil(speck, { protein: ['vegan'] }).ok, false);
  assert.equal(passtZumProfil(speck, { protein: ['vegetarisch'] }).ok, false);
  assert.deepEqual(rezeptMeta(mit(HAUPT[5], '100 g Speckwürfel')).protein, ['schwein']); // vegetarisch angegeben
  assert.deepEqual(rezeptMeta(mit(HAUPT[0], '50 g Butter')).protein, ['vegetarisch']);
  assert.deepEqual(rezeptMeta(mit(HAUPT[1], '100 g Speck')).protein, ['gefluegel', 'schwein']);
  // vorsichtig angegeben bleibt: vegetarisch bleibt vegetarisch, auch wenn nichts Tierisches erkannt wird
  assert.deepEqual(rezeptMeta({ ...HAUPT[0], protein: ['vegetarisch'] }).protein, ['vegetarisch']);
  assert.deepEqual(rezeptMeta(HAUPT[2]).protein, ['rind', 'schwein']);
});

test('rezeptMeta: Teige, Brot zum Backen, Butter, Saucen, Dips, Desserts und Getränke sind keine Mahlzeit', () => {
  const eigen = (title, zeilen, extra = {}) => ({ id: 'e', title, servings: 4, ingredients: parseZeilen(zeilen.join('\n')),
    ...extra });
  const keine = [
    eigen('Dinkelbrot', ['500 g Dinkelmehl', '1 Würfel Hefe', '350 ml Wasser']),
    eigen('Kräuterbutter', ['250 g Butter', '1 Bund Petersilie']),
    eigen('Pizzateig (Grundrezept)', ['500 g Mehl', '1 Würfel Hefe']),
    eigen('Pflaumenkuchen vom Blech', ['500 g Mehl', '80 g Zucker', '1,5 kg Pflaumen']),
    eigen('Tiramisu', ['500 g Mascarpone', '200 g Löffelbiskuits']),
    eigen('Guacamole', ['3 Avocados', '1 Limette']),
    eigen('Vinaigrette', ['4 EL Olivenöl', '2 EL Essig']),
    eigen('Eistee mit Pfirsich', ['1 l Wasser', '2 Pfirsiche']),
    eigen('Apfelmus selbst gemacht', ['1 kg Äpfel', '50 g Zucker']),
    eigen('Tomatensauce', ['2 Dosen Tomaten', '1 Zwiebel']),
    eigen('Erdbeereis', ['500 g Erdbeeren', '200 ml Sahne']),
    eigen('Pizzaboden – Basisrezept', ['400 g Mehl']),
  ];
  for (const r of keine) assert.equal(rezeptMeta(r).mahlzeit, null, r.title);
  const gerichte = [
    eigen('Zwiebelkuchen', ['1 kg Zwiebeln', '200 g Mehl', '1 Würfel Hefe', '200 g Speck']),
    eigen('Eierpfannkuchen mit Apfelmus', ['250 g Mehl', '3 Eier', '500 ml Milch']),
    eigen('Milchreis mit Kirschen', ['250 g Milchreis', '1 l Milch']),
    eigen('Avocado-Brot', ['4 Scheiben Brot', '2 Avocados']),
    eigen('Butter-Hähnchen mit Reis', ['600 g Hähnchenbrust', '50 g Butter', '250 g Reis']),
    eigen('Gemüseplatte', ['1 Brokkoli', '4 Möhren']),
    eigen('Brotsalat', ['1 Baguette', '4 Tomaten']),
  ];
  for (const r of gerichte) assert.equal(rezeptMeta(r).mahlzeit, 'haupt', r.title);
});

test('plane: eigene Rezepte, die fast nichts kosten, sind Zutaten statt Mahlzeit', () => {
  const eigen = (id, title, zeilen, servings) => ({ ...rezept(id, title, zeilen), servings, herkunft: undefined,
    mahlzeit: undefined, protein: undefined });
  const oel = eigen('e1', 'Zwiebelöl', ['250 ml Öl', '1 Zwiebel'], 8); // 1 € für 8 Portionen
  const reis = eigen('e2', 'Zwiebelreis', ['200 g Reis', '2 Zwiebeln'], 2);
  const p = plane({ rezepte: [oel, reis], profil: { tage: 2 }, heute: HEUTE, tabelle: TABELLE });
  assert.deepEqual(ids(p), ['e2', 'e2']);
  // mit Mahlzeit-Angabe (Grund- oder bearbeitetes Rezept) entscheidet die Angabe
  const angegeben = plane({ rezepte: [{ ...oel, mahlzeit: 'haupt' }], profil: { tage: 1 }, heute: HEUTE, tabelle: TABELLE });
  assert.deepEqual(ids(angegeben), ['e1']);
});

test('passtZumProfil: „Lieber nicht“ mit Tierart, Gruppe oder Allergen-Wort wirkt wie die Auswahl', () => {
  const r = (zeilen) => rezept('x', 'X', zeilen);
  const ohne = (zeilen, wort) => passtZumProfil(r(zeilen), { ohne: wort }).ok;
  // Schwein: auch Speck, Schinken, Wurst, Kassler und gemischtes Hack
  for (const z of ['100 g Speckwürfel', '4 Scheiben Kochschinken', '4 Bratwürste', '400 g Kassler', '2 Wiener Würstchen',
    '500 g gemischtes Hackfleisch', '1 Pck. Gelatine']) {
    assert.equal(ohne([z, '200 g Reis'], 'Schwein'), false, z);
    assert.equal(ohne([z, '200 g Reis'], 'Schweinefleisch'), false, z);
    assert.equal(ohne([z, '200 g Reis'], 'Fleisch'), false, z);
  }
  assert.equal(ohne(['400 g Hähnchenbrustfilet'], 'Schwein'), true);
  // Rind trifft gemischtes Hack, Geflügel/Hähnchen alles Geflügel, Fleisch aber keinen Fisch
  assert.equal(ohne(['500 g Hackfleisch'], 'Rind'), false);
  assert.equal(ohne(['500 g Rinderhackfleisch'], 'Rindfleisch'), false);
  for (const w of ['Geflügel', 'Hähnchen', 'Huhn']) {
    assert.equal(ohne(['400 g Putenbrust'], w), false, w);
    assert.equal(ohne(['1 l Hühnerbrühe'], w), false, w);
  }
  assert.equal(ohne(['200 g Lachsfilet'], 'Fleisch'), true);
  assert.equal(ohne(['200 g Fleischtomaten'], 'Fleisch'), true);
  assert.equal(ohne(['200 g Lachsfilet'], 'Fisch'), false);
  // Gruppen: Milch wie Laktose (Kokosmilch bleibt), Weizen ohne Hafer, Nüsse samt Mandeln
  assert.equal(ohne(['200 ml Sahne'], 'Milch'), false);
  assert.equal(ohne(['100 g Butter'], 'Milchprodukte'), false);
  assert.equal(ohne(['400 ml Kokosmilch'], 'Milch'), true);
  assert.equal(ohne(['250 g Spaghetti'], 'Weizen'), false);
  assert.equal(ohne(['2 EL Sojasauce'], 'Weizen'), false);
  assert.equal(ohne(['100 g Haferflocken'], 'Weizen'), true);
  assert.equal(ohne(['50 g gemahlene Mandeln'], 'Nüsse'), false);
  assert.equal(ohne(['2 Eier'], 'Eier'), false);
  // Wortteile ohne Fehltreffer: 'Wein' ist nicht 'Schwein', 'Lamm' nicht 'Flammkuchen', Leberkäse kein Käse
  assert.equal(ohne(['400 g Schweinefilet'], 'Wein'), true);
  assert.equal(ohne(['100 ml Weißwein'], 'Wein'), false);
  assert.equal(ohne(['1 Rolle Flammkuchenteig'], 'Lamm'), true);
  assert.equal(ohne(['500 g Lammkeule'], 'Lamm'), false);
  assert.equal(ohne(['125 g Mozzarella'], 'Käse'), false);
  assert.equal(ohne(['4 Scheiben Leberkäse'], 'Käse'), true);
  assert.equal(ohne(['2 Salamis'], 'Wurst'), false);
  assert.equal(passtZumProfil(r(['100 g Speck']), { ohne: 'Schwein' }).grund, 'Enthält schwein');
  // Erklärung für die Anzeige
  assert.equal(ohneBedeutung('Schwein'), 'alle Gerichte mit Schweinefleisch, auch Speck, Schinken und Wurst');
  assert.equal(ohneBedeutung('Fleisch'), 'alle Gerichte mit Fleisch (Fisch bleibt erlaubt)');
  assert.equal(ohneBedeutung('Hähnchen'), 'alle Gerichte mit Geflügel (Hähnchen, Pute, Ente …)');
  assert.equal(ohneBedeutung('Fisch'), 'alle Gerichte mit Fisch und Meeresfrüchten');
  assert.match(ohneBedeutung('Milch'), /^wie „Laktose“: milch, sahne, butter/);
  assert.match(ohneBedeutung('Pilze'), /^Zutaten mit pilz, champignon/);
  assert.equal(ohneBedeutung('Koriander'), 'Zutaten mit „koriander“ im Namen');
  assert.equal(ohneBedeutung(' '), '');
});

test('plane: „Lieber nicht: Schwein, Geflügel“ als Freitext lässt keine solchen Gerichte im Plan (Grundsammlung)', () => {
  const grund = ladeGrundrezepte();
  const nach = new Map(grund.map((r) => [r.id, r]));
  for (const seed of [1, 2, 3]) {
    const p = plane({ rezepte: grund, profil: { ohne: 'Schwein, Geflügel', tage: 14, mahlzeiten: ['frueh', 'abend'] },
      seed, heute: HEUTE });
    assert.equal(p.eintraege.length, 28);
    for (const e of p.eintraege) {
      const r = nach.get(e.rezeptId);
      assert.ok(!r.protein.includes('schwein') && !r.protein.includes('gefluegel'), `${seed}: ${e.titel}`);
    }
  }
});

test('Allergene: jede Auswahl schließt die Grundrezepte mit passenden Zutaten aus (unabhängige Stichwörter)', () => {
  // zweite, unabhängige Liste typischer Produkte; auch Paniertes und Teigwaren mit Ei
  const MERKMALE = {
    gluten: new RegExp(['mehl', 'nudel', 'spaghetti', 'penne', 'lasagne', 'tortellini', 'gnocchi', 'spätzle', 'brot',
      'brötchen', 'toast', 'baguette', 'wrap', 'tortilla', 'couscous', 'bulgur', 'grieß', 'paniermehl', 'teig', 'knödel',
      'fischstäbchen', 'röstzwiebel', 'sojaso', 'haferflocken', 'müsli'].join('|')),
    ei: /(?:^|[\s-])eier?(?:$|[\s,])|eigelb|mayonnaise|spätzle|tortellini|mie-nudel|eiernudel/,
    laktose: /milch(?!reis)|sahne|butter|käse|joghurt|quark|schmand|mozzarella|parmesan|feta|crème fraîche|creme fraiche/,
    fisch: /fisch|lachs|forelle|kabeljau|garnele|matjes|hering|thunfisch|sardelle|krabbe/,
    nuesse: /nuss|nüsse|mandel|cashew|pinienkern|pistazie|walnuss|haselnuss/,
    soja: /soja|tofu|edamame/,
  };
  const ausser = new RegExp(['kokosmilch', 'hafermilch', 'sojamilch', 'mandelmilch', 'reismilch', 'muskatnuss', 'kokosnuss',
    'erdnussbutter', 'kakaobutter', 'reisnudel', 'glasnudel'].join('|'), 'g');
  const grund = ladeGrundrezepte();
  for (const [id, re] of Object.entries(MERKMALE)) {
    const durch = grund.filter((r) => passtZumProfil(r, { allergene: [id], kochzeit: 'egal' }).ok &&
      r.ingredients.some((z) => re.test(String(z.name).toLowerCase().replace(ausser, ' '))));
    assert.deepEqual(durch.map((r) => r.title), [], id);
  }
  const titel = (id) => grund.filter((r) => !passtZumProfil(r, { allergene: [id], kochzeit: 'egal' }).ok).map((r) => r.title);
  assert.ok(titel('gluten').includes('Fischstäbchen mit Kartoffelpüree und Erbsen'));
  assert.ok(titel('gluten').includes('Kartoffelsuppe mit Majoran'));
  assert.ok(titel('ei').includes('Tortellini in Tomaten-Sahne-Sauce'));
});

test('plane: Frühstück auch dann, wenn nur Fleischsorten gewählt sind; Hauptgerichte bleiben beim Fleisch', () => {
  const p = plan({ tage: 4, mahlzeiten: ['frueh', 'abend'], protein: ['rind', 'gefluegel'], kochzeit: 'egal' });
  assert.deepEqual(p.fehlend, []);
  for (const e of p.eintraege) {
    const pr = nachId.get(e.rezeptId).protein;
    if (e.slot === 'frueh') assert.ok(['vegetarisch', 'vegan'].includes(pr[0]), e.titel);
    else assert.ok(pr.some((x) => ['rind', 'gefluegel'].includes(x)), e.titel);
  }
  assert.equal(passtZumProfil(FRUEH[0], { protein: ['schwein'] }).ok, true);
  assert.equal(passtZumProfil(HAUPT[5], { protein: ['schwein'] }).ok, false);
  assert.equal(passtZumProfil(FRUEH[0], { protein: ['vegan'] }).ok, false); // vegan bleibt streng
});

test('plane: Nudeln höchstens dreimal in sieben Hauptgerichten, auch wenn die offene Packung sie billig macht', () => {
  const nudeln = ['Tomaten', 'Zwiebeln', 'Paprika', 'Brokkoli', 'Champignons', 'Sahne'].map((was, i) =>
    rezept(`n${i}`, `Nudeln mit ${was}`, ['125 g Nudeln', i % 2 ? '1 Zwiebel' : '1 Paprika'],
      { protein: ['vegan'], tags: ['pasta'] }));
  const andere = ['Reis mit Brokkoli', 'Kartoffeln mit Paprika', 'Couscous mit Zwiebeln', 'Reis mit Champignons',
    'Kartoffeln mit Brokkoli'].map((titel, i) => rezept(`a${i}`, titel,
    [['150 g Reis', '600 g Kartoffeln', '150 g Couscous'][i % 3], ['1 Brokkoli', '1 Paprika', '1 Zwiebel'][i % 3]],
    { protein: ['vegan'], tags: [['reis', 'kartoffeln', ''][i % 3]].filter(Boolean) }));
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const p = plane({ rezepte: [...nudeln, ...andere], profil: { tage: 7 }, seed, heute: HEUTE, tabelle: TABELLE });
    const pasta = p.eintraege.map((e) => e.rezeptId.startsWith('n'));
    assert.ok(pasta.filter(Boolean).length <= 3, `seed ${seed}: ${ids(p).join()}`);
    assert.ok(!pasta.some((x, i) => x && pasta[i + 1] && pasta[i + 2]), `seed ${seed}: dreimal in Folge`);
  }
});

test('plane: Grundsammlung – höchstens drei Nudelgerichte in sieben Abendessen (auch schnell und vegan)', () => {
  const grund = ladeGrundrezepte();
  const pasta = new Set(grund.filter((r) => r.tags.includes('pasta')).map((r) => r.id));
  for (const profil of [{}, { kochzeit: 'schnell' }, { protein: ['vegan'] }]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = plane({ rezepte: grund, profil: { ...profil, tage: 7 }, seed, heute: HEUTE });
      const n = p.eintraege.filter((e) => pasta.has(e.rezeptId)).length;
      assert.ok(n <= 3, `${JSON.stringify(profil)} seed ${seed}: ${n} Nudelgerichte`);
    }
  }
});

test('plane: beim Sparen höchstens zweimal dasselbe Frühstück in sieben Tagen', () => {
  const fruehs = [1, 2, 3, 4, 5].map((n) => rezept(`b${n}`, `Frühstück ${n}`,
    [`${40 * n} g Haferflocken`, n > 2 ? '1 Banane' : '100 ml Milch', `${n} Eier`],
    { mahlzeit: 'frueh', protein: ['vegetarisch'], totalMin: 10 }));
  const p = plane({ rezepte: fruehs, profil: { tage: 7, mahlzeiten: ['frueh'], budget: 1 }, heute: HEUTE, tabelle: TABELLE });
  assert.equal(p.imBudget, false);
  const anzahl = {};
  for (const id of ids(p)) anzahl[id] = (anzahl[id] || 0) + 1;
  assert.ok(Object.values(anzahl).every((n) => n <= 2), JSON.stringify(anzahl));
  assert.ok(p.eintraege.every((e, i, a) => i === 0 || e.rezeptId !== a[i - 1].rezeptId));
});

test('tausche: Budget-Hinweis von plane() fällt weg, „Nur … Hauptgerichte“ bleibt', () => {
  const kontext = { rezepte: ALLE, tabelle: TABELLE };
  const p = plan({ tage: 3, budget: 1 });
  assert.equal(p.hinweise.length, 1);
  assert.match(p.hinweise[0], /^Das Budget von 1 € reicht/);
  const t = tausche(p, 1, kontext);
  assert.equal(t.imBudget, false);
  assert.deepEqual(t.hinweise, []);
  // nur zwei Fischgerichte: der Hinweis darauf bleibt nach dem Tauschen eines Frühstücks
  const f = plan({ tage: 4, mahlzeiten: ['frueh', 'abend'], protein: ['fisch'], budget: 1 });
  assert.equal(f.hinweise.length, 2);
  const tf = tausche(f, 0, kontext);
  assert.notEqual(tf.eintraege[0].rezeptId, f.eintraege[0].rezeptId);
  assert.deepEqual(tf.hinweise, ['Nur 2 passende Hauptgerichte für 4 Mahlzeiten – einige kommen doppelt vor.']);
  // ohne Alternative bleibt der Plan, wie er war
  assert.equal(tausche(f, 1, kontext), f);
});

test('plane und kostenDesPlans: gleich teure Zutaten kommen in den Hauptladen (kein zweiter Laden ohne Ersparnis)', () => {
  const gleich = (preis) => Object.fromEntries(['aldi', 'lidl', 'penny', 'netto', 'kaufland', 'rewe', 'edeka']
    .map((id) => [id, preis]));
  // Nudeln und Tomaten kosten überall gleich, der Rest bei Rewe mehr (Faktor 1,5)
  const tabelle = { ...TABELLE, preise: [['nudel', 1.0, 500, 'g', { laeden: gleich(1.0) }],
    ['tomate, gehackt', 0.5, 400, 'g', { container: 'Dose', laeden: gleich(0.5) }], ...TABELLE.preise] };
  for (const laeden of [['rewe', 'aldi'], ['aldi', 'rewe']]) {
    const p = plane({ rezepte: [HAUPT[0], HAUPT[1]], profil: { tage: 2, laeden }, heute: HEUTE, tabelle });
    assert.equal(p.kosten.proLaden.rewe, 0, laeden.join());
    assert.equal(p.kosten.proLaden.aldi, p.kosten.gesamt);
    const k = kostenDesPlans(p.eintraege, nachId, p.profil, { tabelle });
    assert.deepEqual(k.proLaden, p.kosten.proLaden);
    assert.ok(k.zeilen.filter((z) => z.laden).every((z) => z.laden === 'aldi'));
    assert.ok(k.zeilen.every((z) => !('jeLaden' in z)));
  }
});
