# Einkauf & Koch

Private Web-App (PWA) für **Rezepte → Wochenplan → Einkaufsliste → Kochmodus**.
Gedacht für Android-Handys (Chrome), läuft auch am PC im Browser. Laufende Kosten: **0 €**.

**Adresse:** https://patrick19921992.github.io/Einkauf-und-koch-app/

## Funktionen

- **Rezepte:** von Hand anlegen, per Link (Teilen aus Chrome/Chefkoch-App) oder per „Text einfügen“
  importieren, Portionen umrechnen, Favoriten, Tags, Suche
- **Woche:** Rezepte auf Tage und Mahlzeiten verteilen, Portionen je Mahlzeit, „gekocht“ abhaken
- **Einkauf:** Liste automatisch aus dem Wochenplan, gleiche Zutaten zusammengerechnet
  (g/kg, ml/l, EL/TL, Stück …), nach 22 Supermarkt-Abteilungen sortiert, offline abhaken,
  eigene Artikel, Vorrat (Salz, Pfeffer …), als Text teilen, „Einkauf abschließen“
- **Kochmodus:** ein Schritt groß, Bildschirm bleibt an, Vorlesen auf Deutsch, Timer aus dem Text
- **Sicherung:** alle Daten als Datei speichern, teilen (z. B. nach Google Drive) und wieder einlesen

## Einmalige Einrichtung

### 1. GitHub Pages einschalten

Im Repository: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
Danach veröffentlicht jeder Push auf `main` die App automatisch (Reiter **Actions**, grüner Haken,
ca. 1–2 Minuten). Pull Requests werden nur geprüft, nicht veröffentlicht.

### 2. App auf dem Android-Handy installieren

1. Die Adresse oben in **Chrome** öffnen.
2. Menü **⋮ → „App installieren“** (bzw. „Zum Startbildschirm hinzufügen“ → Installieren).
3. Danach gibt es ein App-Symbol, einen Eintrag unter Einstellungen → Apps und
   **„Einkauf & Koch“ im Teilen-Menü** anderer Apps.

Für das Vorlesen im Kochmodus: Android-Einstellungen → (System →) Sprache → Sprachausgabe →
„Sprachdienste von Google“ wählen und prüfen, dass eine deutsche Stimme installiert ist.

### 3. Optional: Import-Dienst für Rezept-Links (Cloudflare, kostenlos)

Der Browser darf Rezeptseiten wie chefkoch.de nicht direkt auslesen. Ein kleiner, abgesicherter
Dienst holt deshalb nur die Rezeptdaten (Zutaten, Schritte, Portionen) – nie ganze Seiten.

1. Auf **dash.cloudflare.com** ein kostenloses Konto anlegen (E-Mail + Passwort, keine Zahlungsdaten).
2. **Workers & Pages → Create → Worker („Hello World“) → Deploy**.
3. **Edit code**, den Inhalt komplett durch [`proxy/worker.js`](proxy/worker.js) ersetzen, **Deploy**.
4. Die angezeigte Adresse `https://….workers.dev` kopieren.
5. In der App: **Mehr → Import-Dienst** → Adresse einfügen → **Speichern** → **Testen**.

Der kostenlose Plan erlaubt 100.000 Abrufe pro Tag und kann keine Kosten erzeugen. Der Dienst
nimmt nur Anfragen von der App-Adresse an und ruft nur bekannte Rezeptseiten ab
(Liste `ERLAUBTE_HOSTS` in `proxy/worker.js`). Blockt eine Seite den Abruf, bleibt immer
**„Text einfügen“**: Zutaten und Zubereitung auf der Seite markieren → Teilen → „Einkauf & Koch“.

## Bedienung in Kürze

