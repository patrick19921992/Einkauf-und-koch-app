import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ImportFehler, findeUrl, textOhneUrl, extrahiereJsonLd, parseJsonLdBloecke, findeRezeptKnoten, parseDauer,
  parsePortionen, dekodiereEntities, rezeptAusJsonLd, rezeptAusText, findeTimer, ladeRezept, importFehler,
} from '../js/rezept-import.js';

// Kurze, erfundene Rezept-Knoten (keine echten Seiten)
const rezept = (mehr = {}) => ({
  '@context': 'https://schema.org', '@type': 'Recipe', name: 'Testnudeln',
  recipeIngredient: ['200 g Nudeln', '1 Prise Salz'], recipeInstructions: 'Nudeln kochen.', ...mehr,
});
const skript = (json, attr = 'type="application/ld+json"') => `<script ${attr}>${json}</script>`;
const texte = (r) => r.steps.map((s) => s.text);

test('findeUrl: erster Link, Satzzeichen am Ende weg', () => {
  const share = 'Schau dir dieses Rezept an: Spaghetti Carbonara https://www.chefkoch.de/rezepte/123/Spaghetti.html';
  assert.equal(findeUrl(share), 'https://www.chefkoch.de/rezepte/123/Spaghetti.html');
  assert.equal(findeUrl('https://share.google/AbC123'), 'https://share.google/AbC123');
  assert.equal(findeUrl(null, '', 'Hier: https://www.lecker.de/x-123.html.'), 'https://www.lecker.de/x-123.html');
  assert.equal(findeUrl('(siehe https://rewe.de/rezepte/a)!'), 'https://rewe.de/rezepte/a');
  assert.equal(findeUrl('»https://kochbar.de/r/1«'), 'https://kochbar.de/r/1');
  assert.equal(findeUrl('https://de.wikipedia.org/wiki/Pesto_(Sauce)'), 'https://de.wikipedia.org/wiki/Pesto_(Sauce)');
  assert.equal(findeUrl('Titel', 'http://beispiel.de/a?b=1&c=2;'), 'http://beispiel.de/a?b=1&c=2');
  assert.equal(findeUrl('kein Link', 'ftp://x.de/y', 'www.chefkoch.de'), null);
  assert.equal(findeUrl(), null);
});

test('textOhneUrl: Android-Teilen-Texte', () => {
  const url = 'https://www.chefkoch.de/rezepte/123/Spaghetti.html';
  assert.equal(textOhneUrl(`Schau dir dieses Rezept an: Spaghetti Carbonara ${url}`, url),
    'Schau dir dieses Rezept an: Spaghetti Carbonara');
  assert.equal(textOhneUrl('https://share.google/AbC123', 'https://share.google/AbC123'), '');
  assert.equal(textOhneUrl(`Zeile 1\n${url}\n\n\n\nZeile 2  `, url), 'Zeile 1\n\nZeile 2');
  assert.equal(textOhneUrl('  nur Text ', null), 'nur Text');
});

test('extrahiereJsonLd: Attribute, Anführungszeichen, Kommentare, ungültige Blöcke', () => {
  const html = [
    '<html><head>',
    skript('{"@type":"Organization","name":"A"}'),
    skript('  {"@type":"Recipe","name":"B"}  ', "data-x='1' type = 'application/ld+json'"),
    skript('{"name":"C"}', 'type=application/ld+json id=x'),
    skript('<!--{"name":"D"}-->', 'type="application/ld+json; charset=utf-8"'),
    skript('/*<![CDATA[*/{"name":"E"}/*]]>*/', 'type="application/ld+json"'),
    skript('{"name": kaputt}'),
    skript('{"name":"kein JSON-LD"}', 'type="application/json"'),
    '<SCRIPT TYPE="application/ld+json">[{"name":"F"},{"name":"G"}]</SCRIPT >',
    '</head></html>',
  ].join('\n');
  const objekte = extrahiereJsonLd(html);
  assert.deepEqual(objekte.map((o) => (Array.isArray(o) ? o.map((x) => x.name).join('') : o.name)),
    ['A', 'B', 'C', 'D', 'E', 'FG']);
  assert.deepEqual(extrahiereJsonLd(''), []);
  assert.deepEqual(extrahiereJsonLd(null), []);
});

test('parseJsonLdBloecke: rohe Steuerzeichen in Strings', () => {
  const nl = String.fromCharCode(10);
  const tab = String.fromCharCode(9);
  const roh = `{"@type":"Recipe","name":"Kuchen${tab}fein","recipeInstructions":"Teig rühren.${nl}Backen."}`;
  assert.throws(() => JSON.parse(roh));
  const [o] = parseJsonLdBloecke([roh, '{kaputt', 42, null]);
  assert.equal(o.name, 'Kuchen fein');
  assert.deepEqual(texte(rezeptAusJsonLd(o)), ['Teig rühren.', 'Backen.']);
  assert.equal(parseJsonLdBloecke(['{"a":1}', { b: 2 }]).length, 2);
  assert.deepEqual(parseJsonLdBloecke(undefined), []);
});

