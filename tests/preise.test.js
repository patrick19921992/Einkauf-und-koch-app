import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAEDEN, PREIS_STAND, findePreis, mengeInEinheit, kostenFuer, kostenFuerZeilen, verteileLaeden, formatEuro,
  formatEuroGerundet,
} from '../js/preise.js';
import { PREISE, LADEN_FAKTOR, KATEGORIE_SCHAETZUNG } from '../js/daten/preise-tabelle.js';
import { ABTEILUNGEN, berechneListe } from '../js/einkaufsliste.js';
import { parseZeilen } from '../js/zutaten.js';

// Kleine, erfundene Preistabelle: Tests hängen nicht an der echten Tabelle
const TABELLE = {
  preise: [
    ['nudel', 1.0, 500, 'g'],
    ['reis', 2.0, 1000, 'g'],
    ['zwiebel', 1.0, 1000, 'g', { stueckGewicht: 100 }],
    ['knoblauch', 0.8, 200, 'g', { stueckGewicht: 50 }],
    ['paprika', 0.7, 1, 'Stück', { stueckGewicht: 160 }],
    ['banane', 2.0, 1000, 'g', { stueckGewicht: 200, lose: true }],
    ['tomate, gehackt', 0.5, 400, 'g', { container: 'Dose' }],
    ['tomate', 2.0, 500, 'g', { stueckGewicht: 100 }],
    ['mais', 0.9, 285, 'g', { container: 'Dose' }],
    ['kokosmilch', 1.2, 400, 'ml', { container: 'Dose' }],
    ['milch', 1.0, 1000, 'ml', { dichte: 1.03 }],
    ['olivenöl', 6.0, 750, 'ml', { dichte: 0.9 }],
    ['zucker', 1.0, 1000, 'g', { dichte: 0.8 }],
    ['petersilie', 0.9, 1, 'Bund'],
    ['frühlingszwiebel', 0.6, 6, 'Stück', { stueckGewicht: 20, container: 'Bund' }],
    ['vollkornbrot', 1.3, 10, 'Scheibe'],
    ['vanillezucker', 0.5, 5, 'Packung'],
    ['brot', 2.0, 750, 'g'],
    ['tortellini', 2.0, 500, 'g'],
    ['tk-erbse', 1.5, 750, 'g'],
    ['ei', 2.0, 10, 'Stück', { stueckGewicht: 60 }],
    ['butter', 2.0, 250, 'g', { laeden: { rewe: 1.5 } }],
    ['spaghetti', 0.9, 500, 'g', { laeden: { aldi: 0.9, lidl: 0.9, penny: 0.9, netto: 0.9, kaufland: 0.9, rewe: 0.9,
      edeka: 0.9 } }],
    ['mozzarella', 0.8, 125, 'g'],
    ['staudensellerie', 1.3, 1, 'Stück', { stueckGewicht: 500 }],
    ['salz', 0.4, 500, 'g', { vorrat: true }],
    ['olivenöl, vorrat', 6.0, 750, 'ml', { vorrat: true }],
    ['wasser', 0, 1000, 'ml', { vorrat: true }],
    ['mineralwasser', 0.2, 1500, 'ml'],
  ],
  ladenFaktor: { aldi: 1, lidl: 1, penny: 1.1, netto: 1.1, kaufland: 1.2, rewe: 1.5, edeka: 2 },
  kategorie: { fleisch: { proKg: 10, pauschal: 3 }, 'obst-gemuese': { proKg: 3, proStueck: 0.5, pauschal: 1 } },
};
const opt = { tabelle: TABELLE };
const teil = (qty, unit, qty2 = null) => ({ qty, qty2, unit });

test('LAEDEN: sieben Supermärkte mit id und Namen', () => {
  assert.deepEqual(LAEDEN.map((l) => l.id), ['aldi', 'lidl', 'penny', 'netto', 'kaufland', 'rewe', 'edeka']);
  assert.equal(LAEDEN.find((l) => l.id === 'rewe').name, 'Rewe');
  assert.ok(Object.isFrozen(LAEDEN));
});

