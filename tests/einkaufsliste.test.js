import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZeile, parseZeilen, zutatSchluessel } from '../js/zutaten.js';
import {
  ABTEILUNGEN, sortierteAbteilungen, abteilungVon, kanonischerSchluessel, standardZeitraum,
  planEintraegeFuerRunde, berechneListe, abhakZustand, listeAlsText,
} from '../js/einkaufsliste.js';

// Abteilung direkt aus einem Zutatennamen (wie in der App: erst Schlüssel, dann Abteilung)
const ab = (name, aliase, einheiten) => abteilungVon(zutatSchluessel(parseZeile(name).name), aliase, einheiten);

test('ABTEILUNGEN: 22 Abteilungen in Standard-Reihenfolge, sonstiges zuletzt', () => {
  assert.equal(ABTEILUNGEN.length, 22);
  assert.deepEqual(ABTEILUNGEN.slice(0, 3), [
    { id: 'obst-gemuese', name: 'Obst & Gemüse' }, { id: 'brot', name: 'Brot & Backwaren' },
    { id: 'fleisch', name: 'Fleisch & Wurst' }]);
  assert.deepEqual(ABTEILUNGEN.map((a) => a.id), ['obst-gemuese', 'brot', 'fleisch', 'fisch', 'molkerei', 'kaese',
    'kuehl', 'tk', 'nudeln-reis', 'backen', 'gewuerze', 'oel-essig', 'saucen', 'konserven', 'nuesse', 'fruehstueck',
    'suesses', 'getraenke', 'alkohol', 'international', 'haushalt', 'sonstiges']);
  assert.equal(ABTEILUNGEN.find((a) => a.id === 'molkerei').name, 'Milch, Butter & Eier');
});

test('sortierteAbteilungen: eigene Reihenfolge, Unbekanntes ignoriert, Fehlendes hinten', () => {
  assert.deepEqual(sortierteAbteilungen(null), ABTEILUNGEN);
  assert.deepEqual(sortierteAbteilungen(undefined), ABTEILUNGEN);
  const s = sortierteAbteilungen(['tk', 'gibt-es-nicht', 'brot', 'tk']).map((a) => a.id);
  assert.deepEqual(s.slice(0, 4), ['tk', 'brot', 'obst-gemuese', 'fleisch']);
  assert.equal(s.length, 22);
  assert.equal(new Set(s).size, 22);
  assert.equal(s.at(-1), 'sonstiges');
});

test('abteilungVon: Pflichtfälle aus der Spezifikation', () => {
  const faelle = { '400 g Kirschtomaten': 'obst-gemuese', '2 EL Tomatenmark': 'saucen', '200 g Reis': 'nudeln-reis',
    '3 Eier': 'molkerei', '1 Ei': 'molkerei', '300 g TK-Erbsen': 'tk', '300 g Erbsen (TK)': 'tk',
    '500 ml passierte Tomaten': 'konserven', '2 Zwiebeln': 'obst-gemuese', '200 ml Sahne': 'molkerei' };
  for (const [zeile, erwartet] of Object.entries(faelle)) assert.equal(ab(zeile), erwartet, zeile);
});

test('abteilungVon: Komposita, Wortgrenzen und Doppeldeutigkeiten', () => {
  const faelle = {
    'Rinderhackfleisch': 'fleisch', 'Schlagsahne': 'molkerei', 'Kokosmilch': 'konserven', 'Mais': 'konserven',
    'Maismehl': 'backen', 'Maiskolben': 'obst-gemuese', 'Milchreis': 'nudeln-reis', 'Basmatireis': 'nudeln-reis',
    'Reisessig': 'oel-essig', 'Preiselbeeren': 'obst-gemuese', 'Salbei': 'obst-gemuese', 'Eis': 'tk',
    'Vanilleeis': 'tk', 'Koriander': 'obst-gemuese', 'gemahlener Koriander': 'gewuerze', 'Koriandersamen': 'gewuerze',
    'Lachsfilet': 'fisch', 'Wildlachsfilet': 'fisch', 'Hähnchenbrustfilet': 'fleisch', 'Schweinefleisch': 'fleisch',
    'Schweinebauch': 'fleisch', 'Weißwein': 'alkohol', 'Weißweinessig': 'oel-essig', 'Olivenöl': 'oel-essig',
    'Paprika': 'obst-gemuese', 'Paprikapulver': 'gewuerze', 'Paprika edelsüß': 'gewuerze',
    'Zwiebelpulver': 'gewuerze', 'Gemüsebrühe': 'saucen', 'Muskatnuss': 'gewuerze', 'Erdnussbutter': 'fruehstueck',
    'Butterkekse': 'suesses', 'Butterschmalz': 'molkerei', 'Zitronensaft': 'obst-gemuese',
    'Orangensaft': 'getraenke', 'Zuckerschoten': 'obst-gemuese', 'Kartoffelstärke': 'backen',
    'Leberkäse': 'fleisch', 'Frischkäse': 'kaese', 'Gewürzgurken': 'konserven', 'Thunfisch': 'konserven',
    'Kürbiskerne': 'nuesse', 'Hokkaido-Kürbis': 'obst-gemuese', 'Backpapier': 'haushalt',
    'Reispapier': 'international', 'Röstzwiebeln': 'konserven', 'Mandeldrink': 'molkerei',
    'Erdnuss Sauce': 'saucen', 'Kartoffeln, festkochend': 'obst-gemuese', 'Zwiebelchen': 'obst-gemuese',
  };
  for (const [name, erwartet] of Object.entries(faelle)) assert.equal(ab(name), erwartet, name);
});

