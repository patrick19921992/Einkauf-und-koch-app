import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alsSchluessel, ausSchluessel, istSchluessel, heute, plusTage, wochenstart, wochentage,
  imBereich, tageZwischen, wochentagKurz, wochentagLang, kalenderwoche, formatDatum,
  formatZeitraum, relativerName,
} from '../js/datum.js';

test('alsSchluessel nutzt lokale Zeit (kein UTC-Versatz um Mitternacht)', () => {
  assert.equal(alsSchluessel(new Date(2026, 9, 19, 0, 0, 0)), '2026-10-19');
  assert.equal(alsSchluessel(new Date(2026, 9, 19, 23, 59, 59)), '2026-10-19');
  assert.equal(heute(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('ausSchluessel und istSchluessel', () => {
  const d = ausSchluessel('2026-10-25');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 25);
  assert.equal(istSchluessel('2026-02-28'), true);
  assert.equal(istSchluessel('2026-02-30'), false);
  assert.equal(istSchluessel('2026-2-3'), false);
  assert.equal(istSchluessel(null), false);
  assert.throws(() => ausSchluessel('kein datum'));
});

test('plusTage über die Zeitumstellungen 25.10.2026 und 28.03.2027', () => {
  assert.equal(plusTage('2026-10-19', 7), '2026-10-26');
  assert.equal(plusTage('2026-10-24', 1), '2026-10-25');
  assert.equal(plusTage('2026-10-25', 1), '2026-10-26');
  assert.equal(plusTage('2027-03-27', 1), '2027-03-28');
  assert.equal(plusTage('2027-03-28', 1), '2027-03-29');
  assert.equal(plusTage('2027-03-29', -7), '2027-03-22');
  assert.equal(plusTage('2026-12-31', 1), '2027-01-01');
  assert.equal(plusTage('2028-02-28', 1), '2028-02-29');
});

test('wochenstart für Montag, Sonntag und Samstag', () => {
  assert.equal(wochenstart('2026-10-15'), '2026-10-12'); // Donnerstag -> Montag
  assert.equal(wochenstart('2026-10-12'), '2026-10-12'); // Montag bleibt
  assert.equal(wochenstart('2026-10-18'), '2026-10-12'); // Sonntag gehört zur Woche davor
  assert.equal(wochenstart('2026-10-15', 0), '2026-10-11'); // Sonntag als Start
  assert.equal(wochenstart('2026-10-15', 6), '2026-10-10'); // Samstag als Start
  assert.equal(wochenstart('2026-10-25'), '2026-10-19'); // Tag der Zeitumstellung
});

test('wochentage liefert 7 aufeinanderfolgende Tage über die Zeitumstellung', () => {
  assert.deepEqual(wochentage('2026-10-19'), [
    '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
  ]);
  const naechste = wochentage(plusTage('2026-10-19', 7));
  assert.equal(naechste[0], '2026-10-26');
  assert.equal(wochentagKurz(naechste[0]), 'Mo');
});

test('imBereich und tageZwischen', () => {
  assert.equal(imBereich('2026-10-20', '2026-10-19', '2026-10-25'), true);
  assert.equal(imBereich('2026-10-26', '2026-10-19', '2026-10-25'), false);
  assert.equal(tageZwischen('2026-10-19', '2026-10-26'), 7);
  assert.equal(tageZwischen('2027-03-22', '2027-03-29'), 7);
  assert.equal(tageZwischen('2026-10-26', '2026-10-19'), -7);
});

test('Wochentagsnamen', () => {
  assert.equal(wochentagKurz('2026-10-15'), 'Do');
  assert.equal(wochentagLang('2026-10-18'), 'Sonntag');
});

test('kalenderwoche nach ISO 8601', () => {
  assert.equal(kalenderwoche('2026-10-15'), 42);
  assert.equal(kalenderwoche('2026-01-01'), 1);
  assert.equal(kalenderwoche('2027-01-01'), 53);
  assert.equal(kalenderwoche('2026-12-28'), 53);
  assert.equal(kalenderwoche('2025-12-29'), 1);
});

test('formatDatum und formatZeitraum', () => {
  assert.equal(formatDatum('2026-10-05'), '05.10.');
  assert.equal(formatDatum('2026-10-19', { wochentag: true }), 'Mo, 19.10.');
  assert.equal(formatDatum('2026-10-19', { jahr: true }), '19.10.2026');
  assert.equal(formatZeitraum('2026-10-19', '2026-10-25'), '19.10.–25.10.2026');
  assert.equal(formatZeitraum('2026-12-28', '2027-01-03'), '28.12.2026–03.01.2027');
});

test('relativerName', () => {
  assert.equal(relativerName('2026-10-15', '2026-10-15'), 'Heute');
  assert.equal(relativerName('2026-10-16', '2026-10-15'), 'Morgen');
  assert.equal(relativerName('2026-10-14', '2026-10-15'), 'Gestern');
  assert.equal(relativerName('2026-10-20', '2026-10-15'), null);
});