test('findePreis: genau, Einzahl/Mehrzahl, mit und ohne Komma', () => {
  assert.equal(findePreis('nudel', opt).packPreis, 1.0);
  assert.equal(findePreis('Zwiebeln', opt).schluessel, 'zwiebel');
  assert.equal(findePreis('tomate, gehackt', opt).schluessel, 'tomate, gehackt');
  assert.equal(findePreis('tomate gehackt', opt).schluessel, 'tomate, gehackt');
  assert.equal(findePreis('  NUDEL ', opt).schluessel, 'nudel');
  const e = findePreis('zwiebel', opt);
  assert.deepEqual({ ...e }, { schluessel: 'zwiebel', packPreis: 1, packMenge: 1000, einheit: 'g', stueckGewicht: 100,
    lose: false, dichte: null, vorrat: false, container: null, laeden: null });
});

test('findePreis: ohne Beschreibung vorne, letztes Wort, Wortteil hinten, Bindestrich', () => {
  assert.equal(findePreis('rote paprikaschote', opt).schluessel, 'paprika');
  assert.equal(findePreis('gelbe paprika', opt).schluessel, 'paprika');
  assert.equal(findePreis('knoblauchzehe', opt).schluessel, 'knoblauch');
  assert.equal(findePreis('vollkornbrot', opt).schluessel, 'vollkornbrot');
  assert.equal(findePreis('weißbrot', opt).schluessel, 'brot');
  assert.equal(findePreis('bandnudel', opt).schluessel, 'nudel');
  assert.equal(findePreis('basmatireis', opt).schluessel, 'reis');
  assert.equal(findePreis('käse-tortellini', opt).schluessel, 'tortellini');
  assert.equal(findePreis('tk erbse', opt).schluessel, 'tk-erbse');
  // Produkt-Zusatz: Dose fällt auf die Grundware zurück, gemahlene Kräuter nicht auf Frischware
  assert.equal(findePreis('mais, dose', opt).schluessel, 'mais');
  assert.equal(findePreis('paprika, gemahlen', opt), null);
  // zu kurze Wortteile zählen nicht ('brei' ist kein 'ei'), Unbekanntes → null
  assert.equal(findePreis('grießbrei', opt), null);
  assert.equal(findePreis('drachenfrucht', opt), null);
  assert.equal(findePreis('', opt), null);
});

test('mengeInEinheit: Masse, Volumen, Obergrenze und Summe', () => {
  const nudel = findePreis('nudel', opt);
  assert.equal(mengeInEinheit([teil(1.5, 'kg')], nudel), 1500);
  assert.equal(mengeInEinheit([teil(200, 'g', 300)], nudel), 300);
  assert.equal(mengeInEinheit([teil(200, 'g'), teil(0.1, 'kg')], nudel), 300);
  const milch = findePreis('milch', opt);
  assert.equal(mengeInEinheit([teil(0.5, 'l')], milch), 500);
  assert.equal(mengeInEinheit([teil(103, 'g')], milch), 100);
  assert.equal(mengeInEinheit([teil('1,5', 'l')], milch), 1500);
  assert.equal(mengeInEinheit([], nudel), null);
  assert.equal(mengeInEinheit([teil(1, 'Prise')], nudel), null);
  assert.equal(mengeInEinheit([teil(100, 'g')], null), null);
});