test('abteilungVon: Zusätze getrocknet / gemahlen / Dose / in Öl', () => {
  assert.equal(ab('getrockneter Oregano'), 'gewuerze');
  assert.equal(ab('getrocknete Petersilie'), 'gewuerze');
  assert.equal(ab('getrocknete Aprikosen'), 'nuesse');
  assert.equal(ab('getrocknete Tomaten'), 'konserven');
  assert.equal(ab('getrocknete Tomaten in Öl'), 'konserven');
  assert.equal(ab('Thunfisch in Öl'), 'konserven');
  assert.equal(ab('gemahlene Mandeln'), 'backen');
  assert.equal(ab('Mandeln'), 'nuesse');
  assert.equal(ab('Tomaten aus der Dose'), 'konserven');
  assert.equal(ab('Dosentomaten'), 'konserven');
  assert.equal(ab('tiefgekühlte Himbeeren'), 'tk');
  assert.equal(ab('Mineralwasser mit Kohlensäure'), 'getraenke');
  // Einheiten-Hinweis: Gemüse aus Dose oder Glas steht bei den Konserven
  assert.equal(ab('Tomaten'), 'obst-gemuese');
  assert.equal(ab('Tomaten', {}, ['Dose']), 'konserven');
  assert.equal(ab('Tomaten', {}, ['Dose', 'Stück']), 'obst-gemuese');
  assert.equal(ab('Rote Bete', {}, ['Glas']), 'konserven');
  assert.equal(ab('Bier', {}, ['Dose']), 'alkohol');
});

test('abteilungVon: Unbekanntes → sonstiges, Korrekturen haben Vorrang', () => {
  assert.equal(abteilungVon('xyzabc'), 'sonstiges');
  assert.equal(abteilungVon(''), 'sonstiges');
  assert.equal(abteilungVon(null), 'sonstiges');
  assert.equal(abteilungVon('tofu', { tofu: { id: 'tofu', section: 'international', kanonisch: null } }), 'international');
  assert.equal(abteilungVon('tofu', new Map([['tofu', { section: 'tk' }]])), 'tk');
  // ungültige oder gelöschte Korrektur zählt nicht
  assert.equal(abteilungVon('tofu', { tofu: { section: 'gibt-es-nicht' } }), 'kuehl');
  assert.equal(abteilungVon('tofu', { tofu: { section: 'tk', deleted: true } }), 'kuehl');
  // geerbte Objekt-Eigenschaften sind keine Korrekturen
  assert.equal(abteilungVon('constructor', {}), 'sonstiges');
});

test('kanonischerSchluessel: Ketten, Kreise, höchstens 5 Schritte', () => {
  const aliase = {
    möhre: { kanonisch: 'karotte' }, karotte: { kanonisch: 'mohrrübe' },
    a: { kanonisch: 'b' }, b: { kanonisch: 'a' }, selbst: { kanonisch: 'selbst' },
    weg: { kanonisch: 'ziel', deleted: true },
  };
  assert.equal(kanonischerSchluessel('möhre', aliase), 'mohrrübe');
  assert.equal(kanonischerSchluessel('karotte', aliase), 'mohrrübe');
  assert.equal(kanonischerSchluessel('mohrrübe', aliase), 'mohrrübe');
  assert.equal(kanonischerSchluessel('a', aliase), 'a');
  assert.equal(kanonischerSchluessel('b', aliase), 'a');
  assert.equal(kanonischerSchluessel('selbst', aliase), 'selbst');
  assert.equal(kanonischerSchluessel('weg', aliase), 'weg');
  assert.equal(kanonischerSchluessel('x', undefined), 'x');
  const lang = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, { kanonisch: `k${i + 1}` }]));
  assert.equal(kanonischerSchluessel('k0', lang), 'k5');
});

