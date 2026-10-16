import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EINHEITEN, parseZahl, parseZeile, parseZeilen, zutatenAlsText, zutatSchluessel, skaliere, familieVon,
  inBasis, zusammenfassen, formatZahl, formatMenge, formatZutat, teileAlsText, produktName,
} from '../js/zutaten.js';

// Kurzform: nur die interessanten Felder einer geparsten Zeile
function kurz(zeile) {
  const z = parseZeile(zeile);
  return { qty: z.qty, qty2: z.qty2, unit: z.unit, size: z.size, name: z.name, note: z.note, vague: z.vague };
}
const z = (qty, unit, name, mehr = {}) => ({ qty, qty2: null, unit, size: null, name, note: null, vague: false, ...mehr });

test('EINHEITEN enthält alle Pflicht-Einheiten mit Familie', () => {
  const pflicht = ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'EL', 'TL', 'Stück', 'Prise', 'Msp', 'Bund', 'Dose',
    'Packung', 'Zehe', 'Scheibe', 'Stange', 'Zweig', 'Stiel', 'Blatt', 'Becher', 'Glas', 'Tasse', 'Handvoll',
    'Spritzer', 'Schuss', 'Würfel', 'Kopf', 'Knolle', 'Rolle', 'Tropfen', 'Topf'];
  for (const id of pflicht) assert.ok(EINHEITEN[id], `Einheit ${id} fehlt`);
  assert.deepEqual(EINHEITEN.EL, { name: 'EL', plural: 'EL', familie: 'loeffel', faktor: 3 });
  assert.equal(EINHEITEN.kg.familie, 'masse');
  assert.equal(EINHEITEN.kg.faktor, 1000);
  assert.equal(EINHEITEN.l.familie, 'volumen');
  assert.equal(EINHEITEN.Dose.plural, 'Dosen');
  assert.equal(EINHEITEN.Dose.familie, 'Dose');
  for (const id of ['Prise', 'Msp', 'Handvoll', 'Spritzer', 'Schuss', 'Tropfen']) assert.equal(EINHEITEN[id].familie, null);
});

test('parseZahl: Ziffern, Brüche und Zahlwörter', () => {
  const faelle = [['1', 1], ['1,5', 1.5], ['1.5', 1.5], ['800.0', 800], ['½', 0.5], ['1 ½', 1.5], ['1½', 1.5],
    ['1/2', 0.5], ['1 1/2', 1.5], ['¾', 0.75], ['zwei', 2], ['Zwölf', 12], ['eine', 1], ['halbe', 0.5],
    ['anderthalb', 1.5], ['eineinhalb', 1.5], ['zweieinhalb', 2.5], [' 3 ', 3], [4, 4]];
  for (const [ein, aus] of faelle) assert.equal(parseZahl(ein), aus, `parseZahl(${JSON.stringify(ein)})`);
  assert.ok(Math.abs(parseZahl('⅓') - 1 / 3) < 1e-6);
  for (const ein of ['', '   ', 'abc', '1/0', '1-2', null, undefined, NaN]) assert.equal(parseZahl(ein), null);
});

