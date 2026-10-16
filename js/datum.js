// Datums-Helfer für reine Kalendertage im Format 'JJJJ-MM-TT'.
// Alles wird in lokaler Zeit gerechnet und intern auf 12:00 Uhr gelegt,
// damit Sommer-/Winterzeit-Umstellungen keinen Tag verschieben.

const WOCHENTAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WOCHENTAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const SCHLUESSEL_MUSTER = /^(\d{4})-(\d{2})-(\d{2})$/;

function zweistellig(n) {
  return String(n).padStart(2, '0');
}

/** Wandelt ein Date-Objekt (lokale Zeit) in 'JJJJ-MM-TT' um. */
export function alsSchluessel(datum) {
  return `${datum.getFullYear()}-${zweistellig(datum.getMonth() + 1)}-${zweistellig(datum.getDate())}`;
}

/** Prüft, ob ein Text ein gültiger Tages-Schlüssel ist. */
export function istSchluessel(text) {
  const m = SCHLUESSEL_MUSTER.exec(String(text ?? ''));
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

/** Wandelt 'JJJJ-MM-TT' in ein Date-Objekt (lokal, 12:00 Uhr) um. */
export function ausSchluessel(schluessel) {
  const m = SCHLUESSEL_MUSTER.exec(String(schluessel ?? ''));
  if (!m) throw new Error(`Ungültiges Datum: ${schluessel}`);
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
}

/** Heutiges Datum als Schlüssel. `jetzt` ist nur für Tests. */
export function heute(jetzt = new Date()) {
  return alsSchluessel(jetzt);
}

/** Addiert n Tage (auch negativ). */
export function plusTage(schluessel, n) {
  const d = ausSchluessel(schluessel);
  d.setDate(d.getDate() + n);
  return alsSchluessel(d);
}

/** Wochentag-Nummer wie Date.getDay(): 0 = Sonntag … 6 = Samstag. */
export function wochentagNummer(schluessel) {
  return ausSchluessel(schluessel).getDay();
}

/**
 * Erster Tag der Woche, in der `schluessel` liegt.
 * startTag: 1 = Montag (Standard), 0 = Sonntag, 6 = Samstag.
 */
export function wochenstart(schluessel, startTag = 1) {
  const abstand = (wochentagNummer(schluessel) - startTag + 7) % 7;
  return plusTage(schluessel, -abstand);
}

/** Die 7 Tage ab `startSchluessel`. */
export function wochentage(startSchluessel) {
  return Array.from({ length: 7 }, (_, i) => plusTage(startSchluessel, i));
}

/** Liegt `schluessel` im Bereich [von, bis] (beide inklusive)? */
export function imBereich(schluessel, von, bis) {
  return schluessel >= von && schluessel <= bis;
}

/** Anzahl Tage von `a` bis `b` (b - a). */
export function tageZwischen(a, b) {
  const da = ausSchluessel(a);
  const db = ausSchluessel(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) -
    Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}

export function wochentagKurz(schluessel) {
  return WOCHENTAGE_KURZ[wochentagNummer(schluessel)];
}

export function wochentagLang(schluessel) {
  return WOCHENTAGE_LANG[wochentagNummer(schluessel)];
}

/** ISO-Kalenderwoche (Woche mit dem ersten Donnerstag ist KW 1). */
export function kalenderwoche(schluessel) {
  const d = ausSchluessel(schluessel);
  const tag = (d.getDay() + 6) % 7; // Montag = 0
  const donnerstag = new Date(d.getFullYear(), d.getMonth(), d.getDate() - tag + 3, 12);
  const jahr = donnerstag.getFullYear();
  const ersterDonnerstag = new Date(jahr, 0, 4, 12);
  const ersterTag = (ersterDonnerstag.getDay() + 6) % 7;
  ersterDonnerstag.setDate(ersterDonnerstag.getDate() - ersterTag + 3);
  return 1 + Math.round(tageZwischen(alsSchluessel(ersterDonnerstag), alsSchluessel(donnerstag)) / 7);
}

/**
 * Formatiert z. B. als '19.10.' oder 'Mo, 19.10.' oder '19.10.2026'.
 * optionen: { wochentag: boolean, jahr: boolean }
 */
export function formatDatum(schluessel, { wochentag = false, jahr = false } = {}) {
  const d = ausSchluessel(schluessel);
  const teil = `${zweistellig(d.getDate())}.${zweistellig(d.getMonth() + 1)}.${jahr ? d.getFullYear() : ''}`;
  return wochentag ? `${wochentagKurz(schluessel)}, ${teil}` : teil;
}

/** '19.10.–25.10.2026' bzw. '28.12.2026–03.01.2027'. */
export function formatZeitraum(von, bis) {
  const gleichesJahr = von.slice(0, 4) === bis.slice(0, 4);
  return `${formatDatum(von, { jahr: !gleichesJahr })}–${formatDatum(bis, { jahr: true })}`;
}

/** Relativer Name: 'Heute', 'Morgen', 'Gestern' oder null. */
export function relativerName(schluessel, bezug = heute()) {
  const diff = tageZwischen(bezug, schluessel);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  return null;
}