test('standardZeitraum: Woche, nächste Woche, 7 Tage, Wochenstart', () => {
  // 15.10.2026 ist ein Donnerstag
  assert.deepEqual(standardZeitraum('diese-woche', '2026-10-15', 1), { von: '2026-10-12', bis: '2026-10-18' });
  assert.deepEqual(standardZeitraum('naechste-woche', '2026-10-15', 1), { von: '2026-10-19', bis: '2026-10-25' });
  assert.deepEqual(standardZeitraum('sieben-tage', '2026-10-15', 1), { von: '2026-10-15', bis: '2026-10-21' });
  assert.deepEqual(standardZeitraum('diese-woche', '2026-10-15', 0), { von: '2026-10-11', bis: '2026-10-17' });
  assert.deepEqual(standardZeitraum('diese-woche', '2026-10-15', 6), { von: '2026-10-10', bis: '2026-10-16' });
  assert.deepEqual(standardZeitraum('diese-woche', '2026-10-15', null), { von: '2026-10-12', bis: '2026-10-18' });
  assert.deepEqual(standardZeitraum('unbekannt', '2026-10-12'), { von: '2026-10-12', bis: '2026-10-18' });
  // Zeitumstellung (25.10.2026) und Jahreswechsel
  assert.deepEqual(standardZeitraum('naechste-woche', '2026-10-21', 1), { von: '2026-10-26', bis: '2026-11-01' });
  assert.deepEqual(standardZeitraum('diese-woche', '2026-12-31', 1), { von: '2026-12-28', bis: '2027-01-03' });
  assert.deepEqual(standardZeitraum('sieben-tage', '2027-03-26', 1), { von: '2027-03-26', bis: '2027-04-01' });
});

const RUNDE = { id: 't2', from: '2026-10-19', to: '2026-10-25', closedAt: null };

test('planEintraegeFuerRunde: Zeitraum inklusive, gelöscht und andere Runden raus', () => {
  const plan = [
    { id: 'e1', date: '2026-10-19', slot: 'abend', tripId: null },
    { id: 'e2', date: '2026-10-25', slot: 'mittag', tripId: 't2' },
    { id: 'e3', date: '2026-10-21', slot: 'abend', tripId: 't1' }, // abgeschlossene Runde
    { id: 'e4', date: '2026-10-26', slot: 'abend', tripId: null },
    { id: 'e5', date: '2026-10-18', slot: 'abend', tripId: null },
    { id: 'e6', date: '2026-10-22', slot: 'abend', tripId: null, deleted: true },
    { id: 'e7', date: '2026-10-19', slot: 'frueh' },
    { id: 'e8', date: 'kaputt', slot: 'abend', tripId: null },
  ];
  assert.deepEqual(planEintraegeFuerRunde(plan, RUNDE).map((e) => e.id), ['e7', 'e1', 'e2']);
  assert.deepEqual(planEintraegeFuerRunde(plan, { ...RUNDE, id: 't1' }).map((e) => e.id), ['e7', 'e1', 'e3']);
  assert.deepEqual(planEintraegeFuerRunde(plan, null), []);
  assert.deepEqual(planEintraegeFuerRunde(null, RUNDE), []);
  // vertauschter Zeitraum
  assert.deepEqual(planEintraegeFuerRunde(plan, { ...RUNDE, from: '2026-10-25', to: '2026-10-19' }).length, 3);
});

// ---------------------------------------------------------------- Testdaten für die Liste