test('findeRezeptKnoten: alle Hüllen und @type-Varianten', () => {
  const r = rezept();
  const faelle = {
    objekt: [r],
    'Array oben': [[{ '@type': 'WebSite' }, r]],
    '@graph': [{ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': 'Person' }, r] }],
    'WebPage.mainEntity': [{ '@type': 'WebPage', mainEntity: r }],
    mainEntityOfPage: [{ '@type': 'Article', mainEntityOfPage: { '@type': 'WebPage', mainEntity: [r] } }],
    ItemList: [{ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, item: r }] }],
  };
  for (const [name, objekte] of Object.entries(faelle)) assert.equal(findeRezeptKnoten(objekte), r, name);
  const mehrfach = { ...r, '@type': ['Recipe', 'NewsArticle'] };
  assert.equal(findeRezeptKnoten([mehrfach]), mehrfach);
  const mitPraefix = { ...r, '@type': 'http://schema.org/Recipe' };
  assert.equal(findeRezeptKnoten([mitPraefix]), mitPraefix);
  // Rezept ohne Zutaten (z. B. Bewertungs-Verweis) nur, wenn es kein besseres gibt
  const leer = { '@type': 'Recipe', name: 'Verweis' };
  assert.equal(findeRezeptKnoten([leer, { '@type': 'WebPage', mainEntity: r }]), r);
  assert.equal(findeRezeptKnoten([leer]), leer);
  assert.equal(findeRezeptKnoten([{ '@type': 'WebPage' }, { '@type': 'HowTo' }]), null);
  assert.equal(findeRezeptKnoten([]), null);
  const zyklus = { '@type': 'WebPage' };
  zyklus.selbst = zyklus;
  assert.equal(findeRezeptKnoten([zyklus]), null);
});

test('parseDauer: ISO-Dauern und Sonderfälle', () => {
  const faelle = [['PT1H25M', 85], ['P0DT1H25M', 85], ['PT260M', 260], ['PT0M', null], ['PT90S', 2], ['', null],
    [null, null], ['PT30M', 30], ['P0Y0M0DT0H35M0.000S', 35], ['pt1h', 60], ['P1D', 1440], ['P30M', 30],
    [45, 45], ['20', 20], ['30 Min.', 30], ['1 Std. 20 Min.', 80], ['unbekannt', null], [-5, null]];
  for (const [ein, aus] of faelle) assert.equal(parseDauer(ein), aus, String(ein));
});

test('parsePortionen: erste Zahl', () => {
  const faelle = [['4', 4], [4, 4], [['4', '4 Portionen'], 4], ['4 Portionen', 4], ['Für 6 Personen', 6], ['2-3', 2],
    ['Personen 4', 4], ['1,5 Liter', 1.5], ['', null], [null, null], [[], null], ['viele', null], [0, null], [[null, '3'], 3]];
  for (const [ein, aus] of faelle) assert.equal(parsePortionen(ein), aus, JSON.stringify(ein));
});

test('dekodiereEntities: Entitäten und Tags', () => {
  assert.equal(dekodiereEntities('L&ouml;ffel &amp; Gabel'), 'Löffel & Gabel');
  assert.equal(dekodiereEntities('&quot;a&quot; &#39;b&#39; &apos;c&apos; &lt;3 &gt;'), '"a" \'b\' \'c\' <3 >');
  assert.equal(dekodiereEntities('&Auml;&Ouml;&Uuml;&auml;&uuml;&szlig; &eacute;&egrave;'), 'ÄÖÜäüß éè');
  assert.equal(dekodiereEntities('&frac12; &frac14; &frac34; 180&deg;C 1&ndash;2 &mdash;'), '½ ¼ ¾ 180°C 1–2 —');
  assert.equal(dekodiereEntities('&#228;&#xE4;&#xe4; &#8211; &#150;'), 'äää – –');
  assert.equal(dekodiereEntities('1&nbsp;kg'), '1 kg');
  assert.equal(dekodiereEntities('Erst<br>dann<br/>zuletzt<BR />'), 'Erst\ndann\nzuletzt');
  assert.equal(dekodiereEntities('<p>Absatz 1</p><p>Absatz <b>2</b></p>'), 'Absatz 1\n\nAbsatz 2');
  assert.equal(dekodiereEntities('&lt;p&gt;kodiertes HTML&lt;/p&gt;'), 'kodiertes HTML');
  assert.equal(dekodiereEntities('Salz &amp;amp; Pfeffer, Gr&amp;uuml;n'), 'Salz & Pfeffer, Grün');
  assert.equal(dekodiereEntities('a < b und &unbekannt; bleibt'), 'a < b und &unbekannt; bleibt');
  assert.equal(dekodiereEntities(null), '');
  assert.equal(dekodiereEntities(12), '12');
});

