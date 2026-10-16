// Tests der Grundsammlung (js/daten/*.js) mit den echten Daten: Format der Rohrezepte, Zutatenzeilen,
// Ernährung (Protein), Abdeckung durch die geschätzte Preistabelle und Probepläne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import frueh from '../js/daten/rezepte-frueh.js';
import fisch from '../js/daten/rezepte-fisch.js';
import vegetarisch from '../js/daten/rezepte-vegetarisch.js';
import fleisch from '../js/daten/rezepte-fleisch.js';
import { GRUNDREZEPTE, ladeGrundrezepte } from '../js/daten/rezepte.js';
import { parseZeilen } from '../js/zutaten.js';
import { postenSchluessel } from '../js/einkaufsliste.js';
import { findePreis, mengeInEinheit, kostenFuer } from '../js/preise.js';
import { PROTEINE, erkenneProtein, rezeptMeta, passtZumProfil, plane } from '../js/planer.js';
import { findeTimer } from '../js/rezept-import.js';

// [Datei, Rezepte, id-Präfix, Mahlzeit]
const DATEIEN = [['rezepte-frueh.js', frueh, 'f', 'frueh'], ['rezepte-fisch.js', fisch, 's', 'haupt'],
  ['rezepte-vegetarisch.js', vegetarisch, 'v', 'haupt'], ['rezepte-fleisch.js', fleisch, 'm', 'haupt']];
const FELDER = ['id', 'title', 'servings', 'prepMin', 'cookMin', 'totalMin', 'mahlzeit', 'protein', 'tags', 'zutaten',
  'schritte'];
const TAGS = new Set(['pasta', 'reis', 'kartoffeln', 'eintopf', 'suppe', 'salat', 'ofen', 'pfanne', 'auflauf', 'brot',
  'suess', 'herzhaft', 'kinder', 'meal-prep', 'resteverwertung', 'sonntag']);
const PROTEIN_IDS = new Set(PROTEINE.map((p) => p.id));
// Einheiten ohne Menge zum Umrechnen (Prise Salz …): zählen bei der Preis-Umrechnung nicht
const NICHT_SUMMIERBAR = new Set(['Prise', 'Msp', 'Tropfen', 'Handvoll', 'Spritzer', 'Schuss']);
const HEUTE = '2026-10-19';

const sortiert = (liste) => [...liste].sort();
const ZEILEN = new Map();
// Zutaten eines Rohrezepts, zerlegt wie in ladeGrundrezepte (gemerkt)
function zeilen(r) {
  if (!ZEILEN.has(r)) ZEILEN.set(r, parseZeilen(r.zutaten.join('\n')));
  return ZEILEN.get(r);
}
const schluessel = (r) => zeilen(r).map((z) => postenSchluessel(z));
const teileVon = (z) => (z.qty == null ? [] : [{ qty: z.qty, qty2: z.qty2, unit: z.unit }]);

// Fehler sammeln und am Ende gemeinsam zeigen (statt beim ersten abzubrechen)
function sammle(fn) {
  const fehler = [];
  fn(fehler);
  assert.deepEqual(fehler, []);
}

test('Grundsammlung: der Index enthält die vier Dateien in fester Reihenfolge', () => {
  assert.deepEqual(GRUNDREZEPTE, [...frueh, ...fisch, ...vegetarisch, ...fleisch]);
  for (const [datei, liste] of DATEIEN) assert.ok(Array.isArray(liste) && liste.length > 0, datei);
});