const kopf = parseZeile('Für die Soße:'); // importierte Gruppen-Überschrift als Zutat
const GULASCH = {
  id: 'r-gulasch', title: 'Gulasch', servings: 2,
  ingredients: [kopf, ...parseZeilen('500 g Rindergulasch\n2 Zwiebeln\n1 EL Tomatenmark\n1 Prise Salz\n' +
    'etwas Petersilie\n200 ml Rotwein\n1 Prise Zucker\n1-2 Knoblauchzehen')],
};
const SUPPE = {
  id: 'r-suppe', title: 'Tomatensuppe', servings: 4,
  ingredients: parseZeilen('Suppe:\n1 Zwiebel\n2 EL Tomatenmark\n1 kg Tomaten\n0,5 l Gemüsebrühe\n' +
    '100 g Zucker\nSalz und Pfeffer\n1 Knoblauchzehe'),
};
const OHNE_PORTIONEN = { id: 'r-ohne', title: 'Brot', servings: null, ingredients: parseZeilen('500 g Mehl') };
const PLAN = [
  { id: 'e1', date: '2026-10-19', slot: 'abend', recipeId: 'r-gulasch', servings: 4, tripId: null },
  { id: 'e2', date: '2026-10-20', slot: 'abend', recipeId: 'r-suppe', servings: 2, tripId: null },
  { id: 'e3', date: '2026-10-21', slot: 'abend', recipeId: 'r-gulasch', servings: 4, tripId: 't1' },
  { id: 'e4', date: '2026-10-27', slot: 'abend', recipeId: 'r-suppe', servings: 4, tripId: null },
  { id: 'e5', date: '2026-10-22', slot: 'abend', recipeId: 'r-suppe', servings: 4, tripId: null, deleted: true },
  { id: 'e6', date: '2026-10-23', slot: 'abend', recipeId: null, title: 'Pizza essen', servings: 2, tripId: null },
  { id: 'e7', date: '2026-10-24', slot: 'abend', recipeId: 'r-geloescht', servings: 2, tripId: null },
];
const VORRAT = ['salz', 'pfeffer', 'wasser'];
const alleZeilen = (l) => [...l.abteilungen.flatMap((a) => a.zeilen), ...l.erledigt, ...l.vorrat];
const zeile = (l, key) => alleZeilen(l).find((z) => z.mergeKey === key);
const liste = (extra = {}) => berechneListe({
  planEintraege: PLAN, rezepte: [GULASCH, SUPPE], manuelle: [], zustaende: [], aliase: {}, vorrat: VORRAT,
  runde: RUNDE, reihenfolge: null, ...extra,
});

test('berechneListe: zwei Rezepte skaliert und zusammengefasst', () => {
  const l = liste();
  assert.deepEqual(l.eintraege.map((e) => e.id), ['e1', 'e2', 'e6', 'e7']);
  // Gulasch ×2, Suppe ×0,5
  const zwiebel = zeile(l, 'zwiebel');
  assert.deepEqual(zwiebel.teile, [{ qty: 4.5, qty2: null, unit: 'Stück' }]);
  assert.equal(zwiebel.text, '4½');
  assert.equal(zwiebel.abteilung, 'obst-gemuese');
  assert.deepEqual(zwiebel.quellen, [
    { planEntryId: 'e1', recipeId: 'r-gulasch', titel: 'Gulasch', datum: '2026-10-19' },
    { planEntryId: 'e2', recipeId: 'r-suppe', titel: 'Tomatensuppe', datum: '2026-10-20' }]);
  assert.equal(zeile(l, 'rindergulasch').text, '1 kg');
  assert.equal(zeile(l, 'rindergulasch').abteilung, 'fleisch');
  // 2 EL + 1 EL = 9 TL → '3 EL'
  assert.equal(zeile(l, 'tomatenmark').text, '3 EL');
  assert.equal(zeile(l, 'tomatenmark').abteilung, 'saucen');
  assert.equal(zeile(l, 'gemüsebrühe').text, '250 ml');
  assert.equal(zeile(l, 'tomate').text, '500 g');
  assert.equal(zeile(l, 'rotwein').abteilung, 'alkohol');
  // Spanne: (1–2) × 2 + 1 × 0,5 → 2,5–4,5
  assert.deepEqual(zeile(l, 'knoblauchzehe').teile, [{ qty: 2.5, qty2: 4.5, unit: 'Stück' }]);
  assert.equal(zeile(l, 'knoblauchzehe').text, '2½–4½');
  // Gruppen-Überschrift ist keine Zutat
  assert.equal(alleZeilen(l).some((z) => /soße/i.test(z.mergeKey)), false);
  // jede Zeile ist vollständig
  for (const z of alleZeilen(l)) {
    assert.equal(typeof z.text, 'string');
    assert.equal(z.versteckt, false);
    assert.equal(z.manuell, null);
    assert.ok(ABTEILUNGEN.some((a) => a.id === z.abteilung), z.abteilung);
  }
});