test('parseZeile: Mengen, Einheiten und Schreibweisen von Rezeptseiten', () => {
  assert.deepEqual(kurz('800.0 g Mehl'), z(800, 'g', 'Mehl'));
  assert.deepEqual(kurz('0,5 Bund Petersilie'), z(0.5, 'Bund', 'Petersilie'));
  assert.deepEqual(kurz('1 kl. Bund Petersilie'), z(1, 'Bund', 'Petersilie', { size: 'kl.' }));
  assert.deepEqual(kurz('2 Zwiebel(n)'), z(2, null, 'Zwiebeln'));
  assert.deepEqual(kurz('1 Zwiebel(n)'), z(1, null, 'Zwiebel'));
  assert.deepEqual(kurz('1 Prise(n) Salz'), z(1, 'Prise', 'Salz'));
  assert.deepEqual(kurz('2 Prisen Zucker'), z(2, 'Prise', 'Zucker'));
  assert.deepEqual(kurz('1 ½ TL Backpulver'), z(1.5, 'TL', 'Backpulver'));
  assert.deepEqual(kurz('1-2 Knoblauchzehen'), z(1, null, 'Knoblauchzehen', { qty2: 2 }));
  assert.deepEqual(kurz('2–3 EL Honig'), z(2, 'EL', 'Honig', { qty2: 3 }));
  assert.deepEqual(kurz('2 bis 3 Möhren'), z(2, null, 'Möhren', { qty2: 3 }));
  assert.deepEqual(kurz('400g Spaghetti'), z(400, 'g', 'Spaghetti'));
  assert.deepEqual(kurz('1kg Kartoffeln'), z(1, 'kg', 'Kartoffeln'));
  assert.deepEqual(kurz('2EL Öl'), z(2, 'EL', 'Öl'));
  assert.deepEqual(kurz('1 Pck. Vanillezucker'), z(1, 'Packung', 'Vanillezucker'));
  assert.deepEqual(kurz('½ TL Salz'), z(0.5, 'TL', 'Salz'));
  assert.deepEqual(kurz('1/2 l Milch'), z(0.5, 'l', 'Milch'));
  assert.deepEqual(kurz('125 ml Sahne'), z(125, 'ml', 'Sahne'));
  assert.deepEqual(kurz('1 TL gestr. Salz'), z(1, 'TL', 'Salz', { size: 'gestr.' }));
  assert.deepEqual(kurz('2 große Eier'), z(2, null, 'Eier', { size: 'große' }));
  assert.deepEqual(kurz('1 kleines Stück Ingwer'), z(1, 'Stück', 'Ingwer', { size: 'kleines' }));
  assert.deepEqual(kurz('ca. 500 g Kartoffeln'), z(500, 'g', 'Kartoffeln'));
  assert.deepEqual(kurz('1,5 El Olivenöl'), z(1.5, 'EL', 'Olivenöl'));
  assert.deepEqual(kurz('2 Stangen Lauch'), z(2, 'Stange', 'Lauch'));
  assert.deepEqual(kurz('3 Zehen Knoblauch'), z(3, 'Zehe', 'Knoblauch'));
  assert.deepEqual(kurz('eine Handvoll Rucola'), z(1, 'Handvoll', 'Rucola'));
  assert.deepEqual(kurz('1 1/2 Tassen Reis'), z(1.5, 'Tasse', 'Reis'));
  assert.deepEqual(kurz('200 gr Tofu'), z(200, 'g', 'Tofu'));
  assert.deepEqual(kurz('1 gr. Zwiebel'), z(1, null, 'Zwiebel', { size: 'gr.' }));
  assert.equal(parseZeile('1.000 g Mehl').qty, 1000);
  assert.equal(parseZeile('1.5 kg Mehl').qty, 1.5);
  assert.equal(parseZeile('4 El El Weißweinessig').name, 'Weißweinessig');
});