test('mengeInEinheit: Stück ↔ g, Dose, EL/TL, Zehe, Bund, Packung, Scheibe', () => {
  const zwiebel = findePreis('zwiebel', opt);
  assert.equal(mengeInEinheit([teil(3, 'Stück')], zwiebel), 300);
  assert.equal(mengeInEinheit([teil(2, null)], zwiebel), 200);
  assert.equal(mengeInEinheit([teil(2, 'Stück'), teil(50, 'g')], zwiebel), 250);
  assert.equal(mengeInEinheit([teil(320, 'g')], findePreis('paprika', opt)), 2);
  assert.equal(mengeInEinheit([teil(2, 'Stück')], findePreis('nudel', opt)), null);
  // Dose: eigener Behälter = eine Packung, sonst 400 g
  assert.equal(mengeInEinheit([teil(2, 'Dose')], findePreis('mais', opt)), 570);
  assert.equal(mengeInEinheit([teil(1, 'Dose')], findePreis('kokosmilch', opt)), 400);
  assert.equal(mengeInEinheit([teil(1, 'Dose')], findePreis('tomate', opt)), 400);
  // Löffel: 1 EL = 3 TL = 15 ml; Gramm über die Dichte
  assert.equal(mengeInEinheit([teil(2, 'EL')], findePreis('olivenöl', opt)), 30);
  assert.equal(mengeInEinheit([teil(3, 'TL')], findePreis('zucker', opt)), 12);
  assert.equal(mengeInEinheit([teil(2, 'Zehe')], findePreis('knoblauch', opt)), 10);
  assert.equal(mengeInEinheit([teil(25, 'g')], findePreis('petersilie', opt)), 0.5);
  assert.equal(mengeInEinheit([teil(1, 'Bund'), teil(2, 'Stück')], findePreis('frühlingszwiebel', opt)), 8);
  assert.equal(mengeInEinheit([teil(1, 'Packung')], findePreis('vanillezucker', opt)), 1);
  assert.equal(mengeInEinheit([teil(8, 'g')], findePreis('vanillezucker', opt)), null);
  assert.equal(mengeInEinheit([teil(4, 'Scheibe')], findePreis('vollkornbrot', opt)), 4);
});

test('kostenFuer: ganze Packungen, lose Ware anteilig, Wiederverwendung im selben Paket', () => {
  const k = kostenFuer('nudel', [teil(600, 'g')], ['lidl'], opt);
  assert.deepEqual(k, { betrag: 2, laden: 'lidl', quelle: 'tabelle', geschaetzt: true, packungen: 2 });
  assert.equal(kostenFuer('nudel', [teil(500, 'g')], ['lidl'], opt).betrag, 1);
  // zwei Gerichte mit je 250 g brauchen zusammen nur eine Packung
  assert.equal(kostenFuer('nudel', [teil(250, 'g')], ['lidl'], opt).betrag, 1);
  assert.equal(kostenFuer('nudel', [teil(500, 'g')], ['lidl'], opt).betrag, 1);
  const banane = kostenFuer('banane', [teil(3, 'Stück')], ['lidl'], opt);
  assert.equal(banane.betrag, 1.2);
  assert.equal(banane.packungen, 0.6);
  assert.equal(kostenFuer('tomate, gehackt', [teil(3, 'Dose')], ['lidl'], opt).betrag, 1.5);
});

test('kostenFuer: Vorrat kostet nichts, ungenaue Zeilen = eine kleinste Packung', () => {
  assert.deepEqual(kostenFuer('salz', [teil(1, 'TL')], ['lidl'], opt),
    { betrag: 0, laden: null, quelle: 'vorrat', geschaetzt: false, packungen: 0 });
  assert.equal(kostenFuer('Salz', [], ['lidl'], opt).quelle, 'vorrat');
  assert.equal(kostenFuer('nudel', [teil(100, 'g')], ['lidl'], { ...opt, vorrat: ['nudel'] }).betrag, 0);
  assert.equal(kostenFuer('nudel', [teil(100, 'g')], ['lidl'], { ...opt, vorrat: new Set(['nudel']) }).quelle, 'vorrat');
  const vage = kostenFuer('petersilie', [], ['lidl'], opt);
  assert.equal(vage.betrag, 0.9);
  assert.equal(vage.packungen, 1);
  // nicht umrechenbar (Stück ohne Stückgewicht) → eine Packung
  assert.equal(kostenFuer('nudel', [teil(2, 'Stück')], ['lidl'], opt).betrag, 1);
});

test('kostenFuer: günstigster der gewählten Läden, Gleichstand → erster', () => {
  assert.equal(kostenFuer('reis', [teil(500, 'g')], ['rewe', 'lidl'], opt).laden, 'lidl');
  const rewe = kostenFuer('reis', [teil(500, 'g')], ['rewe', 'edeka'], opt);
  assert.deepEqual([rewe.laden, rewe.betrag], ['rewe', 3]);
  assert.equal(kostenFuer('reis', [teil(500, 'g')], ['lidl', 'aldi'], opt).laden, 'lidl');
  assert.equal(kostenFuer('reis', [teil(500, 'g')], ['aldi', 'lidl'], opt).laden, 'aldi');
  const drei = kostenFuer('reis', [teil(1200, 'g')], ['edeka', 'rewe', 'penny'], opt);
  assert.deepEqual([drei.laden, drei.betrag, drei.packungen], ['penny', 4.4, 2]);
  // bekannter Ladenpreis statt Faktor
  assert.equal(kostenFuer('butter', [teil(250, 'g')], ['lidl', 'rewe'], opt).laden, 'rewe');
  // ungültige Läden fallen weg, ohne Laden gilt Lidl
  assert.equal(kostenFuer('reis', [teil(1, 'kg')], ['gibtsnicht'], opt).laden, 'lidl');
  assert.equal(kostenFuer('reis', [teil(1, 'kg')], [], opt).laden, 'lidl');
});

