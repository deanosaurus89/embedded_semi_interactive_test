# Lokaler Merkmal-Viewer

Martin startet nur diese eine Datei: **DL-Merkmal-Viewer.cmd** (Doppelklick). Es ist nichts zu installieren. Windows PowerShell 5.1 genuegt.

Die Datei enthaelt den Start und das Programm. Sie kopiert die Oberflaeche nicht: sie laedt die oeffentliche Seite

https://deanosaurus89.github.io/embedded_semi_interactive_test/

und legt sie unter `%LOCALAPPDATA%\DL-Merkmal-Viewer\` ab. Das Referenzmodell kommt aus DataLoop (neuestes Teil, `Models`, dann die OBJ-Datei). Token und Server-URL liegen nur dort, das Token mit DPAPI geschuetzt. Beides steht nicht im Repository.

## Ablauf

1. Doppelklick.
2. Einmal Server-URL und persoenliches Token eintragen.
3. Projekt suchen, zum Beispiel `Milkyway`. Der Stern markiert genau ein Projekt. Ein neuer Stern ersetzt den alten.
4. Intervall waehlen (30 s, 1 min, 5 min, 15 min).
5. **Im Browser oeffnen** oder den iframe-Text kopieren:

```html
<iframe src="http://localhost:8765/" title="Milkyway Merkmale"></iframe>
```

`http://localhost` braucht kein Administratorrecht. Edge und Chrome lassen eine https-Seite von DataLoop dieses iframe laden. Es gilt nur auf dem Rechner, auf dem die Datei laeuft.

Die oeffentliche GitHub-Seite bleibt bei den Beispieldaten, solange dieser Dienst nicht antwortet.