test('parseZeile: Notizen, Größen, vage Angaben und Sonderfälle', () => {
  assert.deepEqual(kurz('3 EL Olivenöl, zum Braten'), z(3, 'EL', 'Olivenöl', { note: 'zum Braten' }));
  assert.deepEqual(kurz('1 Dose Tomaten (400 g)'), z(1, 'Dose', 'Tomaten', { note: '400 g' }));
  assert.deepEqual(kurz('2 Dosen Tomaten (à 400 g)'), z(2, 'Dose', 'Tomaten', { note: 'à 400 g' }));
  assert.deepEqual(kurz('Saft von 1 Zitrone'), z(1, null, 'Zitrone', { note: 'Saft' }));
  assert.deepEqual(kurz('Saft einer Limette'), z(1, null, 'Limette', { note: 'Saft' }));
  assert.deepEqual(kurz('2 TL (gestrichen) Salz'), z(2, 'TL', 'Salz', { size: 'gestrichen' }));
  assert.deepEqual(kurz('500 g Hackfleisch, gemischt (Rind und Schwein)'),
    z(500, 'g', 'Hackfleisch', { note: 'gemischt, Rind und Schwein' }));
  assert.deepEqual(kurz('200 g Mehl (gesiebt), Type 405'), z(200, 'g', 'Mehl', { note: 'gesiebt, Type 405' }));
  assert.deepEqual(kurz('etwas Schnittlauch'), z(null, null, 'Schnittlauch', { size: 'etwas', vague: true }));
  assert.deepEqual(kurz('Salz und Pfeffer'), z(null, null, 'Salz und Pfeffer', { vague: true }));
  assert.deepEqual(kurz('Pfeffer aus der Mühle'), z(null, null, 'Pfeffer', { note: 'aus der Mühle', vague: true }));
  assert.deepEqual(kurz('Öl zum Braten'), z(null, null, 'Öl', { note: 'zum Braten', vague: true }));
  assert.deepEqual(kurz('Butter für die Form'), z(null, null, 'Butter', { note: 'für die Form', vague: true }));
  assert.deepEqual(kurz('Zucker nach Belieben'), z(null, null, 'Zucker', { note: 'nach Belieben', vague: true }));
  assert.deepEqual(kurz('ein paar Blätter Basilikum'), z(null, 'Blatt', 'Basilikum', { size: 'ein paar', vague: true }));
  assert.equal(parseZeile('Salz').vague, true);
  assert.equal(parseZeile('Petersilie').vague, false); // ohne Menge, aber nicht vage → Vorschau warnt
  assert.deepEqual(kurz('Zwiebel / Zwiebeln'), z(null, null, 'Zwiebel'));
  assert.deepEqual(kurz('200 g Erbsen (TK)'), z(200, 'g', 'TK-Erbsen'));
  assert.deepEqual(kurz('100 g LANDGUT Butter'), z(100, 'g', 'LANDGUT Butter'));
  assert.deepEqual(kurz('150 g Spinat oder Mangold'), z(150, 'g', 'Spinat', { note: 'oder Mangold' }));
  assert.deepEqual(kurz('7-Korn-Flocken'), z(null, null, '7-Korn-Flocken'));
  assert.deepEqual(kurz('• 2 Eier'), z(2, null, 'Eier'));
  const roh = parseZeile('  1  Prise(n)   Salz ');
  assert.equal(roh.raw, '1 Prise(n) Salz');
  assert.equal(parseZeile(''), null);
  assert.equal(parseZeile('   '), null);
  assert.equal(parseZeile(null), null);
  // Zeile ohne verwertbaren Namen: ganze Zeile als Name, ohne Menge
  assert.deepEqual(kurz('1'), z(null, null, '1'));
});

test('sehr lange Zeilen bleiben schnell (kein Regex-Backtracking)', { timeout: 5000 }, () => {
  const lang = 'a'.repeat(50000);
  for (const zeile of [`1 ${lang}`, `${lang} b`, `1 g ${lang}-b`, `--${'-'.repeat(30000)}a`, '('.repeat(20000),
    `Mehl ${'.'.repeat(30000)}a`, `${'ä.'.repeat(20000)}x`]) {
    assert.equal(typeof parseZeile(zeile).name, 'string');
    assert.equal(typeof zutatSchluessel(zeile), 'string');
    assert.ok(Array.isArray(parseZeilen(zeile)));
  }
});