test('kostenFuer: eigene Preise gehen vor (alle Läden oder einzelner Laden)', () => {
  const alle = { reis: { alle: { preis: 1.5, menge: 1, einheit: 'kg' } } };
  const k = kostenFuer('reis', [teil(1500, 'g')], ['rewe'], { ...opt, eigenePreise: alle });
  assert.deepEqual(k, { betrag: 3, laden: 'rewe', quelle: 'eigen', geschaetzt: false, packungen: 2 });
  // eigener Preis nur bei Edeka macht Edeka zum günstigsten Laden
  const edeka = { reis: { edeka: { preis: 0.99, menge: 1000, einheit: 'g' } } };
  const e = kostenFuer('reis', [teil(800, 'g')], ['lidl', 'edeka'], { ...opt, eigenePreise: edeka });
  assert.deepEqual([e.laden, e.betrag, e.quelle], ['edeka', 0.99, 'eigen']);
  // ein Laden mit eigenem Preis, der andere aus der Tabelle: günstiger gewinnt
  const teuer = { reis: { edeka: { preis: 5, menge: 1000, einheit: 'g' } } };
  assert.equal(kostenFuer('reis', [teil(800, 'g')], ['edeka', 'lidl'], { ...opt, eigenePreise: teuer }).laden, 'lidl');
  // Stückpreis: Gramm über das Stückgewicht der Tabelle
  const stueck = { zwiebel: { alle: { preis: 0.3, menge: 1, einheit: 'Stück' } } };
  assert.equal(kostenFuer('zwiebel', [teil(250, 'g')], ['lidl'], { ...opt, eigenePreise: stueck }).betrag, 0.9);
  // eigener Preis auch für Unbekanntes und für Vorrat
  const neu = { drachenfrucht: { alle: { preis: 2.5, menge: 1, einheit: 'Stück' } } };
  assert.equal(kostenFuer('drachenfrucht', [teil(2, 'Stück')], ['lidl'], { ...opt, eigenePreise: neu }).betrag, 5);
  const salz = { salz: { alle: { preis: 0.5, menge: 500, einheit: 'g' } } };
  assert.equal(kostenFuer('salz', [teil(10, 'g')], ['lidl'], { ...opt, eigenePreise: salz }).quelle, 'eigen');
  // ungültige eigene Preise werden ignoriert
  const kaputt = { reis: { alle: { preis: 'abc', menge: 1, einheit: 'kg' } } };
  assert.equal(kostenFuer('reis', [teil(1, 'kg')], ['lidl'], { ...opt, eigenePreise: kaputt }).quelle, 'tabelle');
  // ungültiger Ladenpreis → der Preis für alle Läden gilt
  const halb = { reis: { lidl: { preis: -1 }, alle: { preis: 1, menge: 1, einheit: 'kg' } } };
  assert.equal(kostenFuer('reis', [teil(1, 'kg')], ['lidl'], { ...opt, eigenePreise: halb }).betrag, 1);
});