test('rezeptAusJsonLd: Felder, Bild, Zeiten, Tags, Zutaten', () => {
  const r = rezeptAusJsonLd(rezept({
    name: ' Gem&uuml;se-Curry ', recipeYield: ['4', '4 Portionen'], prepTime: 'PT15M', cookTime: 'PT30M',
    image: [{ '@type': 'ImageObject', url: 'https://img.example.de/curry.jpg' }, 'https://img.example.de/b.jpg'],
    recipeCategory: ['Hauptgericht', 'Vegetarisch'], recipeCuisine: 'Indisch',
    keywords: 'Curry, vegetarisch, schnell, einfach, Reis, Gemüse, Kokos, Herbst, Winter',
    recipeIngredient: ['500 g Kartoffeln', '1 Dose Kokosmilch (400 ml)', 'Salz und Pfeffer', '2 EL &Ouml;l'],
  }), 'https://www.chefkoch.de/rezepte/1/curry.html');
  assert.equal(r.title, 'Gemüse-Curry');
  assert.equal(r.sourceUrl, 'https://www.chefkoch.de/rezepte/1/curry.html');
  assert.equal(r.sourceSite, 'chefkoch.de');
  assert.equal(r.imageUrl, 'https://img.example.de/curry.jpg');
  assert.deepEqual([r.servings, r.prepMin, r.cookMin, r.totalMin], [4, 15, 30, 45]);
  assert.deepEqual(r.tags, ['Hauptgericht', 'Vegetarisch', 'Indisch', 'Curry', 'schnell', 'einfach', 'Reis', 'Gemüse']);
  assert.equal(r.notes, '');
  assert.equal(r.favorite, false);
  assert.equal(r.ingredients.length, 4);
  assert.ok(r.ingredients.every((z) => z.id && z.group === null));
  assert.deepEqual([r.ingredients[0].qty, r.ingredients[0].unit, r.ingredients[0].name], [500, 'g', 'Kartoffeln']);
  assert.equal(r.ingredients[1].note, '400 ml');
  assert.equal(r.ingredients[2].vague, true);
  assert.equal(r.ingredients[3].name, 'Öl');
  // Gesamtzeit hat Vorrang; Bild als String, als Objekt, relativ
  const b = rezeptAusJsonLd(rezept({ totalTime: 'PT1H', prepTime: 'PT10M', image: '/bilder/a.jpg' }), 'https://www.rewe.de/r/1');
  assert.equal(b.totalMin, 60);
  assert.equal(b.imageUrl, 'https://www.rewe.de/bilder/a.jpg');
  assert.equal(rezeptAusJsonLd(rezept({ image: { url: '//cdn.example.de/x.jpg' } })).imageUrl, 'https://cdn.example.de/x.jpg');
  assert.equal(rezeptAusJsonLd(rezept({ image: 'javascript:alert(1)' })).imageUrl, '');
  // ohne Quelle: url des Knotens; ohne alles: leere Werte
  assert.equal(rezeptAusJsonLd(rezept({ url: 'https://www.lecker.de/a.html' })).sourceSite, 'lecker.de');
  const leer = rezeptAusJsonLd(null);
  assert.deepEqual([leer.title, leer.sourceUrl, leer.servings, leer.totalMin, leer.ingredients, leer.steps],
    ['', '', null, null, [], []]);
});

test('rezeptAusJsonLd: Zutaten-Gruppen, Fortsetzungen und zerlegte Zeilen', () => {
  const r = rezeptAusJsonLd(rezept({
    recipeIngredient: ['Für den Teig:', '250 g Mehl', '1 Rolle Blätterteig (rechteckig', 'oder 2 runde)',
      '250 g Rindfleisch', ' in Stücken', 'Für die Soße:', '200 ml Sahne', 'oder Kochsahne'],
  }));
  assert.deepEqual(r.ingredients.map((z) => [z.group, z.name]), [
    ['Für den Teig', 'Mehl'], ['Für den Teig', 'Blätterteig'], ['Für den Teig', 'Rindfleisch'], ['Für die Soße', 'Sahne']]);
  assert.equal(r.ingredients[2].note, 'in Stücken');
  assert.match(r.ingredients[3].note, /Kochsahne/);
});