test('parseZeilen: Gruppen, Fortsetzungszeilen und ids', () => {
  const text = 'Zutaten für 4 Portionen:\n250 g Mehl\n\nFür den Teig:\n2 Eier\n1 Prise Salz\n## Füllung\n' +
    '200 g Spinat\noder Mangold\n1 EL Kräuter (Thymian,\nOregano)\nSoße:\n100 ml Sahne';
  const liste = parseZeilen(text);
  assert.deepEqual(liste.map((x) => [x.group, x.name]), [
    [null, 'Mehl'], ['Für den Teig', 'Eier'], ['Für den Teig', 'Salz'], ['Füllung', 'Spinat'],
    ['Füllung', 'Kräuter'], ['Soße', 'Sahne']]);
  assert.equal(liste[3].note, 'oder Mangold');
  assert.equal(liste[4].note, 'Thymian, Oregano');
  assert.equal(new Set(liste.map((x) => x.id)).size, liste.length);
  assert.ok(liste.every((x) => typeof x.id === 'string' && x.id.length >= 8));
  assert.deepEqual(parseZeilen(''), []);
  assert.deepEqual(parseZeilen('\n  \n'), []);
});

test('zutatenAlsText ist die Umkehrung von parseZeilen', () => {
  const text = '250 g Mehl\n\nFür den Teig:\n2 Eier\n1 Prise Salz\n\nSoße:\n100 ml Sahne';
  const liste = parseZeilen(text);
  assert.equal(zutatenAlsText(liste), text);
  const nochmal = parseZeilen(zutatenAlsText(liste));
  assert.deepEqual(nochmal.map((x) => [x.group, x.raw]), liste.map((x) => [x.group, x.raw]));
  // ohne raw wird formatZutat benutzt
  assert.equal(zutatenAlsText([{ group: 'Deko', qty: 2, unit: 'EL', name: 'Puderzucker' }]), 'Deko:\n2 EL Puderzucker');
  assert.equal(zutatenAlsText([]), '');
});

test('zutatSchluessel: Einzahl, Adjektive, Marken und Ausnahmen', () => {
  const faelle = [
    ['Zwiebeln', 'zwiebel'], ['Eier', 'ei'], ['Äpfel', 'apfel'], ['Tomaten', 'tomate'], ['Kartoffeln', 'kartoffel'],
    ['Möhren', 'möhre'], ['Karotten', 'karotte'], ['Zitronen', 'zitrone'], ['Rote Zwiebeln', 'rote zwiebel'],
    ['Zwiebel(n)', 'zwiebel'], ['Kirschtomaten', 'kirschtomate'], ['Knoblauchzehen', 'knoblauchzehe'],
    ['Nudeln', 'nudel'], ['Walnüsse', 'walnuss'], ['Lorbeerblätter', 'lorbeerblatt'], ['Champignons', 'champignon'],
    ['Bio-Zitrone', 'zitrone'], ['frische Petersilie', 'petersilie'], ['gehackte Mandeln', 'mandel'],
    ['getrocknete Tomaten', 'tomate, getrocknet'], ['Kritharaki-Nudeln', 'kritharaki-nudel'],
    ['LE GUSTO Salz', 'salz'], ['TK-Erbsen', 'tk-erbse'], ['TK Erbsen', 'tk erbse'], ['Weizenmehl Type 405', 'weizenmehl'],
    ['Pfeffer aus der Mühle', 'pfeffer'], ['Butter (weich)', 'butter'], ['Kirschen', 'kirsche'],
    ['Brötchen', 'brötchen'], ['Würstchen', 'würstchen'], ['Basmatireis', 'basmatireis'], ['Chiasamen', 'chiasamen'],
    ['Zucchini', 'zucchini'], ['Brokkoli', 'brokkoli'], ['Couscous', 'couscous'], ['Ananas', 'ananas'],
    ['Spaghetti', 'spaghetti'], ['Mais', 'mais'], ['Hefekuchen', 'hefekuchen'], ['  Sahne ', 'sahne'],
  ];
  for (const [ein, aus] of faelle) assert.equal(zutatSchluessel(ein), aus, `zutatSchluessel('${ein}')`);
  // idempotent: ein Schlüssel bleibt sein eigener Schlüssel
  for (const [, aus] of faelle) assert.equal(zutatSchluessel(aus), aus);
  assert.equal(zutatSchluessel(''), '');
});

