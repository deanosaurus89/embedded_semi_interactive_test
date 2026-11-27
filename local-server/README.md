# Lokaler Merkmal-Viewer

Martin startet nur diese eine Datei: **DL-Merkmal-Viewer.cmd** (Doppelklick). Es ist nichts zu installieren. Windows PowerShell 5.1 genuegt.

Die Datei kopiert sich nach `%LOCALAPPDATA%\DL-Merkmal-Viewer\` und legt dort ab:

- `settings.json` (Server-URL, DPAPI-Token, Intervall; das Token nie im Klartext)
- `views\`
- `cache\models\<hash>.obj`
- `cache\www\` (die Oberflaeche, aus dem Projektordner oder von der oeffentlichen Seite)
- `logs\helper.log`

Der kleine Statusdialog zeigt die Version und oeffnet den Browser auf `http://localhost:8765/`. Server-URL, Token und Intervall stehen dort unter **Einstellungen**, nicht mehr in einem Windows-Formular. DataLoop wird nur per GET abgefragt. Der Dienst bindet nur an localhost.

## Ablauf

1. Doppelklick. Der Browser zeigt eine leere Seite.
2. **Einstellungen**: Server-URL, Token, Intervall. Speichern. Das Token kommt nicht zurueck in die Seite.
3. Projekt suchen.
4. Teilevorlage waehlen. Hat das Projekt keine, ein Teil ohne Vorlage waehlen.
5. Referenzobjekte anhaken (Name und Groesse, Warnung ueber 50 MB). Gleiche Datei nur einmal laden.
6. Merkmale anhaken, hoechstens 10, mit **Kleine Beschriftungen** hoechstens 20.
7. **Uebernehmen**, dann **Vorbereiten** wie bisher.

```html
<iframe src="http://localhost:8765/" title="Merkmale"></iframe>
```

Die oeffentliche GitHub-Seite bleibt die Milkyway-Beispielansicht und zeigt einen Hinweis, den Helfer zu starten.