test('kostenFuer: Schätzung über die Abteilung, sonst unbekannt', () => {
  const k = kostenFuer('wildschweinrücken', [teil(500, 'g')], ['lidl', 'rewe'], { ...opt, abteilung: 'fleisch' });
  assert.deepEqual(k, { betrag: 5, laden: 'lidl', quelle: 'kategorie', geschaetzt: true, packungen: null });
  assert.equal(kostenFuer('drachenfrucht', [teil(2, 'Stück')], ['lidl'], { ...opt, abteilung: 'obst-gemuese' }).betrag, 1);
  assert.equal(kostenFuer('drachenfrucht', [], ['lidl'], { ...opt, abteilung: 'obst-gemuese' }).betrag, 1);
  // angebrochene Bund/Dose/Glas zählen ganz
  assert.equal(kostenFuer('radieschen', [teil(0.5, 'Bund')], ['lidl'], { ...opt, abteilung: 'obst-gemuese' }).betrag, 1);
  assert.deepEqual(kostenFuer('drachenfrucht', [teil(2, 'Stück')], ['lidl'], opt),
    { betrag: 0, laden: null, quelle: 'unbekannt', geschaetzt: true, packungen: null });
  assert.equal(kostenFuer('xyz', [teil(1, 'kg')], ['lidl'], { ...opt, abteilung: 'haushalt' }).quelle, 'unbekannt');
});

test('kostenFuerZeilen: Liste aus berechneListe mit Teil-Abhaken, eigenem Eintrag und Vorrat', () => {
  const rezept = { id: 'r1', title: 'Nudeln mit Tomaten', servings: 2,
    ingredients: parseZeilen('500 g Nudeln\n1 Dose gehackte Tomaten (400 g)\n1 Zwiebel\nSalz') };
  const runde = { id: 't1', from: '2026-10-19', to: '2026-10-25', closedAt: null };
  const planEintraege = [{ id: 'p1', date: '2026-10-20', slot: 'abend', recipeId: 'r1', servings: 4, tripId: null }];
  const manuelle = [{ id: 'm1', kind: 'manual', name: 'Bananen', qty: 5, qty2: null, unit: null, checked: false },
    { id: 'm2', kind: 'manual', name: 'Reis', qty: 1, unit: 'kg', checked: true }];
  // 1000 g Nudeln, davon 600 g schon abgehakt → Rest 400 g = eine Packung
  const zustaende = [{ id: 't1|nudel', kind: 'state', tripId: 't1', mergeKey: 'nudel', abgehakt: { g: 600 }, erledigt: true }];
  const liste = berechneListe({ planEintraege, rezepte: [rezept], manuelle, zustaende, runde, vorrat: ['salz'] });
  const k = kostenFuerZeilen(liste, ['lidl', 'rewe'], opt);
  assert.equal(k.proZeile.get('nudel').betrag, 1);
  assert.equal(k.proZeile.get('tomate, gehackt').betrag, 1);
  assert.equal(k.proZeile.get('zwiebel').betrag, 1);
  assert.equal(k.proZeile.get('manuell:m1').betrag, 2); // 5 × 200 g lose
  assert.equal(k.proZeile.has('manuell:m2'), false); // abgehakt
  assert.equal(k.proZeile.has('salz'), false); // Vorrat
  assert.equal(k.gesamt, 5);
  assert.deepEqual(k.proLaden, { lidl: 5, rewe: 0 });
  assert.deepEqual(k.proZeile.get('zwiebel'), { betrag: 1, laden: 'lidl', geschaetzt: true, quelle: 'tabelle' });
  // eigener Preis für einen eigenen Eintrag (über seinen mergeKey) und für eine Rezept-Zeile bei Rewe
  const eigenePreise = { 'manuell:m1': { alle: { preis: 0.25, menge: 1, einheit: 'Stück' } },
    zwiebel: { rewe: { preis: 0.2, menge: 1000, einheit: 'g' } } };
  const k2 = kostenFuerZeilen(liste.abteilungen.flatMap((a) => a.zeilen), ['lidl', 'rewe'], { ...opt, eigenePreise });
  assert.deepEqual(k2.proZeile.get('manuell:m1'), { betrag: 1.25, laden: 'lidl', geschaetzt: false, quelle: 'eigen' });
  assert.deepEqual(k2.proZeile.get('zwiebel'), { betrag: 0.2, laden: 'rewe', geschaetzt: false, quelle: 'eigen' });
  assert.deepEqual(k2.proLaden, { lidl: 3.25, rewe: 0.2 });
  assert.equal(k2.gesamt, 3.45);
});