test('zutatSchluessel: Produkt-Zusätze bleiben im Schlüssel, Zubereitung nicht', () => {
  const gleich = (namen, aus) => {
    for (const n of namen) assert.equal(zutatSchluessel(n), aus, `zutatSchluessel('${n}')`);
  };
  // anderes Produkt als frische Ware
  gleich(['Tomate(n), passierte', 'passierte Tomaten', 'Tomaten, passiert', 'Tomaten (passiert)'], 'tomate, passiert');
  gleich(['stückige Tomaten', 'Tomaten, stückig'], 'tomate, stückig');
  gleich(['geschälte Tomaten', 'ganze geschälte Tomaten', 'Tomate(n), geschälte'], 'tomate, geschält');
  gleich(['getrocknete Tomaten', 'Tomaten, getrocknet'], 'tomate, getrocknet');
  gleich(['Thymian, getrockneter', 'getrockneter Thymian', 'Thymian, getrocknet'], 'thymian, getrocknet');
  gleich(['Koriander, gemahlener', 'gemahlener Koriander', 'Koriander, fein gemahlen'], 'koriander, gemahlen');
  gleich(['gemahlene Mandeln', 'Mandeln, gemahlen', 'BACK FAMILY gemahlene Mandeln'], 'mandel, gemahlen');
  gleich(['geräuchertes Paprikapulver'], 'paprikapulver, geräuchert');
  // Zubereitung: gleiche Ware
  gleich(['Zwiebel, gewürfelt', 'gehackte Zwiebel', 'Zwiebeln', 'Zwiebel(n), fein gehackt', 'gewürfelte Zwiebeln'], 'zwiebel');
  gleich(['frische Petersilie', 'Petersilie, gehackt', 'Petersilie (frisch)'], 'petersilie');
  gleich(['Schalotten (geschält und halbiert)', 'Schalotten'], 'schalotte');
  gleich(['gehackte Mandeln', 'ganze Mandeln'], 'mandel');
  gleich(['Gehacktes'], 'gehacktes');
  // gemahlen/getrocknet ist hier ohnehin üblich
  gleich(['frisch gemahlener Pfeffer', 'Pfeffer, gemahlen', 'Pfeffer'], 'pfeffer');
  gleich(['frisch gemahlener schwarzer Pfeffer', 'schwarzer Pfeffer, gemahlen'], 'schwarzer pfeffer');
  gleich(['getrockneter Majoran', 'Majoran, getrocknet', 'Majoran'], 'majoran');
  gleich(['Zimt, gemahlen', 'Zimt'], 'zimt');
  gleich(['Bio- Pfeffer', 'bio-bio-Pfeffer', 'BIO Pfeffer'], 'pfeffer');
  // idempotent
  for (const k of ['tomate, passiert', 'mandel, gemahlen', 'thymian, getrocknet', 'tomaten in öl, getrocknet', 'bio-']) gleich([k], k);
});

test('produktName: Produkt-Zusatz aus der Notiz', () => {
  assert.equal(produktName(parseZeile('500 g Tomate(n), passierte')), 'Tomaten, passierte');
  assert.equal(produktName(parseZeile('1 TL Thymian, getrockneter')), 'Thymian, getrockneter');
  assert.equal(produktName(parseZeile('1 TL Koriander (gemahlen)')), 'Koriander, gemahlen');
  assert.equal(produktName(parseZeile('1 Dose Tomaten, stückig, aus der Dose')), 'Tomaten, stückig');
  assert.equal(produktName(parseZeile('2 Zwiebeln, gehackt')), 'Zwiebeln');
  assert.equal(produktName(parseZeile('1 Knoblauchzehe (geschält, klein geschnitten)')), 'Knoblauchzehe');
  assert.equal(produktName(parseZeile('1/2 TL Majoran, getrocknet')), 'Majoran');
  // gezählte Tomaten sind frisch, Dose/Gramm meint die Konserve
  assert.equal(produktName(parseZeile('3 Tomaten, geschält')), 'Tomaten');
  assert.equal(produktName(parseZeile('2 Dosen Tomate(n), geschälte')), 'Tomaten, geschälte');
  assert.equal(produktName(parseZeile('400 g Tomaten, gehackt')), 'Tomaten, gehackt');
  assert.equal(produktName({ name: 'Mehl' }), 'Mehl');
  assert.equal(produktName(null), '');
});