test('Rohformat: genau die Felder, eindeutige ids und Titel, gültige Zeiten, Mahlzeit, Protein und Tags', () => {
  const ids = new Set();
  const titel = new Set();
  sammle((fehler) => {
    for (const [datei, liste, praefix, mahlzeit] of DATEIEN) {
      for (const r of liste) {
        const f = (text) => fehler.push(`${datei} ${r.id}: ${text}`);
        if (JSON.stringify(sortiert(Object.keys(r))) !== JSON.stringify(sortiert(FELDER))) {
          f(`Felder ${Object.keys(r).join(', ')}`);
        }
        if (!new RegExp(`^${praefix}-\\d{3}$`).test(r.id)) f('id nicht im Format');
        if (ids.has(r.id)) f('id doppelt');
        ids.add(r.id);
        const t = typeof r.title === 'string' ? r.title.toLowerCase() : '';
        if (!t || r.title !== r.title.trim() || r.title.length < 5 || r.title.length > 80) f(`Titel „${r.title}“`);
        if (titel.has(t)) f('Titel doppelt');
        titel.add(t);
        if (!Number.isInteger(r.servings) || r.servings < 1 || r.servings > 12) f(`servings ${r.servings}`);
        for (const k of ['prepMin', 'cookMin', 'totalMin']) {
          if (!Number.isInteger(r[k]) || r[k] < 0) f(`${k} keine Ganzzahl ≥ 0`);
        }
        if (!(r.totalMin > 0) || r.totalMin > 240) f(`totalMin ${r.totalMin}`);
        if (r.totalMin < r.prepMin + r.cookMin) f(`totalMin ${r.totalMin} < prepMin + cookMin`);
        if (r.mahlzeit !== mahlzeit) f(`mahlzeit ${r.mahlzeit}`);
        const p = Array.isArray(r.protein) ? r.protein : [];
        if (!p.length || new Set(p).size !== p.length || p.some((x) => !PROTEIN_IDS.has(x))) f(`protein ${p}`);
        if ((p.includes('vegan') || p.includes('vegetarisch')) && p.length !== 1) f('vegan/vegetarisch nicht allein');
        if (praefix === 's' && p.join() !== 'fisch') f('Fischgericht ohne protein fisch');
        if (praefix === 'v' && !['vegetarisch', 'vegan'].includes(p.join())) f('vegetarisch mit Fleisch/Fisch');
        if (praefix === 'm' && !p.every((x) => ['schwein', 'rind', 'gefluegel'].includes(x))) f('Fleisch fehlt');
        if (!Array.isArray(r.tags) || new Set(r.tags).size !== r.tags.length || r.tags.some((x) => !TAGS.has(x))) {
          f(`tags ${r.tags}`);
        }
      }
    }
  });
  assert.equal(ids.size, GRUNDREZEPTE.length);
});

test('Schritte: 3–8 kurze Sätze, Zeiten ausgeschrieben, der Kochmodus findet einen Timer', () => {
  sammle((fehler) => {
    for (const r of GRUNDREZEPTE) {
      const f = (text) => fehler.push(`${r.id}: ${text}`);
      if (!Array.isArray(r.schritte) || r.schritte.length < 3 || r.schritte.length > 8) {
        f(`${r.schritte?.length} Schritte`);
        continue;
      }
      for (const s of r.schritte) {
        if (typeof s !== 'string' || s !== s.trim() || s.length < 10 || s.length > 400) f(`Schritt „${s}“`);
        else if (!/[.!]$/.test(s)) f(`Schritt ohne Satzende: ${s}`);
        else if (/\b(?:Min|Std|Sek)\b\.?/.test(s)) f(`Abkürzung statt „Minuten“: ${s}`);
      }
      if (r.cookMin >= 5 && !r.schritte.some((s) => findeTimer(s).length)) f(`${r.cookMin} Min. Kochzeit, kein Timer`);
    }
  });
});