test('kostenFuerZeilen: erledigt, versteckt, Vorrat und leerer Rest zählen nicht; ungenaue Zeile = eine Packung', () => {
  const zeilen = [
    { mergeKey: 'reis', name: 'Reis', teile: [teil(500, 'g')], rest: [teil(500, 'g')], abteilung: 'nudeln-reis' },
    { mergeKey: 'nudel', name: 'Nudeln', teile: [teil(500, 'g')], rest: [], erledigt: true },
    { mergeKey: 'mais', name: 'Mais', teile: [teil(1, 'Dose')], rest: [], erledigt: false },
    { mergeKey: 'zucker', name: 'Zucker', teile: [teil(1, 'kg')], rest: [teil(1, 'kg')], imVorrat: true },
    { mergeKey: 'ei', name: 'Eier', teile: [teil(2, 'Stück')], rest: [teil(2, 'Stück')], versteckt: true },
    { mergeKey: 'petersilie', name: 'Petersilie', teile: [], rest: [], vage: true, abteilung: 'obst-gemuese' },
    { mergeKey: 'quatsch', name: 'Quatsch', teile: [teil(1, 'Stück')], rest: [teil(1, 'Stück')], abteilung: 'sonstiges' },
  ];
  const k = kostenFuerZeilen(zeilen, ['lidl'], opt);
  assert.deepEqual([...k.proZeile.keys()], ['reis', 'mais', 'petersilie', 'quatsch']);
  assert.equal(k.proZeile.get('mais').betrag, 0);
  assert.equal(k.proZeile.get('petersilie').betrag, 0.9);
  assert.equal(k.proZeile.get('quatsch').quelle, 'unbekannt');
  assert.equal(k.gesamt, 2.9);
  assert.deepEqual(kostenFuerZeilen(null, ['lidl'], opt), { gesamt: 0, proLaden: { lidl: 0 }, proZeile: new Map() });
});

test('formatEuro und formatEuroGerundet', () => {
  assert.equal(formatEuro(12.34), '12,34 €');
  assert.equal(formatEuro(3.2), '3,20 €');
  assert.equal(formatEuro(0), '0,00 €');
  assert.equal(formatEuro(1234.5), '1.234,50 €');
  assert.equal(formatEuro(null), '');
  assert.equal(formatEuro('abc'), '');
  assert.equal(formatEuroGerundet(12.34), '≈ 12 €');
  assert.equal(formatEuroGerundet(64.5), '≈ 65 €');
  assert.equal(formatEuroGerundet(3.2), '≈ 3,20 €');
  assert.equal(formatEuroGerundet(1234.4), '≈ 1.234 €');
  assert.equal(formatEuroGerundet(undefined), '');
});

test('echte Preistabelle: gültiges Format, jede Zeile über ihren Schlüssel auffindbar', () => {
  assert.match(PREIS_STAND, /^\d{4}-\d{2}$/);
  const einheiten = new Set(['g', 'ml', 'Stück', 'Bund', 'Packung', 'Becher', 'Glas', 'Dose', 'Scheibe', 'Zehe', 'Stange',
    'Rolle', 'Schale', 'Flasche', 'Tafel', 'Kopf', 'Knolle', 'Topf', 'Würfel']);
  const optionen = new Set(['stueckGewicht', 'lose', 'dichte', 'vorrat', 'container', 'laeden']);
  const gesehen = new Set();
  for (const z of PREISE) {
    const [k, preis, menge, einheit, o = {}] = z;
    assert.ok(typeof k === 'string' && k === k.trim().toLowerCase() && k.length > 0, `Schlüssel ${k}`);
    assert.ok(!gesehen.has(k), `doppelt: ${k}`);
    gesehen.add(k);
    assert.ok(Number.isFinite(preis) && preis >= 0 && preis < 100, `Preis ${k}`);
    assert.ok(Number.isFinite(menge) && menge > 0, `Menge ${k}`);
    assert.ok(einheiten.has(einheit), `Einheit ${k}: ${einheit}`);
    assert.ok(z.length <= 5 && o && typeof o === 'object', `Optionen ${k}`);
    for (const name of Object.keys(o)) assert.ok(optionen.has(name), `Option ${k}: ${name}`);
    if (o.stueckGewicht != null) assert.ok(o.stueckGewicht > 0, `stueckGewicht ${k}`);
    if (o.dichte != null) assert.ok(o.dichte > 0 && o.dichte < 3, `dichte ${k}`);
    assert.equal(findePreis(k).schluessel, k, `nicht auffindbar: ${k}`);
  }
  assert.ok(PREISE.length >= 50);
  for (const l of LAEDEN) assert.ok(LADEN_FAKTOR[l.id] >= 0.8 && LADEN_FAKTOR[l.id] <= 1.5, l.id);
  const abteilungen = new Set(ABTEILUNGEN.map((a) => a.id));
  for (const [id, k] of Object.entries(KATEGORIE_SCHAETZUNG)) {
    assert.ok(abteilungen.has(id), id);
    assert.ok(['proKg', 'proStueck', 'pauschal'].some((f) => k[f] > 0), id);
  }
  for (const k of ['salz', 'pfeffer', 'wasser']) assert.equal(findePreis(k)?.vorrat, true, k);
});