test('berechneListe: Prise/etwas sind vage, außer es gibt auch eine Menge', () => {
  const l = liste();
  const petersilie = zeile(l, 'petersilie');
  assert.equal(petersilie.vage, true);
  assert.deepEqual(petersilie.teile, []);
  assert.equal(petersilie.text, '');
  // 1 Prise Zucker (Gulasch) + 100 g × 0,5 (Suppe) → nur die Grammzahl zählt
  const zucker = zeile(l, 'zucker');
  assert.equal(zucker.vage, false);
  assert.equal(zucker.text, '50 g');
  assert.equal(zucker.quellen.length, 2);
  // nur vage → vage
  const nurPrise = berechneListe({ planEintraege: PLAN.slice(0, 1), rezepte: [GULASCH], runde: RUNDE });
  assert.equal(zeile(nurPrise, 'zucker').vage, true);
  assert.equal(zeile(nurPrise, 'zucker').text, '');
});

test('berechneListe: Vorrat, Zählung, Sortierung und Reihenfolge', () => {
  const l = liste();
  assert.deepEqual(l.vorrat.map((z) => z.mergeKey), ['salz', 'salz und pfeffer']);
  assert.ok(l.vorrat.every((z) => z.imVorrat));
  const offen = l.abteilungen.flatMap((a) => a.zeilen);
  assert.equal(l.anzahlOffen, offen.length);
  assert.equal(l.anzahlGesamt, offen.length);
  assert.equal(offen.some((z) => z.imVorrat), false);
  // Standard-Reihenfolge, leere Abteilungen fehlen, Namen alphabetisch
  const ids = l.abteilungen.map((a) => a.id);
  assert.deepEqual(ids, ['obst-gemuese', 'fleisch', 'backen', 'saucen', 'alkohol']);
  const obst = l.abteilungen[0].zeilen.map((z) => z.name);
  assert.deepEqual(obst, [...obst].sort((a, b) => a.localeCompare(b, 'de')));
  const eigene = liste({ reihenfolge: ['alkohol', 'saucen'] }).abteilungen.map((a) => a.id);
  assert.deepEqual(eigene, ['alkohol', 'saucen', 'obst-gemuese', 'fleisch', 'backen']);
  // ohne Vorrat steht Salz in den Gewürzen
  const ohne = liste({ vorrat: [] });
  assert.equal(ohne.vorrat.length, 0);
  assert.ok(ohne.abteilungen.find((a) => a.id === 'gewuerze').zeilen.some((z) => z.mergeKey === 'salz'));
});

test('berechneListe: Portionen fehlen → Faktor nach Spezifikation', () => {
  const plan = [
    { id: 'p1', date: '2026-10-19', slot: 'abend', recipeId: 'r-ohne', servings: 3, tripId: null },
    { id: 'p2', date: '2026-10-20', slot: 'abend', recipeId: 'r-gulasch', servings: null, tripId: null },
  ];
  const l = berechneListe({ planEintraege: plan, rezepte: new Map([[GULASCH.id, GULASCH], [OHNE_PORTIONEN.id, OHNE_PORTIONEN]]), runde: RUNDE });
  assert.equal(zeile(l, 'mehl').text, '1,5 kg'); // Rezept ohne Portionen = 1 → × 3
  assert.equal(zeile(l, 'rindergulasch').text, '500 g'); // Eintrag ohne Portionen = Rezept
});

test('berechneListe: Zusätze in der Notiz bestimmen die Abteilung', () => {
  const r = { id: 'r-z', title: 'Z', servings: 1, ingredients: parseZeilen('500 g Tomate(n), passierte\n' +
    '1 TL Thymian, getrockneter\n1 Dose Tomate(n), geschälte') };
  const plan = [{ id: 'z1', date: '2026-10-19', slot: 'abend', recipeId: 'r-z', servings: 1, tripId: null }];
  const l = berechneListe({ planEintraege: plan, rezepte: [r], runde: RUNDE });
  assert.equal(zeile(l, 'thymian').abteilung, 'gewuerze');
  assert.equal(zeile(l, 'thymian').name, 'Thymian, getrockneter');
  assert.equal(zeile(l, 'tomate').abteilung, 'konserven');
  assert.match(zeile(l, 'tomate').name, /^Tomaten?, passierte$/);
  // Zusatz ohne Einfluss auf die Abteilung bleibt aus dem Namen
  const r3 = { ...r, ingredients: parseZeilen('2 Zwiebel(n), gehackt\n200 g Erbsen, TK') };
  const l3 = berechneListe({ planEintraege: plan, rezepte: [r3], runde: RUNDE });
  assert.equal(zeile(l3, 'zwiebel').name, 'Zwiebeln');
  assert.equal(zeile(l3, 'zwiebel').abteilung, 'obst-gemuese');
  assert.equal(zeile(l3, 'tk-erbse').abteilung, 'tk');
  // gemischt mit frischen Tomaten → Gemüse
  const r2 = { ...r, ingredients: [...r.ingredients, parseZeile('3 Tomaten')] };
  assert.equal(zeile(berechneListe({ planEintraege: plan, rezepte: [r2], runde: RUNDE }), 'tomate').abteilung, 'obst-gemuese');
});