test('zusammenfassen: frische und verarbeitete Ware getrennt, Zubereitung zusammen', () => {
  const liste = zusammenfassen(['3 Tomaten', '500 g Tomate(n), passierte', '200 g passierte Tomaten',
    '1 Dose stückige Tomaten', '2 Zwiebeln', '1 Zwiebel, gewürfelt', '1 gehackte Zwiebel', '1 Bund frische Petersilie',
    '1 Bund Petersilie', '1 TL Thymian, getrockneter', '2 Zweige Thymian', '100 g gemahlene Mandeln', '50 g Mandeln',
    '1 TL Koriander, gemahlen', '1 Bund Koriander'].map((l) => parseZeile(l)));
  assert.deepEqual(liste.map((x) => [x.key, x.name, teileAlsText(x.teile)]), [
    ['tomate', 'Tomaten', '3'],
    ['tomate, passiert', 'Tomaten, passierte', '700 g'],
    ['tomate, stückig', 'stückige Tomaten', '1 Dose'],
    ['zwiebel', 'Zwiebeln', '4'],
    ['petersilie', 'frische Petersilie', '2 Bund'],
    ['thymian, getrocknet', 'Thymian, getrockneter', '1 TL'],
    ['thymian', 'Thymian', '2 Zweige'],
    ['mandel, gemahlen', 'gemahlene Mandeln', '100 g'],
    ['mandel', 'Mandeln', '50 g'],
    ['koriander, gemahlen', 'Koriander, gemahlen', '1 TL'],
    ['koriander', 'Koriander', '1 Bund'],
  ]);
});

test('skaliere, familieVon und inBasis', () => {
  const original = parseZeile('1-2 TL Zucker');
  const doppelt = skaliere(original, 2);
  assert.equal(doppelt.qty, 2);
  assert.equal(doppelt.qty2, 4);
  assert.equal(original.qty, 1); // Original bleibt unverändert
  assert.equal(skaliere(parseZeile('Salz'), 3).qty, null);
  assert.equal(skaliere(parseZeile('1 Zwiebel'), 1 / 3).qty, 0.333333);
  assert.equal(familieVon('g'), 'masse');
  assert.equal(familieVon('l'), 'volumen');
  assert.equal(familieVon('EL'), 'loeffel');
  assert.equal(familieVon('Stück'), 'stueck');
  assert.equal(familieVon(null), 'stueck');
  assert.equal(familieVon('Dose'), 'Dose');
  assert.equal(familieVon('Prise'), null);
  assert.deepEqual(inBasis(1.5, 'kg'), { menge: 1500, basis: 'g' });
  assert.deepEqual(inBasis(2, 'EL'), { menge: 6, basis: 'TL' });
  assert.deepEqual(inBasis(0.5, 'l'), { menge: 500, basis: 'ml' });
  assert.deepEqual(inBasis(3, null), { menge: 3, basis: 'Stück' });
  assert.deepEqual(inBasis(2, 'Dose'), { menge: 2, basis: 'Dose' });
  assert.deepEqual(inBasis(1, 'Prise'), { menge: 1, basis: null });
});