test('kostenFuer: gezählte Packungen, Flaschen und Kugeln zählen einzeln, wenn sie sich nicht umrechnen lassen', () => {
  assert.deepEqual([kostenFuer('nudel', [teil(2, 'Packung')], ['lidl'], opt).betrag,
    kostenFuer('nudel', [teil(2, 'Packung')], ['lidl'], opt).packungen], [2, 2]);
  assert.equal(kostenFuer('milch', [teil(3, 'Flasche')], ['lidl'], opt).betrag, 3);
  assert.equal(kostenFuer('mozzarella', [teil(2, 'Kugel')], ['lidl'], opt).betrag, 1.6);
  // zusammen mit Umrechenbarem: 500 g + 1 Packung = 2 Packungen
  assert.equal(kostenFuer('nudel', [teil(500, 'g'), teil(1, 'Packung')], ['lidl'], opt).betrag, 2);
  // im Rezept: Stück ohne Stückgewicht und Stangen bleiben eine Packung ('3 Stangen Staudensellerie' = 1 Staude)
  assert.equal(kostenFuer('nudel', [teil(2, 'Stück')], ['lidl'], opt).betrag, 1);
  assert.equal(kostenFuer('staudensellerie', [teil(3, 'Stange')], ['lidl'], opt).betrag, 1.3);
  // umrechenbare Behälter bleiben wie bisher ('1 Dose Mais' = eine Packung)
  assert.equal(kostenFuer('mais', [teil(2, 'Dose')], ['lidl'], opt).betrag, 1.8);
});

test('kostenFuer: jeLaden liefert den Betrag in jedem Laden', () => {
  const k = kostenFuer('reis', [teil(500, 'g')], ['rewe', 'lidl'], { ...opt, jeLaden: true });
  assert.deepEqual(k, { betrag: 2, laden: 'lidl', quelle: 'tabelle', geschaetzt: true, packungen: 1,
    jeLaden: { rewe: 3, lidl: 2 } });
  assert.equal('jeLaden' in kostenFuer('reis', [teil(500, 'g')], ['rewe', 'lidl'], opt), false);
});

test('verteileLaeden: gleich teure Zeilen in den Hauptladen, echte Ersparnis bleibt im anderen Laden', () => {
  const posten = [
    { betrag: 0.9, laden: 'rewe', jeLaden: { rewe: 0.9, aldi: 0.9 } }, // gleich teuer
    { betrag: 2, laden: 'aldi', jeLaden: { rewe: 3, aldi: 2 } },
    { betrag: 1.5, laden: 'rewe', jeLaden: { rewe: 1.5, aldi: 2 } }, // bei Rewe wirklich günstiger
    { betrag: 0, laden: null },
  ];
  assert.deepEqual(verteileLaeden(posten, ['rewe', 'aldi']), ['aldi', 'aldi', 'rewe', null]);
  assert.deepEqual(verteileLaeden([], ['lidl']), []);
  assert.deepEqual(verteileLaeden(null, ['lidl']), []);
});

