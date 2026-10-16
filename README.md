# Einkauf & Koch

Private Web-App (PWA) für **Rezepte → Wochenplan → Einkaufsliste → Kochmodus**.
Gedacht für Android-Handys (Chrome), läuft auch am PC im Browser. Laufende Kosten: **0 €**.

**Adresse:** https://patrick19921992.github.io/Einkauf-und-koch-app/

## Funktionen

- **Rezepte:** von Hand anlegen, per Link (Teilen aus Chrome/Chefkoch-App) oder per „Text einfügen“
  importieren, Portionen umrechnen, Favoriten, Tags, Suche
- **Woche:** Rezepte auf Tage und Mahlzeiten verteilen, Portionen je Mahlzeit, „gekocht“ abhaken
- **Automatisch planen:** Vorlieben, Personen, Tage, Mahlzeiten, Supermärkte und Budget angeben →
  fertiger Wochenplan aus über 120 eigenen Grundrezepten (plus eigene Rezepte, auf Wunsch neue
  KI-Ideen) mit geschätzten Kosten; einzelne Gerichte tauschen, dann in die Woche übernehmen
- **Einkauf:** Liste automatisch aus dem Wochenplan, gleiche Zutaten zusammengerechnet
  (g/kg, ml/l, EL/TL, Stück …), nach 22 Supermarkt-Abteilungen sortiert, offline abhaken,
  eigene Artikel, Vorrat (Salz, Pfeffer …), geschätzte Kosten je Posten und Laden, eigene Preise,
  als Text teilen, „Einkauf abschließen“
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

## Automatisch planen

**Woche → „Automatisch planen“** (startet mit dem ersten Tag der gezeigten Woche, frühestens heute):

1. Angeben, was ihr gern esst (Schwein, Rind, Geflügel, Fisch, vegetarisch, vegan), was nicht auf
   den Tisch soll (Nüsse, Laktose, Gluten, Ei, Soja, Fisch und eigene Wörter wie „Pilze“), Kochzeit,
   Personen, Tage (1–14), Mahlzeiten (Frühstück, Mittag, Abend), bis zu **3 Supermärkte**
   (Aldi, Lidl, Penny, Netto, Kaufland, Rewe, Edeka) und optional ein **Budget** für den Zeitraum.
2. **„Plan erstellen“**: Die App wählt aus über 120 eigenen Grundrezepten (frei verwendbar, CC0)
   und auf Wunsch deinen eigenen Rezepten. Sie achtet auf Abwechslung, nutzt angebrochene
   Packungen weiter und tauscht teure Gerichte, bis das Budget passt –
   oder sagt, was mit diesen Vorlieben mindestens nötig ist.
3. Ergebnis prüfen: Gesamtkosten, Summe je Laden, Budget-Hinweis. Jedes Gericht lässt sich
   **tauschen** oder **ansehen**; „Neu planen“ würfelt neu, „Ändern“ öffnet die Vorlieben.
4. **„Übernehmen“**: Die Gerichte kommen in den Wochenplan (vorhandene Einträge behalten oder
   ersetzen), die verwendeten Rezepte in deine Rezeptliste. Danach geht es mit einem Tipp zur
   Einkaufsliste für genau diesen Zeitraum.

Allergie-Filter sind eine Hilfe, **keine Garantie** – Zutaten bitte immer selbst prüfen.
Das Planen klappt auch offline; nur KI-Ideen brauchen Internet.

### Preise sind Schätzungen

- Alle Preise sind **eigene Schätzwerte, Stand 10/2026** – keine Live-Preise, keine Angebote.
  Grundlage ist der typische Eigenmarken-Preis beim Discounter; Rewe und Edeka sind etwas teurer
  angesetzt. Die App rechnet in ganzen Packungen und nimmt je Zutat den günstigsten gewählten Laden.
