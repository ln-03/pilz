# Pilzraum v5

Offline-first PWA für einen räumlichen Pilz-Taxonomiebaum auf Android/Samsung.

## Neu in v5

- neuer 3D-Aufbau: Klassen werden über etwa 3/4 einer Kugel verteilt; darunter bleiben verwandte Ordnungen/Familien/Gattungen in kompakten räumlichen Sektoren
- Farbe = **Klasse** (nicht mehr Ordnung)
- Fungi ist der gemeinsame Mittelpunkt; Basidiomycota und Ascomycota hängen sichtbar am selben Root
- Species-Nodes sind **alle gleich groß**; nur die Helligkeit kodiert iNaturalist-Häufigkeit
- innere Taxonomie-Nodes sind etwas dicker, aber kleiner als Species-Endpunkte
- Glow/Halo um Nodes für bessere Tiefenwahrnehmung
- kaum noch permanente Labels: Fungi + Stämme bleiben als räumliche Anker sichtbar; andere Namen erscheinen bei Maus-Hover bzw. beim Antippen
- Hell-/Dunkelmodus bleibt vorhanden
- deutsche Namen werden ausschließlich aus `common_name_de` gelesen; englische Fallback-Namen werden nicht als Deutsch ausgegeben
- Service-Worker-Cache: `pilzraum-v5`
- Layout-Key: `pilzraum-layout-v5`

## Installation über bestehende v4/v4.1-App

Die Dateien aus der `code_only`-ZIP in deinen bisherigen `pilzraum`-Ordner kopieren und ersetzen. **`data/` und `assets/` nicht überschreiben.**

Danach lokalen Server starten:

```powershell
python -m http.server 8000
```

und `http://localhost:8000` öffnen. Falls noch alte Dateien sichtbar sind: `Strg + Shift + R`.

## Deutsche Namen aktualisieren

```powershell
& "C:\Program Files\R\R-4.6.1\bin\Rscript.exe" ".\R\update_german_names.R"
```

Das lädt keine Fotos neu, sondern ergänzt nur `common_name_de` in der vorhandenen `data/taxa.json`.


## v5.4 – 3D-Geometrie direkt in der App einstellen

Oben über **⚙ Darstellung** lassen sich jetzt live und dauerhaft einstellen:

- Pfadlänge für Stamm, Klasse, Ordnung, Familie, Gattung und Art
- Abzweigungswinkel für jede dieser Ebenen; beim Stamm ist dies die Spreizung der großen Stämme
- Helligkeit der Pfade
- Dicke der Pfade
- Größe aller Species-Endkugeln (alle Species bleiben gleich groß)

Die Werte werden lokal im Browser gespeichert. **Standardwerte** setzt nur die Darstellung zurück und verändert weder Taxonomie noch Notizen, Funde oder Fotos.

## v5.5 – Taxonomische Filter auf jeder Ebene
Im Filterpanel gibt es jetzt kaskadierende Filter für Stamm, Klasse, Ordnung, Familie, Gattung und Art. Jede Ebene kann einzeln verwendet werden; eine Auswahl auf einer höheren Ebene schränkt die darunterliegenden Auswahlfelder automatisch ein. Bei Arten wird – wenn vorhanden – der deutsche Name zusammen mit dem wissenschaftlichen Namen angezeigt.


## v5.6 – gefilterte Ansicht neu aufspannen
Im Darstellungsmenü kann zwischen „Gesamtbaum-Positionen“ und „Subset neu aufspannen“ gewählt werden. Im Subset-Modus werden nur die aktuell sichtbaren Taxa für das Layout berücksichtigt. Pfadlängen und Abzweigungswinkel können dort temporär verändert werden, ohne die global gespeicherten Baumwerte zu überschreiben.
