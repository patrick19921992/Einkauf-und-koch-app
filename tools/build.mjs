// Stellt die Veröffentlichung für GitHub Pages im Ordner _site zusammen.
//
// - kopiert NUR die freigegebenen Dateien (Allowlist), damit nie versehentlich
//   Sicherungen, Tests oder der Cloudflare-Worker veröffentlicht werden
// - berechnet eine Version aus dem Inhalt (ändert sich nur, wenn sich die App ändert)
// - trägt Version und vollständige Offline-Dateiliste in sw.js ein, Version auch in js/app.js
//
// Aufruf: node tools/build.mjs   (läuft in GitHub Actions, lokal optional)

import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const ZIEL = join(WURZEL, '_site');

const EINZELDATEIEN = ['index.html', 'manifest.webmanifest', 'sw.js'];
const ORDNER = ['css', 'js', 'icons'];
const ERLAUBTE_ENDUNGEN = new Set(['.html', '.webmanifest', '.js', '.css', '.svg', '.png', '.ico', '.webp']);

function fehler(text) {
  console.error(`\n✖ Build abgebrochen: ${text}\n`);
  process.exit(1);
}

async function existiert(pfad) {
  try {
    await stat(pfad);
    return true;
  } catch {
    return false;
  }
}

async function dateienIn(ordner) {
  const ergebnis = [];
  for (const eintrag of await readdir(ordner, { withFileTypes: true })) {
    const voll = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) ergebnis.push(...(await dateienIn(voll)));
    else if (eintrag.isFile()) ergebnis.push(voll);
  }
  return ergebnis;
}

function endung(pfad) {
  const i = pfad.lastIndexOf('.');
  return i >= 0 ? pfad.slice(i).toLowerCase() : '';
}

function alsWebPfad(pfad) {
  return './' + relative(WURZEL, pfad).split(sep).join('/');
}

async function main() {
  for (const d of EINZELDATEIEN) {
    if (!(await existiert(join(WURZEL, d)))) fehler(`${d} fehlt.`);
  }

  // Dateien sammeln
  const quellen = EINZELDATEIEN.map((d) => join(WURZEL, d));
  for (const o of ORDNER) {
    const pfad = join(WURZEL, o);
    if (await existiert(pfad)) quellen.push(...(await dateienIn(pfad)));
  }
  for (const q of quellen) {
    const name = relative(WURZEL, q);
    if (!ERLAUBTE_ENDUNGEN.has(endung(q))) fehler(`Unerwartete Datei „${name}“ – nicht veröffentlicht. Bitte entfernen.`);
    if (/backup/i.test(name)) fehler(`„${name}“ sieht nach einer Sicherung aus und darf nicht veröffentlicht werden.`);
  }
  quellen.sort();

  // Version = Prüfsumme über alle Inhalte (ohne Platzhalter-Ersetzung)
  const hash = createHash('sha256');
  for (const q of quellen) {
    hash.update(relative(WURZEL, q));
    hash.update(await readFile(q));
  }
  const version = hash.digest('hex').slice(0, 12);

  // Offline-Liste: alles außer sw.js selbst
  const dateiliste = quellen
    .map(alsWebPfad)
    .filter((p) => p !== './sw.js');
  for (const pflicht of ['./index.html', './manifest.webmanifest', './js/app.js', './css/app.css']) {
    if (!dateiliste.includes(pflicht)) fehler(`${pflicht} fehlt in der Offline-Liste.`);
  }

  // Kopieren
  await rm(ZIEL, { recursive: true, force: true });
  await mkdir(ZIEL, { recursive: true });
  for (const q of quellen) {
    const zielPfad = join(ZIEL, relative(WURZEL, q));
    await mkdir(dirname(zielPfad), { recursive: true });
    await cp(q, zielPfad);
  }

  // Platzhalter ersetzen
  const swPfad = join(ZIEL, 'sw.js');
  let sw = await readFile(swPfad, 'utf8');
  if (!sw.includes("'__VERSION__'") || !sw.includes('/*__DATEIEN__*/')) fehler('Platzhalter in sw.js nicht gefunden.');
  sw = sw.replace("'__VERSION__'", `'${version}'`)
    .replace('/*__DATEIEN__*/', dateiliste.map((p) => JSON.stringify(p)).join(', '));
  await writeFile(swPfad, sw);

  const appPfad = join(ZIEL, 'js', 'app.js');
  let app = await readFile(appPfad, 'utf8');
  if (!app.includes("'__VERSION__'")) fehler('Platzhalter in js/app.js nicht gefunden.');
  app = app.replace("'__VERSION__'", `'${version}'`);
  await writeFile(appPfad, app);

  console.log(`✔ Build fertig: Version ${version}, ${quellen.length} Dateien, ${dateiliste.length} offline verfügbar.`);
}

main().catch((e) => fehler(e?.stack || String(e)));
