# Einkauf & Koch

Private Web-App (PWA) für Rezepte, Wochenplan, Einkaufsliste und Kochmodus.
Gedacht für Android-Handys (Chrome), läuft aber auch am PC im Browser.
Laufende Kosten: 0 €.

> **Status:** im Aufbau (Stufe 1). Diese Datei wird am Ende von Stufe 1 zur vollständigen Anleitung ergänzt.

## Adresse

https://patrick19921992.github.io/Einkauf-und-koch-app/
(erreichbar, sobald die erste Veröffentlichung über GitHub Actions gelaufen ist)

## Geplante Funktionen (Stufe 1)

- **Rezepte:** von Hand anlegen, per Link oder per „Text einfügen“ importieren, Portionen umrechnen
- **Woche:** Rezepte auf Tage und Mahlzeiten verteilen, Portionen je Mahlzeit
- **Einkauf:** Liste automatisch aus dem Wochenplan, Mengen zusammengerechnet, nach Supermarkt-Abteilungen sortiert, offline abhaken
- **Kochmodus:** große Schritte, Bildschirm bleibt an, Vorlesen auf Deutsch, Timer
- **Sicherung:** alle Daten als Datei speichern, teilen und wieder einlesen

## Technik in Kürze

- Reines HTML, CSS und JavaScript, ohne Build-Werkzeuge und ohne fremde Bibliotheken
- Daten liegen nur auf dem Gerät (IndexedDB), die App funktioniert offline
- Veröffentlichung über GitHub Pages, Tests und Deployment über GitHub Actions
- Optional: kleiner Cloudflare Worker (kostenloser Plan) für den Rezept-Import per Link

## Wichtig

Dieses Repository ist **öffentlich**. Niemals Sicherungsdateien, persönliche Daten
oder importierte Rezepte hier hochladen.