test('Zutatenzeilen: jede Zeile wird zerlegt, mit Menge oder als vage Vorratszutat', () => {
  sammle((fehler) => {
    for (const r of GRUNDREZEPTE) {
      const f = (text) => fehler.push(`${r.id}: ${text}`);
      if (!Array.isArray(r.zutaten) || r.zutaten.length < 3 || r.zutaten.length > 20) f('3–20 Zutaten');
      if (r.zutaten.some((t) => typeof t !== 'string' || !t.trim() || t !== t.trim())) f('leere Zeile');
      const liste = zeilen(r);
      if (liste.length !== r.zutaten.length) f(`${liste.length} statt ${r.zutaten.length} Zeilen`);
      for (const z of liste) {
        const k = postenSchluessel(z);
        if (!z.name || /\d|[()]/.test(z.name)) f(`Name „${z.name}“ aus „${z.raw}“`);
        if (!k) f(`kein Schlüssel: ${z.raw}`);
        if (z.qty != null) {
          if (!(Number(z.qty) > 0)) f(`Menge ≤ 0: ${z.raw}`);
        } else if (!z.vague) f(`ohne Menge und nicht vage: ${z.raw}`);
        else if (!findePreis(k)?.vorrat && !/für die form|zum (?:braten|einfetten|bestreichen)/i.test(z.raw)) {
          f(`vage, aber kein Vorrat: ${z.raw}`);
        }
      }
      // dieselbe Zutat zweimal nur beim Vorrat ('3 EL Öl' für den Salat, 'Öl zum Braten')
      const gekauft = schluessel(r).filter((k) => !findePreis(k)?.vorrat);
      if (new Set(gekauft).size !== gekauft.length) f(`Zutat doppelt: ${gekauft.join(', ')}`);
    }
  });
});

test('ladeGrundrezepte: Rezept-Format der App mit festen ids, einmal zerlegt', () => {
  const a = ladeGrundrezepte();
  const b = ladeGrundrezepte();
  assert.equal(a.length, GRUNDREZEPTE.length);
  assert.notEqual(a, b);
  assert.equal(a[0], b[0]);
  a.forEach((r, i) => {
    const roh = GRUNDREZEPTE[i];
    assert.equal(r.id, `grund-${roh.id}`);
    assert.equal(r.herkunft, 'grund');
    assert.equal(r.sourceSite, 'Grundsammlung');
    assert.equal(r.title, roh.title);
    assert.equal(r.mahlzeit, roh.mahlzeit);
    assert.deepEqual(r.protein, roh.protein);
    assert.deepEqual(r.tags, roh.tags);
    assert.equal(r.ingredients.length, roh.zutaten.length);
    r.ingredients.forEach((z, j) => assert.equal(z.id, `${r.id}-z${j}`));
    assert.deepEqual(r.steps.map((s) => s.text), roh.schritte);
    r.steps.forEach((s, j) => assert.deepEqual({ id: s.id, group: s.group }, { id: `${r.id}-s${j}`, group: null }));
  });
});

test('Ernährung: angegebenes Protein = erkanntes Protein (Rohformat und App-Format)', () => {
  const app = new Map(ladeGrundrezepte().map((r) => [r.id, r]));
  sammle((fehler) => {
    for (const r of GRUNDREZEPTE) {
      const soll = sortiert(r.protein).join('+');
      const roh = sortiert(erkenneProtein({ zutaten: r.zutaten })).join('+');
      const db = sortiert(erkenneProtein({ ingredients: app.get(`grund-${r.id}`).ingredients })).join('+');
      if (roh !== soll || db !== soll) fehler.push(`${r.id} ${r.title}: angegeben ${soll}, erkannt ${roh} / ${db}`);
      const meta = rezeptMeta(app.get(`grund-${r.id}`));
      if (meta.mahlzeit !== r.mahlzeit || meta.totalMin !== r.totalMin) fehler.push(`${r.id}: rezeptMeta ${meta}`);
    }
  });
});

// Unabhängige Stichwörter (zusätzlich zu planer.js): Fleisch/Fisch und Tierprodukte in den Schlüsseln
// ('lamm'/'kalb' nur am Wortanfang: 'flammkuchenteig')
const FLEISCH_FISCH_RE = new RegExp(['schwein', 'speck', 'schinken', 'salami', 'bacon', 'chorizo', 'wurst', 'würstchen',
  'kassler', 'rind', '(?:^|[\\s-])kalb', '(?:^|[\\s-])lamm', 'hähnchen', 'hühnchen', 'hühner', 'huhn', 'pute',
  'geflügel', 'hackfleisch', '^hack', 'gehacktes', 'gelatine', 'fisch', 'lachs', 'forelle', 'kabeljau', 'garnele',
  'matjes', 'hering', 'sardelle', 'anchovis', 'krabbe', 'shrimp', 'worcester'].join('|'));