test('rezeptAusJsonLd: alle Formen von recipeInstructions', () => {
  const schritte = (wert) => rezeptAusJsonLd(rezept({ recipeInstructions: wert })).steps;
  // Text mit Zeilenumbrüchen
  assert.deepEqual(schritte('Zwiebeln schälen.\r\n Anbraten.\r\n\r\n Servieren. ').map((s) => s.text),
    ['Zwiebeln schälen.', 'Anbraten.', 'Servieren.']);
  // nummeriert in einer Zeile, HTML und verschluckte Absätze
  assert.deepEqual(schritte('1. Ofen vorheizen. 2. Teig rühren. 3. Backen.').map((s) => s.text),
    ['Ofen vorheizen.', 'Teig rühren.', 'Backen.']);
  assert.deepEqual(schritte('<p>Erst schneiden.</p><p>Dann braten.</p>').map((s) => s.text), ['Erst schneiden.', 'Dann braten.']);
  assert.deepEqual(schritte('Fein schneiden.Öl erhitzen. Alles mischen.').map((s) => s.text),
    ['Fein schneiden.', 'Öl erhitzen. Alles mischen.']);
  // Liste von Strings; leere und reine Nummern fallen weg
  assert.deepEqual(schritte(['Schritt 1: Wasser kochen.', '', '2', '2) Nudeln garen.']).map((s) => s.text),
    ['Wasser kochen.', 'Nudeln garen.']);
  // HowToStep mit text oder nur name; Zahl als name wird ignoriert
  assert.deepEqual(schritte([{ '@type': 'HowToStep', name: 1, text: 'A &amp; B mischen.' },
    { '@type': 'HowToStep', name: 'Nur Name.' }, { '@type': 'HowToStep', text: '  ' }]).map((s) => s.text),
  ['A & B mischen.', 'Nur Name.']);
  // HowToSection: name → Gruppe ('Zubereitung' zählt nicht), verschachtelte Arrays
  const s = schritte([
    { '@type': 'HowToSection', name: 'Zubereitung', itemListElement: [{ '@type': 'HowToStep', text: 'Vorbereiten.' }] },
    { '@type': 'HowToSection', name: 'Teig', itemListElement: [[{ '@type': 'HowToStep', text: 'Kneten.' }], 'Ruhen lassen.'] },
    [{ '@type': 'HowToSection', name: 'Füllung:', itemListElement: { '@type': 'HowToStep', text: 'Füllen.' } }],
  ]);
  assert.deepEqual(s.map((x) => [x.group, x.text]),
    [[null, 'Vorbereiten.'], ['Teig', 'Kneten.'], ['Teig', 'Ruhen lassen.'], ['Füllung', 'Füllen.']]);
  assert.ok(s.every((x) => typeof x.id === 'string' && x.id));
  // HowToStep mit HowToDirection-Liste und Gruppen-Zeilen im Text
  assert.deepEqual(schritte({ '@type': 'HowToStep', name: '1', itemListElement: { '@type': 'HowToDirection', text: 'Rühren.' } })
    .map((x) => x.text), ['Rühren.']);
  assert.deepEqual(schritte('Für die Soße:\nSahne erhitzen.').map((x) => [x.group, x.text]), [['Für die Soße', 'Sahne erhitzen.']]);
  assert.deepEqual(schritte(undefined), []);
});

test('Android-Teilen: Link und Titel', () => {
  const geteilt = 'Schau dir dieses Rezept an: Spaghetti Carbonara https://www.chefkoch.de/rezepte/123/Spaghetti.html';
  const url = findeUrl(geteilt);
  const r = rezeptAusText(textOhneUrl(geteilt, url), { quelleUrl: url });
  assert.equal(r.title, 'Spaghetti Carbonara');
  assert.equal(r.sourceSite, 'chefkoch.de');
  assert.deepEqual([r.ingredients, r.steps], [[], []]);
  const kurz = 'https://share.google/AbC123';
  assert.equal(findeUrl(kurz), kurz);
  const leer = rezeptAusText(textOhneUrl(kurz, findeUrl(kurz)));
  assert.deepEqual([leer.title, leer.ingredients.length, leer.steps.length], ['', 0, 0]);
});