test('zusammenfassen: Familien, Spannen, Löffel zu ml und vage Posten', () => {
  const posten = (zeilen, quelle) => zeilen.map((l) => ({ ...parseZeile(l), quelle }));
  const liste = zusammenfassen([
    ...posten(['2 Zwiebeln', '500 g Kartoffeln', '1 Prise Salz', '100 ml Milch'], 'A'),
    ...posten(['1 Zwiebel', '200 g Zwiebeln', '1 kg Kartoffeln', 'Salz', '2 EL Milch', 'etwas Mehl'], 'B'),
    ...posten(['1-2 Knoblauchzehen', '1 Knoblauchzehe', '200 g Mehl', '1 EL Öl', '1 TL Öl'], 'A'),
  ]);
  assert.deepEqual(liste.map((x) => x.key), ['zwiebel', 'kartoffel', 'salz', 'milch', 'mehl', 'knoblauchzehe', 'öl']);
  const [zwiebel, kartoffel, salz, milch, mehl, knoblauch, oel] = liste;
  assert.deepEqual(zwiebel.teile, [{ qty: 3, qty2: null, unit: 'Stück' }, { qty: 200, qty2: null, unit: 'g' }]);
  assert.equal(zwiebel.name, 'Zwiebeln'); // häufigster Originalname
  assert.deepEqual(zwiebel.quellen, ['A', 'B']);
  assert.equal(teileAlsText(zwiebel.teile), '3 Stück + 200 g');
  assert.deepEqual(kartoffel.teile, [{ qty: 1500, qty2: null, unit: 'g' }]);
  assert.equal(teileAlsText(kartoffel.teile), '1,5 kg');
  assert.deepEqual(salz.teile, []);
  assert.equal(salz.vage, true);
  assert.deepEqual(milch.teile, [{ qty: 130, qty2: null, unit: 'ml' }]);
  assert.equal(mehl.vage, false); // 'etwas Mehl' + 200 g → nur die 200 g zählen
  assert.deepEqual(mehl.teile, [{ qty: 200, qty2: null, unit: 'g' }]);
  assert.deepEqual(knoblauch.teile, [{ qty: 2, qty2: 3, unit: 'Stück' }]);
  assert.equal(teileAlsText(knoblauch.teile), '2–3');
  assert.deepEqual(oel.teile, [{ qty: 4, qty2: null, unit: 'TL' }]);
  assert.equal(teileAlsText(oel.teile), '4 TL');
  // eigener Schlüssel, Quellen ohne Doppelte, leere Eingaben
  const mitKey = zusammenfassen([
    { name: 'Rinderbrühe', qty: 1, unit: 'l', key: 'brühe', quelle: { id: 1 } },
    { name: 'Gemüsebrühe', qty: 500, unit: 'ml', key: 'brühe', quelle: { id: 1 } },
  ]);
  assert.deepEqual(mitKey, [{ key: 'brühe', name: 'Rinderbrühe', teile: [{ qty: 1500, qty2: null, unit: 'ml' }],
    vage: false, quellen: [{ id: 1 }] }]);
  assert.deepEqual(zusammenfassen([]), []);
  assert.deepEqual(zusammenfassen([null, { name: '' }]), []);
});

test('formatZahl: ganze Zahlen, Brüche und Dezimalkomma', () => {
  assert.equal(formatZahl(2), '2');
  assert.equal(formatZahl(1.5), '1½');
  assert.equal(formatZahl(0.25, 'TL'), '¼');
  assert.equal(formatZahl(1 / 3, 'EL'), '⅓');
  assert.equal(formatZahl(2.6667, null), '2⅔');
  assert.equal(formatZahl(0.75, 'Dose'), '¾');
  assert.equal(formatZahl(1.5, 'kg'), '1,5');
  assert.equal(formatZahl(0.5, 'l'), '0,5');
  assert.equal(formatZahl(12.5), '12,5');
  assert.equal(formatZahl(1.234, 'g'), '1,23');
  assert.equal(formatZahl(0.1), '0,1');
  assert.equal(formatZahl(null), '');
  assert.equal(formatZahl(NaN), '');
});