const PFLANZLICH_RE = new RegExp(['kokosmilch', 'hafermilch', 'sojamilch', 'mandelmilch', 'reismilch', 'haferdrink',
  'sojadrink', 'mandeldrink', 'erdnussbutter', 'kakaobutter', 'sojajoghurt', 'kokosjoghurt'].join('|'), 'g');
const TIERPRODUKT_RE = new RegExp(['milch', 'sahne', 'butter', 'käse', 'joghurt', 'quark', 'schmand', 'crème fraîche',
  'creme fraiche', 'mozzarella', 'parmesan', 'feta', 'gouda', 'skyr', 'kefir', 'honig', 'mayonnaise',
  '(?:^|[\\s-])ei(?:er)?(?:$|[\\s,])', 'eigelb', 'eiweiß'].join('|'));

test('Ernährung: vegetarisch ohne Fleisch und Fisch, vegan zusätzlich ohne Milch, Ei und Honig', () => {
  sammle((fehler) => {
    for (const r of GRUNDREZEPTE) {
      const veg = r.protein.includes('vegetarisch') || r.protein.includes('vegan');
      if (!veg) continue;
      const keys = schluessel(r);
      const fleischig = keys.filter((k) => FLEISCH_FISCH_RE.test(k));
      if (fleischig.length) fehler.push(`${r.id} ${r.title}: ${fleischig.join(', ')}`);
      const p = passtZumProfil(r, { protein: ['vegetarisch'], allergene: ['fisch'], kochzeit: 'egal' });
      if (!p.ok) fehler.push(`${r.id}: passt nicht zu vegetarisch (${p.grund})`);
      if (!r.protein.includes('vegan')) continue;
      const tierisch = keys.filter((k) => TIERPRODUKT_RE.test(k.replace(PFLANZLICH_RE, ' ')));
      if (tierisch.length) fehler.push(`${r.id} ${r.title} (vegan): ${tierisch.join(', ')}`);
      const vegan = { protein: ['vegan'], allergene: ['laktose', 'ei'], ohne: ['honig'], kochzeit: 'egal' };
      const v = passtZumProfil(r, vegan);
      if (!v.ok) fehler.push(`${r.id}: passt nicht zu vegan (${v.grund})`);
    }
  });
  // Gegenprobe: die Stichwörter erkennen Tierisches überhaupt
  assert.ok(FLEISCH_FISCH_RE.test('gemischtes hackfleisch') && !FLEISCH_FISCH_RE.test('tomate, gehackt'));
  assert.ok(FLEISCH_FISCH_RE.test('lammhack') && !FLEISCH_FISCH_RE.test('flammkuchenteig'));
  assert.ok(TIERPRODUKT_RE.test('ei') && !TIERPRODUKT_RE.test('reis') && !TIERPRODUKT_RE.test('speisestärke'));
  assert.ok(!TIERPRODUKT_RE.test('kokosmilch'.replace(PFLANZLICH_RE, ' ')));
});

test('Verteilung: genug Frühstücke, Fisch-, vegetarische, vegane und Fleischgerichte', () => {
  const anzahl = (liste, fn) => liste.filter(fn).length;
  assert.ok(frueh.length >= 20, `Frühstück ${frueh.length}`);
  assert.ok(fisch.length >= 12, `Fisch ${fisch.length}`);
  assert.ok(vegetarisch.length >= 35, `vegetarisch ${vegetarisch.length}`);
  assert.ok(anzahl(vegetarisch, (r) => r.protein[0] === 'vegan') >= 12, 'mindestens 12 vegane Hauptgerichte');
  assert.ok(fleisch.length >= 40, `Fleisch ${fleisch.length}`);
  // Fleisch: alle Sorten vertreten
  assert.ok(anzahl(fleisch, (r) => r.protein.includes('gefluegel')) >= 12, 'Geflügel');
  assert.ok(anzahl(fleisch, (r) => r.protein.join() === 'schwein') >= 8, 'Schwein');
  assert.ok(anzahl(fleisch, (r) => r.protein.join() === 'rind') >= 6, 'Rind');
  assert.ok(anzahl(fleisch, (r) => r.protein.join() === 'rind,schwein') >= 6, 'gemischtes Hack');
  // Frühstück: meist ohne Fleisch und schnell
  assert.ok(anzahl(frueh, (r) => ['vegetarisch', 'vegan'].includes(r.protein[0])) >= frueh.length * 0.75);
  assert.ok(anzahl(frueh, (r) => r.protein[0] === 'vegan') >= 5, 'vegane Frühstücke');
  assert.ok(anzahl(frueh, (r) => r.totalMin <= 15) >= frueh.length / 2, 'schnelle Frühstücke');
  // Hauptgerichte: verschiedene Sättigungsbeilagen
  const haupt = GRUNDREZEPTE.filter((r) => r.mahlzeit === 'haupt');
  for (const tag of ['pasta', 'reis', 'kartoffeln']) assert.ok(anzahl(haupt, (r) => r.tags.includes(tag)) >= 10, tag);
});