test('rezeptAusText: mit Überschriften', () => {
  const text = [
    'Omas Pfannkuchen', 'https://www.example.de/pfannkuchen', 'Zubereitungszeit: 20 Min.', 'Schwierigkeit: einfach',
    '', '## Zutaten für 4 Portionen:', '▢ 250 g Mehl', '• 3 Eier', '- 500 ml Milch', '* 1 Prise Salz', 'Für die Füllung:',
    '☐ 2 EL Marmelade', '', 'Zubereitung', '1. Mehl, Eier und Milch verrühren.', 'Schritt 2', 'Den Teig 10 Minuten ruhen lassen.',
    '3) In der Pfanne ausbacken.', 'Tipps:', 'Schmeckt auch mit Zimt.',
  ].join('\n');
  const r = rezeptAusText(text, { quelleUrl: 'https://www.example.de/pfannkuchen' });
  assert.equal(r.title, 'Omas Pfannkuchen');
  assert.equal(r.servings, 4);
  assert.equal(r.prepMin, 20);
  assert.deepEqual(r.ingredients.map((z) => [z.group, z.qty, z.unit, z.name]), [
    [null, 250, 'g', 'Mehl'], [null, 3, null, 'Eier'], [null, 500, 'ml', 'Milch'], [null, 1, 'Prise', 'Salz'],
    ['Für die Füllung', 2, 'EL', 'Marmelade']]);
  assert.deepEqual(texte(r), ['Mehl, Eier und Milch verrühren.', 'Den Teig 10 Minuten ruhen lassen.', 'In der Pfanne ausbacken.']);
  assert.equal(r.notes, 'Schmeckt auch mit Zimt.');
  assert.equal(r.sourceSite, 'example.de');
  // Varianten der Überschriften; 'Zutaten für den Teig' wird Gruppe; Titel-Vorgabe gewinnt
  const v = rezeptAusText('**ZUTATEN (für 2 Personen)**\n100 g Reis\nZutaten für den Teig\n50 g Butter\nSo geht\'s:\nKochen.\nAnleitung\nEssen.',
    { titel: 'Reis' });
  assert.deepEqual([v.title, v.servings], ['Reis', 2]);
  assert.deepEqual(v.ingredients.map((z) => [z.group, z.name]), [[null, 'Reis'], ['Für den Teig', 'Butter']]);
  assert.deepEqual(texte(v), ['Kochen.', 'Essen.']);
});

test('rezeptAusText: ohne Überschriften', () => {
  const text = [
    'Schnelle Tomatensoße', 'Ein einfaches Rezept für jeden Tag, das allen schmeckt.', 'Für 2 Portionen',
    '1 Dose Tomaten (400 g)', '1 Zwiebel', '2 EL Olivenöl', 'Salz', 'etwas Basilikum',
    'Die Zwiebel fein würfeln und im Öl glasig dünsten.', 'Tomaten dazugeben und 15 Minuten köcheln lassen.',
    'Mit Salz abschmecken.',
  ].join('\n');
  const r = rezeptAusText(text);
  assert.equal(r.title, 'Schnelle Tomatensoße');
  assert.equal(r.servings, 2);
  assert.deepEqual(r.ingredients.map((z) => z.name), ['Tomaten', 'Zwiebel', 'Olivenöl', 'Salz', 'Basilikum']);
  assert.deepEqual(texte(r), ['Die Zwiebel fein würfeln und im Öl glasig dünsten.',
    'Tomaten dazugeben und 15 Minuten köcheln lassen.', 'Mit Salz abschmecken.']);
  // nur Sätze → Schritte; Gruppen-Zeile wird nicht zum Titel
  assert.deepEqual(texte(rezeptAusText('Den Ofen auf 200 Grad vorheizen.\nAlles in eine Form geben und backen.')),
    ['Den Ofen auf 200 Grad vorheizen.', 'Alles in eine Form geben und backen.']);
  const g = rezeptAusText('Teig:\n200 g Mehl\n1 Ei\nAlles zu einem glatten Teig verkneten.');
  assert.deepEqual([g.title, g.ingredients[0].group, g.steps.length], ['', 'Teig', 1]);
  assert.deepEqual(rezeptAusText('').ingredients, []);
  // kopierte Tabelle: Menge und Zutat auf getrennten Zeilen; Portionen im Titel
  const t = rezeptAusText('Kartoffelsalat für 4 Personen\n800 g\nKartoffeln\n1\nZwiebel\netwas\nSalz\nKartoffeln kochen und in Scheiben schneiden.');
  assert.deepEqual([t.title, t.servings], ['Kartoffelsalat', 4]);
  assert.deepEqual(t.ingredients.map((z) => [z.qty, z.unit, z.name]), [[800, 'g', 'Kartoffeln'], [1, null, 'Zwiebel'],
    [null, null, 'Salz']]);
  // eine einzelne Zahl vor einer Zeile mit eigener Menge wird nicht angehängt
  assert.deepEqual(rezeptAusText('Zutaten\n4\n2 Eier').ingredients.map((z) => z.raw), ['4', '2 Eier']);
});