test('formatMenge: Umrechnung, Spannen und Mehrzahl', () => {
  assert.equal(formatMenge(500, null, 'g'), '500 g');
  assert.equal(formatMenge(1500, null, 'g'), '1,5 kg');
  assert.equal(formatMenge(1200, null, 'ml'), '1,2 l');
  assert.equal(formatMenge(333.333, null, 'g'), '333 g');
  assert.equal(formatMenge(2, 3, 'Stück'), '2–3');
  assert.equal(formatMenge(2, null, null), '2');
  assert.equal(formatMenge(0.5, null, 'TL'), '½ TL');
  assert.equal(formatMenge(3, null, 'TL'), '1 EL');
  assert.equal(formatMenge(6, 9, 'TL'), '2–3 EL');
  assert.equal(formatMenge(4, null, 'TL'), '4 TL');
  assert.equal(formatMenge(7.5, null, 'TL'), '2½ EL');
  assert.equal(formatMenge(4.5, 6, 'TL'), '1½–2 EL');
  assert.equal(formatMenge(5, null, 'TL'), '5 TL');
  assert.equal(formatMenge(2, null, 'Dose'), '2 Dosen');
  assert.equal(formatMenge(1, null, 'Dose'), '1 Dose');
  assert.equal(formatMenge(2, null, 'Prise'), '2 Prisen');
  assert.equal(formatMenge(1, 2, 'Packung'), '1–2 Pck.');
  assert.equal(formatMenge(2, 2, 'EL'), '2 EL');
  assert.equal(formatMenge(null, null, 'g'), '');
});

test('formatZutat und teileAlsText', () => {
  assert.equal(formatZutat(parseZeile('200 g Mehl (gesiebt)')), '200 g Mehl (gesiebt)');
  assert.equal(formatZutat(parseZeile('1 Prise(n) Salz')), '1 Prise Salz');
  assert.equal(formatZutat(parseZeile('Salz')), 'Salz');
  assert.equal(formatZutat(parseZeile('1 kl. Bund Petersilie')), '1 kl. Bund Petersilie');
  assert.equal(formatZutat({ qty: null, unit: 'Bund', size: 'kl.', name: 'Petersilie' }), 'kl. Bund Petersilie');
  assert.equal(formatZutat(parseZeile('etwas Schnittlauch')), 'etwas Schnittlauch');
  assert.equal(formatZutat(parseZeile('2 Zwiebel(n)')), '2 Zwiebeln');
  assert.equal(formatZutat(parseZeile('1 kleines Stück Ingwer')), '1 kleines Stück Ingwer');
  assert.equal(formatZutat(parseZeile('1 Stk. Zwiebel')), '1 Zwiebel');
  assert.equal(formatZutat(parseZeile('Saft von 1 Zitrone')), '1 Zitrone (Saft)');
  assert.equal(formatZutat(parseZeile('knapp 1 l Milch')), 'knapp 1 l Milch');
  assert.equal(formatZutat(skaliere(parseZeile('1 TL Zucker'), 3)), '1 EL Zucker');
  assert.equal(formatZutat(skaliere(parseZeile('1 Dose Tomaten'), 2)), '2 Dosen Tomaten');
  assert.equal(formatZutat(skaliere(parseZeile('750 g Kartoffeln'), 2)), '1,5 kg Kartoffeln');
  assert.equal(formatZutat(null), '');
  assert.equal(teileAlsText([{ qty: 3, qty2: null, unit: 'Stück' }]), '3');
  assert.equal(teileAlsText([{ qty: 3, qty2: null, unit: 'Stück' }, { qty: 200, qty2: null, unit: 'g' }]), '3 Stück + 200 g');
  assert.equal(teileAlsText([{ qty: 2, qty2: null, unit: 'Bund' }, { qty: 6, qty2: null, unit: 'TL' }]), '2 Bund + 2 EL');
  assert.equal(teileAlsText([]), '');
  assert.equal(teileAlsText(null), '');
});