test('berechneListe: eigene Einträge bleiben einzeln', () => {
  const manuelle = [
    { id: 'm1', kind: 'manual', name: 'Milch', qty: 1, qty2: null, unit: 'l', note: 'fettarm', section: null, checked: false },
    { id: 'm2', kind: 'manual', name: 'Klopapier', qty: null, qty2: null, unit: null, note: null, section: null, checked: true },
    { id: 'm3', kind: 'manual', name: 'Zwiebeln', qty: 2, qty2: null, unit: null, note: null, section: 'sonstiges', checked: false },
    { id: 'm4', kind: 'manual', name: 'Brot', qty: 1, unit: null, section: null, checked: false, deleted: true },
    { id: 'm5', kind: 'manual', name: 'Tomaten', qty: 1, unit: 'Dose', section: 'gibt-es-nicht', checked: false },
  ];
  const l = liste({ manuelle });
  const milch = zeile(l, 'manuell:m1');
  assert.equal(milch.text, '1 l');
  assert.equal(milch.abteilung, 'molkerei');
  assert.equal(milch.manuell, manuelle[0]);
  assert.equal(milch.erledigt, false);
  assert.deepEqual(milch.quellen, []);
  assert.deepEqual(l.erledigt.map((z) => z.mergeKey), ['manuell:m2']);
  assert.equal(zeile(l, 'manuell:m2').abteilung, 'haushalt');
  assert.equal(zeile(l, 'manuell:m2').text, '');
  // nicht mit der Rezept-Zeile 'zwiebel' zusammengeführt, eigene Abteilung gilt
  assert.equal(zeile(l, 'manuell:m3').abteilung, 'sonstiges');
  assert.equal(zeile(l, 'manuell:m3').text, '2');
  assert.equal(zeile(l, 'zwiebel').text, '4½');
  assert.equal(zeile(l, 'manuell:m4'), undefined);
  assert.equal(zeile(l, 'manuell:m5').abteilung, 'konserven');
  assert.equal(l.anzahlGesamt, l.anzahlOffen + 1);
});

test('berechneListe: Korrekturen – Abteilung und Zusammenführen', () => {
  const aliase = {
    knoblauchzehe: { id: 'knoblauchzehe', kanonisch: 'zwiebel', section: null },
    rotwein: { id: 'rotwein', kanonisch: null, section: 'getraenke' },
  };
  const l = liste({ aliase });
  assert.equal(zeile(l, 'knoblauchzehe'), undefined);
  const z = zeile(l, 'zwiebel');
  assert.deepEqual(z.teile, [{ qty: 7, qty2: 9, unit: 'Stück' }]);
  assert.equal(zeile(l, 'rotwein').abteilung, 'getraenke');
  // Vorrat folgt der Zusammenführung
  const l2 = liste({ aliase: { salz: { kanonisch: 'meersalz' } }, vorrat: ['salz'] });
  assert.ok(l2.vorrat.some((x) => x.mergeKey === 'meersalz'));
});

// Abhak-Stand speichern wie die Ansicht (id = runde|mergeKey)
const stand = (z, tripId = 't2') => ({ id: `${tripId}|${z.mergeKey}`, kind: 'state', tripId, mergeKey: z.mergeKey,
  ...abhakZustand(z), versteckt: false });

test('abhakZustand: aktuelle Mengen in Basis-Einheiten', () => {
  const l = liste();
  assert.deepEqual(abhakZustand(zeile(l, 'tomatenmark')), { abgehakt: { TL: 9 }, erledigt: true });
  assert.deepEqual(abhakZustand(zeile(l, 'knoblauchzehe')), { abgehakt: { Stück: 4.5 }, erledigt: true });
  assert.deepEqual(abhakZustand(zeile(l, 'petersilie')), { abgehakt: {}, erledigt: true });
  assert.deepEqual(abhakZustand({ teile: [{ qty: 1.5, qty2: null, unit: 'kg' }, { qty: 2, unit: 'EL' }] }),
    { abgehakt: { g: 1500, TL: 6 }, erledigt: true });
  assert.deepEqual(abhakZustand(null), { abgehakt: {}, erledigt: true });
});