// Schlüssel aller Rezepte mit Mengenangabe → Zeilen (vage Zeilen zählen nicht)
function mengenSchluessel() {
  const m = new Map();
  for (const r of GRUNDREZEPTE) {
    zeilen(r).forEach((z, i) => {
      if (z.qty == null) return;
      const k = schluessel(r)[i];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ r, z });
    });
  }
  return m;
}

test('Preise: mindestens 97 % der Zutaten (ohne vage und Vorrat) haben eine Preiszeile', (t) => {
  const keys = [...mengenSchluessel().keys()].filter((k) => !findePreis(k)?.vorrat);
  const fehlend = keys.filter((k) => !findePreis(k));
  const ungefaehr = keys.filter((k) => findePreis(k) && findePreis(k).schluessel !== k)
    .map((k) => `${k} → ${findePreis(k).schluessel}`);
  if (fehlend.length) t.diagnostic(`ohne Preis: ${fehlend.join(', ')}`);
  if (ungefaehr.length) t.diagnostic(`über ähnlichen Schlüssel: ${ungefaehr.join(', ')}`);
  const anteil = 1 - fehlend.length / keys.length;
  assert.ok(keys.length > 100);
  assert.ok(anteil >= 0.97, `nur ${(anteil * 100).toFixed(1)} % mit Preis; ohne: ${fehlend.join(', ')}`);
});

test('Preise: Grundvorrat kostet nichts, Gekauftes nicht', () => {
  for (const k of ['salz', 'pfeffer', 'wasser', 'öl', 'olivenöl', 'essig', 'zucker', 'mehl', 'paprikapulver', 'oregano',
    'lorbeerblatt', 'gemüsebrühe', 'thymian, getrocknet']) {
    assert.equal(findePreis(k)?.vorrat, true, k);
    assert.deepEqual(kostenFuer(k, [{ qty: 2, qty2: null, unit: 'EL' }], ['lidl']).betrag, 0, k);
  }
  for (const k of ['zwiebel', 'butter', 'ei', 'milch', 'tomatenmark', 'hackfleisch', 'kaffee', 'toilettenpapier']) {
    assert.equal(findePreis(k)?.vorrat, false, k);
    assert.ok(kostenFuer(k, [], ['lidl']).betrag > 0, k);
  }
});

test('Preise: jede Rezeptmenge lässt sich in die Einheit ihrer Preiszeile umrechnen', () => {
  sammle((fehler) => {
    for (const [k, vorkommen] of mengenSchluessel()) {
      const e = findePreis(k);
      if (!e || e.vorrat) continue;
      for (const { r, z } of vorkommen) {
        if (NICHT_SUMMIERBAR.has(z.unit)) continue;
        if (mengeInEinheit(teileVon(z), e) == null) fehler.push(`${r.id} „${z.raw}“ → ${e.schluessel}, ${e.einheit}`);
      }
    }
  });
});

test('Preise: ein Rezept einzeln gekauft kostet je Portion zwischen 0,30 € und 8 €', () => {
  sammle((fehler) => {
    for (const r of GRUNDREZEPTE) {
      let summe = 0;
      zeilen(r).forEach((z, i) => { summe += kostenFuer(schluessel(r)[i], teileVon(z), ['lidl']).betrag; });
      const proPortion = summe / r.servings;
      if (!(proPortion >= 0.3 && proPortion <= 8)) fehler.push(`${r.id} ${r.title}: ${proPortion.toFixed(2)} €`);
    }
  });
});