- **Rezept per Link:** In Chrome oder der Chefkoch-App „Teilen“ → „Einkauf & Koch“ → prüfen → Speichern.
- **Woche planen:** Rezept öffnen → „In Woche planen“, oder im Reiter Woche auf „+“.
- **Einkaufen:** Reiter Einkauf. Abhaken funktioniert ohne Netz. Falsche Abteilung? Zeile → ⋮ →
  „Abteilung ändern“ – die App merkt es sich. Nach dem Einkauf „Einkauf abschließen“.
- **Kochen:** Rezept → „Kochen“ → „Kochmodus starten“. Wischen oder große Knöpfe für weiter/zurück.
- **Updates:** Erscheint „Neue Version verfügbar“, auf „Neu laden“ tippen (oder unter Mehr →
  „Nach Update suchen“). Im Kochmodus wartet der Hinweis, bis du fertig bist – es wird nie mitten
  beim Kochen neu geladen.

## Wichtige Grenzen

- **Timer klingeln nur, solange die App offen und der Bildschirm an ist** (Grenze von Web-Apps).
- **Daten liegen nur auf diesem Gerät.** Wer in Chrome die Website-Daten löscht, löscht auch die
  Rezepte. Deshalb regelmäßig unter **Mehr → Sicherung** sichern (die App erinnert daran).
- Noch **kein Abgleich zwischen Handys**: Jedes Gerät hat eigene Daten. Die Einkaufsliste lässt
  sich als Text teilen, ganze Daten per Sicherungsdatei übertragen.
- Sprachausgabe braucht eine installierte deutsche Stimme. Änderungen an App-Name, Symbol oder
  Teilen-Menü erreichen die installierte App erst nach bis zu einem Tag (Chrome prüft selten).

## Datenschutz

- Keine Konten, keine Werbung, keine Statistik, keine fremden Schriften oder Skripte.
- Rezeptbilder werden direkt von der Rezeptseite geladen (nur mit Internet).
- Dieses Repository ist **öffentlich**: niemals Sicherungsdateien, persönliche Daten oder
  importierte Rezepte hier hochladen (`.gitignore` und das Build-Skript blockieren
  `rezepte-backup-*` zusätzlich).

## Aufbau

```
index.html               App-Hülle (strenge Content-Security-Policy)
manifest.webmanifest     Installation, Teilen-Ziel
sw.js                    Service Worker: offline, Updates
css/app.css              Aussehen (hell/dunkel)
icons/                   App-Symbole
js/app.js                Start, Router, Bedien-Helfer, Teilen-Empfang, Updates
js/db.js                 Speicher (IndexedDB), Sicherung
js/datum.js              Wochen- und Datumsrechnung
js/zutaten.js            Zutatenzeilen verstehen, Mengen umrechnen und zusammenrechnen
js/einkaufsliste.js      Einkaufsliste aus dem Wochenplan, Abteilungen, Einkaufsrunden
js/rezept-import.js      Rezeptdaten (schema.org) auslesen, Text-Import, Timer erkennen
js/ansicht-*.js          die Bildschirme (Rezepte, Bearbeiten, Woche, Einkauf, Kochen, Mehr)
proxy/worker.js          Cloudflare-Import-Dienst (wird nicht mit veröffentlicht)
tests/*.test.js          automatische Tests (node --test)
tools/build.mjs          stellt die Veröffentlichung in _site zusammen
.github/workflows/       Prüfen, Testen, Veröffentlichen
```

## Entwicklung

Ohne Build-Werkzeuge und ohne npm-Pakete. Mit Node.js 22 oder neuer:

```bash
node --test                 # alle Tests
node tools/build.mjs        # Veröffentlichung nach _site/ zusammenstellen
cd _site && python3 -m http.server 8080   # lokal ansehen: http://localhost:8080/
```

Alle Pfade sind relativ, die App läuft also auch lokal unter einer anderen Adresse. Offline-Liste
und Update-Hinweise gibt es nur in der gebauten Fassung (`_site`): Im Quellordner ist die Dateiliste
in `sw.js` leer, dort kommt alles direkt aus dem Netz.