test('berechneListe: Abhaken, nachträglich mehr → Rest', () => {
  const vorher = liste();
  const zustaende = ['zwiebel', 'rindergulasch', 'petersilie', 'tomatenmark']
    .map((k) => stand(zeile(vorher, k)));
  const l = liste({ zustaende });
  assert.deepEqual(l.erledigt.map((z) => z.mergeKey).sort(), ['petersilie', 'rindergulasch', 'tomatenmark', 'zwiebel']);
  assert.ok(l.erledigt.every((z) => z.erledigt && z.rest.length === 0 && z.restText === ''));
  assert.equal(l.anzahlGesamt, vorher.anzahlGesamt);
  assert.equal(l.anzahlOffen, vorher.anzahlOffen - 4);
  // Gulasch-Portionen 4 → 6: Zwiebeln 6,5 statt 4,5 → noch 2
  const mehr = PLAN.map((e) => (e.id === 'e1' ? { ...e, servings: 6 } : e));
  const l2 = liste({ zustaende, planEintraege: mehr });
  const z = zeile(l2, 'zwiebel');
  assert.equal(z.erledigt, false);
  assert.equal(z.text, '6½');
  assert.deepEqual(z.rest, [{ qty: 2, qty2: null, unit: 'Stück' }]);
  assert.equal(z.restText, '2');
  assert.equal(zeile(l2, 'rindergulasch').restText, '500 g');
  assert.equal(zeile(l2, 'tomatenmark').restText, '1 EL');
  // vage abgehakt bleibt erledigt
  assert.equal(zeile(l2, 'petersilie').erledigt, true);
  // weniger als abgehakt → weiter erledigt
  const weniger = PLAN.map((e) => (e.id === 'e1' ? { ...e, servings: 2 } : e));
  assert.equal(zeile(liste({ zustaende, planEintraege: weniger }), 'zwiebel').erledigt, true);
});

test('berechneListe: Rest bei Spannen, neuer Einheit und Löffel ↔ ml', () => {
  const vorher = liste();
  const zustaende = [stand(zeile(vorher, 'knoblauchzehe'))]; // 4,5 Stück abgehakt
  const plan = [...PLAN, { id: 'e9', date: '2026-10-21', slot: 'mittag', recipeId: 'r-gulasch', servings: 2, tripId: null }];
  const z = zeile(liste({ zustaende, planEintraege: plan }), 'knoblauchzehe'); // jetzt 3,5–6,5
  assert.equal(z.erledigt, false);
  assert.deepEqual(z.rest, [{ qty: 2, qty2: null, unit: 'Stück' }]);
  // neue Einheit (vorher nur Stück) kommt komplett als Rest
  const rz = { teile: [{ qty: 2, qty2: null, unit: 'Stück' }] };
  const neu = { id: 'r-n', title: 'N', servings: 1, ingredients: parseZeilen('2 Zwiebeln\n100 g Zwiebeln') };
  const p = [{ id: 'n1', date: '2026-10-19', slot: 'abend', recipeId: 'r-n', servings: 1, tripId: null }];
  const zs = [{ id: 't2|zwiebel', kind: 'state', tripId: 't2', mergeKey: 'zwiebel', ...abhakZustand(rz), versteckt: false }];
  const zw = zeile(berechneListe({ planEintraege: p, rezepte: [neu], zustaende: zs, runde: RUNDE }), 'zwiebel');
  assert.equal(zw.erledigt, false);
  assert.equal(zw.restText, '100 g');
  // 2 EL Öl abgehakt, dann kommen 100 ml dazu → Öl steht in ml, 30 ml sind schon da
  const oel = { id: 'r-o', title: 'O', servings: 1, ingredients: parseZeilen('2 EL Olivenöl') };
  const oel2 = { ...oel, ingredients: parseZeilen('2 EL Olivenöl\n100 ml Olivenöl') };
  const po = [{ id: 'o1', date: '2026-10-19', slot: 'abend', recipeId: 'r-o', servings: 1, tripId: null }];
  const so = [stand(zeile(berechneListe({ planEintraege: po, rezepte: [oel], runde: RUNDE }), 'olivenöl'))];
  const o = zeile(berechneListe({ planEintraege: po, rezepte: [oel2], zustaende: so, runde: RUNDE }), 'olivenöl');
  assert.equal(o.text, '130 ml');
  assert.equal(o.restText, '100 ml');
});