- **Grundvorrat** wie Salz, Pfeffer, Gewürze, Speiseöl, Essig, Mehl, Zucker, Brühe und Wasser gilt
  als zu Hause vorhanden und kostet im Plan nichts.
- In der **Einkaufsliste** steht bei jedem Posten „≈ 1,29 €“ (bei mehreren Läden mit dem günstigsten
  Laden), oben die Summe. „Nach Laden“ sortiert die Liste nach Supermarkt.
- **Eigene Preise:** Posten → ⋮ → „Preis eintragen“ (Preis, Menge, Laden oder „Alle Läden“). Eigene
  Preise gehen immer vor und gelten auch beim Planen. Übersicht, Läden und Löschen unter
  **Mehr → Läden & Preise**.

### KI-Rezeptideen (optional, kostenlos)

Auf Wunsch fragt der Planer die KI deines Import-Dienstes nach bis zu **3 neuen Gerichten**, die zu
den Vorlieben passen. Die App prüft jede Idee streng (Ernährungsform, „Lieber nicht“, Vollständigkeit)
und kennzeichnet sie als **„KI-Idee – bitte vor dem Kochen prüfen“**. Übernommene Ideen landen wie
andere Rezepte in deiner Rezeptliste. Einrichten (einmalig, im Browser):

1. Den Import-Dienst auf **Version 2** bringen: im Cloudflare Dashboard den Worker öffnen →
   **Edit code** → Inhalt komplett durch die aktuelle [`proxy/worker.js`](proxy/worker.js) ersetzen →
   **Deploy**.
2. KI verbinden: Worker → **Settings → Bindings → Add → Workers AI → Variable name `AI` → Deploy**.
3. In der App **Mehr → Import-Dienst → „Testen“**: Dort steht dann „KI-Rezeptideen: verfügbar“.

Der kostenlose Plan enthält **10.000 Neurons pro Tag** (etwa 40 KI-Anfragen) und kann keine Kosten
erzeugen. Ist das Kontingent aufgebraucht, sagt die App „Morgen geht es wieder“ und plant ohne neue
Ideen. Cloudflare nutzt die Anfragen nicht zum Trainieren. Ein anderes Modell lässt sich über die
Text-Variable `KI_MODELL` im Worker einstellen (Settings → Variables and Secrets), Standard ist
`@cf/google/gemma-4-26b-a4b-it`. Titel deiner eigenen Rezepte werden nicht an die KI geschickt.

## Bedienung in Kürze

- **Rezept per Link:** In Chrome oder der Chefkoch-App „Teilen“ → „Einkauf & Koch“ → prüfen → Speichern.
- **Woche planen:** Rezept öffnen → „In Woche planen“, oder im Reiter Woche auf „+“ – oder
  „Automatisch planen“ (siehe oben).
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
  sich als Text teilen, ganze Daten per Sicherungsdatei übertragen. Beim Einlesen gewinnt pro
  Eintrag (und pro Einstellung) der neuere Stand – auch Löschungen werden übernommen, wenn sie
  neuer sind. Fehlerhafte Einträge in einer Datei werden repariert oder übersprungen.
- **Preise** sind Schätzungen (Stand 10/2026) und veralten; für genaue Summen eigene Preise eintragen.
  KI-Ideen sind ungeprüfte Vorschläge und brauchen den Import-Dienst mit Workers-AI-Bindung.
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
js/preise.js             geschätzte Kosten je Zutat und Laden, eigene Preise
js/planer.js             automatischer Wochenplan (Vorlieben, Abwechslung, Budget)
js/ki.js                 KI-Rezeptideen anfragen und streng prüfen
js/daten/                Grundrezepte (rezepte-*.js, CC0) und Preistabelle (preise-tabelle.js)
js/ansicht-*.js          die Bildschirme (Rezepte, Bearbeiten, Woche, Planer, Einkauf, Kochen, Mehr)
proxy/worker.js          Cloudflare-Import-Dienst mit KI-Ideen (wird nicht mit veröffentlicht)
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
