// Grundsammlung: alle eigenen Startrezepte (CC0 1.0) und ihre Umwandlung ins Rezept-Format der App.
// Die Rohdaten stehen in den vier Dateien rezepte-*.js (Format siehe dort und SPEC).

import { parseZeilen } from '../zutaten.js';
import frueh from './rezepte-frueh.js';
import fisch from './rezepte-fisch.js';
import vegetarisch from './rezepte-vegetarisch.js';
import fleisch from './rezepte-fleisch.js';

/** Alle Grundrezepte im Rohformat ({ id, title, servings, …, zutaten: [Text], schritte: [Text] }). */
export const GRUNDREZEPTE = [...frueh, ...fisch, ...vegetarisch, ...fleisch];

let geladen = null;

// Rohformat → Rezept wie in der Datenbank, mit festen ids (gleiche Rezepte ergeben gleiche ids)
function alsRezept(roh) {
  const id = `grund-${roh.id}`;
  const zahl = (x) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null);
  return {
    id,
    title: String(roh.title ?? ''),
    servings: zahl(roh.servings),
    prepMin: zahl(roh.prepMin),
    cookMin: zahl(roh.cookMin),
    totalMin: zahl(roh.totalMin),
    tags: Array.isArray(roh.tags) ? [...roh.tags] : [],
    notes: '',
    favorite: false,
    sourceUrl: null,
    sourceSite: 'Grundsammlung',
    imageUrl: null,
    herkunft: 'grund',
    mahlzeit: roh.mahlzeit === 'frueh' ? 'frueh' : 'haupt',
    protein: Array.isArray(roh.protein) ? [...roh.protein] : [],
    ingredients: parseZeilen((roh.zutaten || []).join('\n')).map((z, i) => ({ ...z, id: `${id}-z${i}` })),
    steps: (roh.schritte || []).map((text, i) => ({ id: `${id}-s${i}`, group: null, text: String(text) })),
  };
}

/**
 * Grundrezepte im Rezept-Format (+ herkunft 'grund', mahlzeit, protein). Einmal zerlegt und gemerkt: die Objekte
 * werden geteilt – nicht verändern (zum Ändern kopieren, z. B. mit structuredClone).
 */
export function ladeGrundrezepte() {
  geladen ??= GRUNDREZEPTE.map(alsRezept);
  return [...geladen];
}