test('berechneListe: Abhak-Stände anderer Runden, Ausblenden, Zurücknehmen', () => {
  const vorher = liste();
  const z = zeile(vorher, 'zwiebel');
  // Stand einer anderen (abgeschlossenen) Runde zählt nicht
  assert.equal(zeile(liste({ zustaende: [stand(z, 't1')] }), 'zwiebel').erledigt, false);
  // zurückgenommen
  const aus = { ...stand(z), erledigt: false, abgehakt: null };
  const l = liste({ zustaende: [aus] });
  assert.equal(zeile(l, 'zwiebel').erledigt, false);
  assert.deepEqual(zeile(l, 'zwiebel').rest, zeile(l, 'zwiebel').teile);
  assert.equal(zeile(l, 'zwiebel').restText, zeile(l, 'zwiebel').text);
  // ausgeblendet: nirgends, nicht gezählt
  const versteckt = liste({ zustaende: [{ ...aus, versteckt: true }] });
  assert.equal(zeile(versteckt, 'zwiebel'), undefined);
  assert.equal(versteckt.anzahlOffen, vorher.anzahlOffen - 1);
  assert.equal(versteckt.anzahlGesamt, vorher.anzahlGesamt - 1);
  // alter Stand ohne Mengen: erledigt
  assert.equal(zeile(liste({ zustaende: [{ ...aus, erledigt: true }] }), 'zwiebel').erledigt, true);
});

test('berechneListe: Runde filtert Einträge, leere Eingaben', () => {
  // Einträge einer abgeschlossenen Runde (e3) fehlen; in Runde t1 sind sie dabei
  const t1 = { id: 't1', from: '2026-10-19', to: '2026-10-25', closedAt: 1 };
  assert.equal(zeile(liste({ runde: t1 }), 'rindergulasch').text, '2 kg'); // e1 + e3
  assert.equal(zeile(liste(), 'rindergulasch').quellen.length, 1);
  const leer = berechneListe();
  assert.deepEqual(leer, { abteilungen: [], erledigt: [], vorrat: [], anzahlOffen: 0, anzahlGesamt: 0, eintraege: [] });
  const nurManuell = berechneListe({ manuelle: [{ id: 'm', kind: 'manual', name: 'Brot', qty: null, checked: false }] });
  assert.equal(nurManuell.anzahlOffen, 1);
  assert.equal(nurManuell.abteilungen[0].id, 'brot');
});

test('listeAlsText: Titel, Abteilungen, Rest statt Gesamt, ohne Erledigtes und Vorrat', () => {
  const r = { id: 'r-t', title: 'T', servings: 1, ingredients: parseZeilen('500 g Kartoffeln\n3 Zwiebeln\n' +
    'etwas Petersilie\n1 Prise Salz\n200 g Speck\n1 l Milch') };
  const plan = [{ id: 't', date: '2026-10-19', slot: 'abend', recipeId: 'r-t', servings: 1, tripId: null }];
  const basis = { planEintraege: plan, rezepte: [r], vorrat: ['salz'], runde: RUNDE };
  const vorher = berechneListe(basis);
  const zustaende = [
    stand({ ...zeile(vorher, 'zwiebel'), teile: [{ qty: 1, qty2: null, unit: 'Stück' }] }), // 1 von 3
    stand(zeile(vorher, 'speck')),
  ];
  const manuelle = [{ id: 'm1', kind: 'manual', name: 'Spülmittel', qty: null, note: 'Zitrone', checked: false },
    { id: 'm2', kind: 'manual', name: 'Brot', qty: 1, checked: true }];
  const l = berechneListe({ ...basis, zustaende, manuelle });
  assert.equal(listeAlsText(l, { titel: 'Einkaufsliste 19.10.–25.10.2026' }), [
    'Einkaufsliste 19.10.–25.10.2026',
    '',
    '— Obst & Gemüse —',
    '• 500 g Kartoffeln',
    '• Petersilie',
    '• 2 Zwiebeln',
    '',
    '— Milch, Butter & Eier —',
    '• 1 l Milch',
    '',
    '— Haushalt —',
    '• Spülmittel (Zitrone)',
  ].join('\n'));
  assert.equal(listeAlsText(l).split('\n')[0], '— Obst & Gemüse —');
  assert.equal(listeAlsText({ abteilungen: [] }, { titel: 'Leer' }), 'Leer');
  assert.equal(listeAlsText(null), '');
});