test('rezeptAusText: kopierte Rezeptseite (Tabelle, Koch-/Backzeit, Grußformel)', () => {
  const text = [
    'Schneller Nudelauflauf', 'Portionen', '4', 'Arbeitszeit ca. 15 Minuten', 'Koch-/Backzeit ca. 25 Minuten',
    'Gesamtzeit ca. 40 Minuten', 'Zutaten', '500 g', 'Nudeln', '200 ml', 'Sahne', '2', 'Ei(er)', 'Zubereitung',
    'Die Nudeln bissfest kochen.', 'Alles in eine Form geben und 25 Minuten bei 200 °C backen.', 'Guten Appetit!',
  ].join('\n');
  const r = rezeptAusText(text);
  assert.deepEqual([r.title, r.servings, r.prepMin, r.cookMin, r.totalMin], ['Schneller Nudelauflauf', 4, 15, 25, 40]);
  assert.deepEqual(r.ingredients.map((z) => [z.qty, z.unit, z.name]), [[500, 'g', 'Nudeln'], [200, 'ml', 'Sahne'], [2, null, 'Eier']]);
  assert.deepEqual(texte(r), ['Die Nudeln bissfest kochen.', 'Alles in eine Form geben und 25 Minuten bei 200 °C backen.']);
  // 'Koch- und Backzeit: 1 Std.' ohne Gesamtzeit → Summe; 'Ruhezeit' zählt nicht
  const z = rezeptAusText('Brot\nVorbereitung: 20 Min.\nKoch- und Backzeit: 1 Std.\nRuhezeit: 2 Std.\nZutaten\n500 g Mehl');
  assert.deepEqual([z.prepMin, z.cookMin, z.totalMin], [20, 60, 80]);
  // 'Portionen' ohne Zahl danach bleibt ein normales Wort
  assert.equal(rezeptAusText('Zutaten\n500 g Mehl\nPortionen\nZubereitung\nKneten.').servings, null);
});

test('Ohne Portionsangabe: servings null (Formular fragt nach, statt still 1 Portion anzunehmen)', () => {
  // Mengen ohne Zahl im Text oder recipeYield dürfen nicht geraten werden; die Import-Ansicht
  // erkennt null, schlägt die Standard-Portionen vor und markiert das Feld
  const t = rezeptAusText('Omas Kartoffelsalat\n1 kg festkochende Kartoffeln\n1 Zwiebel\n250 ml Brühe\n\nKartoffeln kochen und pellen.');
  assert.deepEqual([t.title, t.servings, t.ingredients.length], ['Omas Kartoffelsalat', null, 3]);
  assert.equal(rezeptAusJsonLd(rezept()).servings, null);
  assert.equal(rezeptAusJsonLd(rezept({ recipeYield: '' })).servings, null);
  assert.equal(rezeptAusJsonLd(rezept({ recipeYield: '1 Blech' })).servings, 1);
});

test('findeTimer: Zeitangaben', () => {
  const t = (text) => findeTimer(text).map((x) => [x.label, x.sekunden]);
  assert.deepEqual(t('10 Minuten kochen'), [['10 Min.', 600]]);
  assert.deepEqual(t('10 Min. ruhen, dann 1 Std. backen'), [['10 Min.', 600], ['1 Std.', 3600]]);
  assert.deepEqual(t('1,5 Stunden schmoren'), [['1,5 Std.', 5400]]);
  assert.deepEqual(t('1 Stunde gehen lassen'), [['1 Std.', 3600]]);
  assert.deepEqual(t('30 Sekunden mixen'), [['30 Sek.', 30]]);
  assert.deepEqual(t('10-15 Minuten garen'), [['10–15 Min.', 900]]);
  assert.deepEqual(t('weitere 10 - 15 Minuten'), [['10–15 Min.', 900]]);
  assert.deepEqual(t('5 bis 8 Min. braten'), [['5–8 Min.', 480]]);
  assert.deepEqual(t('1 ½ Stunden'), [['1½ Std.', 5400]]);
  assert.deepEqual(t('eine halbe Stunde ziehen, zwei Minuten rühren'), [['30 Min.', 1800], ['2 Min.', 120]]);
  assert.deepEqual(t('1 Std. 20 Min. im Ofen'), [['1 Std. 20 Min.', 4800]]);
  assert.deepEqual(t('über Nacht kühlen, bei 180 Grad, 2 Tage ziehen, 3 Minzblätter'), []);
  assert.deepEqual(t('5 Min., 5 Minuten, 10 Min., 15 Min., 20 Min.'), [['5 Min.', 300], ['10 Min.', 600], ['15 Min.', 900]]);
  assert.deepEqual(t(''), []);
  assert.deepEqual(t(null), []);
});

// ---------------------------------------------------------------- ladeRezept mit gefälschtem fetch

const PROXY = 'https://import.example.workers.dev/';
const antwortMit = (daten, status = 200) =>
  async () => new Response(typeof daten === 'string' ? daten : JSON.stringify(daten), { status });
async function fehlerCode(promise) {
  try { await promise; } catch (e) { assert.ok(e instanceof ImportFehler, String(e)); return e.code; }
  assert.fail('kein Fehler');
}