// Vorlieben für die Probepläne (Frühstück braucht vegetarisch oder vegan dabei)
const VORLIEBEN = {
  alles: ['schwein', 'rind', 'gefluegel', 'fisch', 'vegetarisch', 'vegan'],
  'ohne Schwein': ['rind', 'gefluegel', 'fisch', 'vegetarisch', 'vegan'],
  'nur Fleisch': ['schwein', 'rind', 'gefluegel', 'vegetarisch'],
  pescetarisch: ['fisch', 'vegetarisch', 'vegan'],
  vegetarisch: ['vegetarisch', 'vegan'],
  vegan: ['vegan'],
};

// Jedes Gericht im Plan passt zu den Vorlieben
function pruefePlan(plan, profil, rezepte) {
  const nachId = new Map(rezepte.map((r) => [r.id, r]));
  for (const e of plan.eintraege) {
    const r = nachId.get(e.rezeptId);
    assert.ok(r, e.rezeptId);
    const p = passtZumProfil(r, profil);
    assert.ok(p.ok, `${e.rezeptId}: ${p.grund}`);
    assert.equal(e.portionen, profil.personen);
    assert.ok(e.kosten >= 0, `${e.rezeptId}: Kosten ${e.kosten}`);
  }
}

test('Probeplan: 7 Tage Frühstück und Abendessen für 2 Personen je Vorliebe, ohne Lücken, ≈ 35–140 €', () => {
  const rezepte = ladeGrundrezepte();
  for (const kochzeit of ['normal', 'egal']) {
    for (const [name, protein] of Object.entries(VORLIEBEN)) {
      for (const seed of [1, 2]) {
        const profil = { protein, personen: 2, tage: 7, mahlzeiten: ['frueh', 'abend'], laeden: ['lidl'], kochzeit };
        const plan = plane({ rezepte, profil, seed, heute: HEUTE });
        const was = `${name}, ${kochzeit}, seed ${seed}`;
        assert.deepEqual(plan.fehlend, [], was);
        assert.equal(plan.eintraege.length, 14, was);
        assert.equal(plan.eintraege.filter((e) => e.slot === 'frueh').length, 7, was);
        assert.ok(plan.kosten.gesamt >= 35 && plan.kosten.gesamt <= 140, `${was}: ${plan.kosten.gesamt} €`);
        // verschiedene Abendessen (genug Auswahl, keine Wiederholung nötig)
        assert.equal(new Set(plan.eintraege.filter((e) => e.slot === 'abend').map((e) => e.rezeptId)).size, 7, was);
        pruefePlan(plan, profil, rezepte);
      }
    }
  }
});

test('Probeplan: jede Hauptzutat allein reicht für eine Woche Abendessen', () => {
  const rezepte = ladeGrundrezepte();
  for (const { id } of PROTEINE) {
    const profil = { protein: [id], personen: 2, tage: 7, mahlzeiten: ['abend'], laeden: ['aldi', 'penny'],
      kochzeit: 'egal' };
    const plan = plane({ rezepte, profil, seed: 3, heute: HEUTE });
    assert.deepEqual(plan.fehlend, [], id);
    assert.equal(new Set(plan.eintraege.map((e) => e.rezeptId)).size, 7, id);
    assert.ok(plan.kosten.gesamt >= 15 && plan.kosten.gesamt <= 100, `${id}: ${plan.kosten.gesamt} €`);
    pruefePlan(plan, profil, rezepte);
    const erlaubt = id === 'vegetarisch' ? ['vegetarisch', 'vegan'] : [id];
    for (const e of plan.eintraege) {
      const r = rezepte.find((x) => x.id === e.rezeptId);
      assert.ok(r.protein.every((p) => erlaubt.includes(p)), `${id}: ${e.rezeptId} ${r.protein}`);
    }
  }
});