test('kostenFuerZeilen: kein zweiter Laden ohne Ersparnis, egal in welcher Reihenfolge die Läden gewählt sind', () => {
  const zeilen = [
    { mergeKey: 'spaghetti', name: 'Spaghetti', teile: [teil(500, 'g')], rest: [teil(500, 'g')] },
    { mergeKey: 'reis', name: 'Reis', teile: [teil(1, 'kg')], rest: [teil(1, 'kg')] },
  ];
  for (const laeden of [['rewe', 'lidl'], ['lidl', 'rewe']]) {
    const k = kostenFuerZeilen(zeilen, laeden, opt);
    assert.deepEqual(k.proLaden, { rewe: 0, lidl: 2.9 }, laeden.join());
    assert.equal(k.proZeile.get('spaghetti').laden, 'lidl');
  }
  // ein eigener Preis macht Rewe für Reis günstiger: Rewe ist dann der Hauptladen, die gleich teuren Spaghetti
  // kommen mit; mit teurerer Butter bei Rewe bleibt die Butter bei Lidl
  const eigenePreise = { reis: { rewe: { preis: 1, menge: 1, einheit: 'kg' } } };
  const k = kostenFuerZeilen(zeilen, ['lidl', 'rewe'], { ...opt, eigenePreise });
  assert.deepEqual([k.proZeile.get('reis').laden, k.proZeile.get('spaghetti').laden], ['rewe', 'rewe']);
  assert.deepEqual(k.proLaden, { lidl: 0, rewe: 1.9 });
  const butter = [...zeilen, { mergeKey: 'butter', name: 'Butter', teile: [teil(250, 'g')], rest: [teil(250, 'g')] }];
  const teurer = { ...eigenePreise, butter: { rewe: { preis: 2.5, menge: 250, einheit: 'g' } } };
  const k2 = kostenFuerZeilen(butter, ['lidl', 'rewe'], { ...opt, eigenePreise: teurer });
  assert.deepEqual([...k2.proZeile.values()].map((z) => z.laden), ['rewe', 'rewe', 'lidl']);
});

test('kostenFuerZeilen: eigene Einträge – „2 Butter“ sind zwei Packungen, Grundvorrat wird gekauft', () => {
  const manuell = (id, name, qty, unit = null) => ({ id, kind: 'manual', name, qty, qty2: null, unit, checked: false });
  const runde = { id: 't1', from: '2026-10-19', to: '2026-10-25', closedAt: null };
  const manuelle = [manuell('m1', 'Butter', 2), manuell('m2', 'Milch', 3), manuell('m3', 'Spaghetti', 2, 'Pck.'),
    manuell('m4', 'Salz', null), manuell('m5', 'Wasser', 6), manuell('m6', 'Zwiebeln', 3)];
  const liste = berechneListe({ manuelle, runde });
  const k = kostenFuerZeilen(liste, ['lidl'], opt);
  const betrag = (id) => k.proZeile.get(`manuell:${id}`);
  assert.equal(betrag('m1').betrag, 4); // 2 × 250 g
  assert.equal(betrag('m2').betrag, 3); // 3 × 1 l
  assert.equal(betrag('m3').betrag, 1.8);
  assert.deepEqual([betrag('m4').betrag, betrag('m4').quelle], [0.4, 'tabelle']);
  assert.equal(betrag('m5').betrag, 1.2); // 'Wasser' auf der Liste = Mineralwasser
  assert.equal(betrag('m6').betrag, 1); // Stückgewicht bekannt: 300 g → eine Packung
  // auch mit 'wasser' im eigenen Vorrat (Leitungswasser fürs Kochen): ein eigener Eintrag wird gekauft
  assert.equal(kostenFuerZeilen(liste, ['lidl'], { ...opt, vorrat: ['wasser'] }).proZeile.get('manuell:m5').betrag, 1.2);
  // Rezept-Zeilen dagegen: Grundvorrat kostet nichts
  const rezept = { id: 'r1', title: 'Nudeln', servings: 2, ingredients: parseZeilen('250 g Nudeln\n1 TL Salz') };
  const planEintraege = [{ id: 'p1', date: '2026-10-20', slot: 'abend', recipeId: 'r1', servings: 2, tripId: null }];
  const mitRezept = kostenFuerZeilen(berechneListe({ planEintraege, rezepte: [rezept], runde }), ['lidl'], opt);
  assert.deepEqual([mitRezept.proZeile.get('salz').betrag, mitRezept.proZeile.get('salz').quelle], [0, 'vorrat']);
});