test('ladeRezept: Erfolg über Weiterleitung', async () => {
  const aufrufe = [];
  const fetchFn = async (url, optionen) => {
    aufrufe.push({ url, optionen });
    return new Response(JSON.stringify({
      url: 'https://www.chefkoch.de/rezepte/123/Spaghetti.html', title: 'Spaghetti | Chefkoch',
      jsonld: ['{"@type":"WebSite"}', JSON.stringify({ '@graph': [rezept({ name: '' })] }), '{kaputt'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const r = await ladeRezept('https://share.google/AbC123', { proxyUrl: PROXY, fetchFn });
  assert.equal(aufrufe[0].url, `${PROXY}?url=${encodeURIComponent('https://share.google/AbC123')}`);
  assert.ok(aufrufe[0].optionen.signal);
  assert.equal(r.sourceUrl, 'https://www.chefkoch.de/rezepte/123/Spaghetti.html');
  assert.equal(r.sourceSite, 'chefkoch.de');
  assert.equal(r.title, 'Spaghetti | Chefkoch'); // Seitentitel, weil das Rezept keinen Namen hat
  assert.equal(r.ingredients.length, 2);
  assert.deepEqual(texte(r), ['Nudeln kochen.']);
  // Proxy ohne Schrägstrich und ohne https://
  await ladeRezept('https://www.chefkoch.de/x', { proxyUrl: 'import.example.workers.dev', fetchFn });
  assert.equal(aufrufe[1].url, `https://import.example.workers.dev?url=${encodeURIComponent('https://www.chefkoch.de/x')}`);
});

test('ladeRezept: Fehlerfälle', async () => {
  const url = 'https://www.chefkoch.de/rezepte/1/x.html';
  const lade = (fetchFn, mehr = {}) => ladeRezept(url, { proxyUrl: PROXY, fetchFn, ...mehr });
  let aufgerufen = false;
  const merker = async () => { aufgerufen = true; return new Response('{}'); };
  assert.equal(await fehlerCode(ladeRezept(url, { proxyUrl: '', fetchFn: merker })), 'kein-proxy');
  assert.equal(await fehlerCode(ladeRezept(url, { fetchFn: merker })), 'kein-proxy');
  assert.equal(await fehlerCode(ladeRezept(url, { proxyUrl: 'https://', fetchFn: merker })), 'kein-proxy');
  assert.equal(await fehlerCode(ladeRezept('kein Link', { proxyUrl: PROXY, fetchFn: merker })), 'ungueltig');
  assert.equal(aufgerufen, false);
  assert.equal(await fehlerCode(lade(antwortMit({ fehler: 'blockiert', status: 403 }, 403))), 'blockiert');
  assert.equal(await fehlerCode(lade(antwortMit('nicht erlaubt', 451))), 'blockiert');
  assert.equal(await fehlerCode(lade(antwortMit({ fehler: 'limit' }, 429))), 'limit');
  assert.equal(await fehlerCode(lade(antwortMit({ fehler: 'limit' }))), 'limit');
  assert.equal(await fehlerCode(lade(antwortMit('Too Many Requests', 429))), 'limit');
  assert.equal(await fehlerCode(lade(antwortMit({ fehler: 'upstream', status: 404 }, 502))), 'netz');
  assert.equal(await fehlerCode(lade(antwortMit('<html>Fehler</html>', 500))), 'netz');
  assert.equal(await fehlerCode(lade(antwortMit('<html>Not Found</html>', 404))), 'ungueltig');
  assert.equal(await fehlerCode(lade(antwortMit('<html>kein JSON</html>'))), 'ungueltig');
  assert.equal(await fehlerCode(lade(antwortMit('[1,2]'))), 'ungueltig');
  assert.equal(await fehlerCode(lade(antwortMit({ fehler: 'unbekannt' }, 400))), 'ungueltig');
  assert.equal(await fehlerCode(lade(antwortMit({ url, title: 'x', jsonld: ['{"@type":"WebPage"}'] }))), 'kein-rezept');
  assert.equal(await fehlerCode(lade(antwortMit({ url, title: 'x' }))), 'kein-rezept');
  const offline = await lade(async () => { throw new TypeError('Failed to fetch'); }).catch((x) => x);
  assert.deepEqual([offline.code, offline.grund], ['netz', 'nicht-erreichbar']);
  assert.match(offline.message, /nicht erreichbar.*Mehr → Import-Dienst/);
  // Gerät meldet „offline“ → eigene Meldung
  const navi = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    const aus = await lade(async () => { throw new TypeError('Failed to fetch'); }).catch((x) => x);
    assert.deepEqual([aus.code, aus.grund], ['netz', 'offline']);
    assert.match(aus.message, /offline/);
  } finally {
    if (navi) Object.defineProperty(globalThis, 'navigator', navi); else delete globalThis.navigator;
  }
  // Zeitüberschreitung: fetch hängt, bis abgebrochen wird
  const haengt = (_, { signal }) => new Promise((_ok, nein) => signal.addEventListener('abort', () => nein(new Error('abort'))));
  const e = await ladeRezept(url, { proxyUrl: PROXY, fetchFn: haengt, timeoutMs: 20 }).catch((x) => x);
  assert.deepEqual([e.code, e.grund], ['netz', 'zeit']);
  assert.match(e.message, /Zeitüberschreitung/);
});

test('ladeRezept: jede Fehler-Kennung des Import-Dienstes → eigener Code und verständliche Meldung', async () => {
  const url = 'https://www.example.org/rezept/1';
  // So antwortet proxy/worker.js (Status und Felder wie dort)
  const faelle = [
    [{ fehler: 'origin', meldung: 'Der Import-Dienst läuft, antwortet aber nur der App' }, 403, 'origin', /lehnt Anfragen dieser App ab.*ERLAUBTE_ORIGINS/],
    [{ fehler: 'host' }, 400, 'host', /„example\.org“ ist im Import-Dienst nicht freigeschaltet.*proxy\/worker\.js unter ERLAUBTE_HOSTS.*Rezepttext einfügen/],
    [{ fehler: 'host', host: 'www.boese.example' }, 400, 'host', /„www\.boese\.example“.*ERLAUBTE_HOSTS.*Rezepttext einfügen/],
    [{ fehler: 'blockiert', status: 401 }, 403, 'blockiert', /lässt das automatische Laden nicht zu.*als Text ein/],
    [{ fehler: 'url' }, 400, 'ungueltig', /nur vollständige https-Links/],
    [{ fehler: 'weiterleitungen' }, 502, 'ungueltig', /leitet zu oft weiter/],
    [{ fehler: 'methode' }, 405, 'ungueltig', /Anfrage abgelehnt.*Mehr → Import-Dienst/],
    [{ fehler: 'zu-gross' }, 413, 'kein-rezept', /zu groß.*als Text ein/],
    [{ fehler: 'kein-html' }, 415, 'kein-rezept', /keine Webseite/],
    [{ fehler: 'upstream', status: 404 }, 502, 'netz', /Webseite hat mit einem Fehler geantwortet \(HTTP 404\)/],
    [{ fehler: 'netz' }, 502, 'netz', /hat die Webseite nicht erreicht/],
    [{ fehler: 'zeitueberschreitung' }, 504, 'netz', /zu lange nicht geantwortet/],
    [{ fehler: 'limit' }, 429, 'limit', /ausgelastet/],
  ];
  for (const [daten, status, code, meldung] of faelle) {
    const e = await ladeRezept(url, { proxyUrl: PROXY, fetchFn: antwortMit(daten, status) }).catch((x) => x);
    assert.ok(e instanceof ImportFehler, daten.fehler);
    assert.deepEqual([e.code, e.grund], [code, daten.fehler], daten.fehler);
    assert.match(e.message, meldung, daten.fehler);
  }
  // 'origin' darf nicht wie eine blockierende Webseite aussehen (beide kommen mit HTTP 403)
  const origin = await ladeRezept(url, { proxyUrl: PROXY, fetchFn: antwortMit({ fehler: 'origin' }, 403) }).catch((x) => x);
  assert.doesNotMatch(origin.message, /Webseite lässt/);
  // Fehler des Dienstes selbst (z. B. Cloudflare-Fehlerseite) und falsche Adresse des Dienstes
  const kaputt = await ladeRezept(url, { proxyUrl: PROXY, fetchFn: antwortMit('<html>Error 1101</html>', 503) }).catch((x) => x);
  assert.deepEqual([kaputt.code, kaputt.grund], ['netz', 'dienst']);
  assert.match(kaputt.message, /HTTP 503/);
  const falsch = await ladeRezept(url, { proxyUrl: PROXY, fetchFn: antwortMit('<html>404</html>', 404) }).catch((x) => x);
  assert.deepEqual([falsch.code, falsch.grund, falsch.status], ['ungueltig', 'antwort', 404]);
  assert.match(falsch.message, /keine gültige Antwort geschickt \(HTTP 404\)\. Stimmt die Adresse unter Mehr → Import-Dienst\?/);
});

test('ImportFehler: Code und deutsche Meldung', () => {
  const e = new ImportFehler('kein-rezept');
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'kein-rezept');
  assert.equal(e.name, 'ImportFehler');
  assert.match(e.message, /Text einfügen/);
  assert.equal(new ImportFehler('netz', 'Eigene Meldung').message, 'Eigene Meldung');
  assert.equal(new ImportFehler('netz').grund, 'netz');
  // importFehler: Code passend zum Grund, Angaben in der Meldung
  const h = importFehler('host', { host: 'beispiel.de' });
  assert.deepEqual([h.code, h.grund, h.host], ['host', 'host', 'beispiel.de']);
  assert.match(h.message, /„beispiel\.de“/);
  assert.deepEqual([importFehler('zu-gross').code, importFehler('proxy-adresse').code, importFehler('quatsch').code],
    ['kein-rezept', 'kein-proxy', 'ungueltig']);
  assert.match(importFehler('kein-proxy').message, /Mehr → Import-Dienst/);
});
