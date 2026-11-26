# Lokaler Merkmal-Viewer

Der Helfer zeigt dieselbe Seite wie GitHub Pages, liest aber Messwerte von PolyWorks|DataLoop und stellt sie unter `/data/live-measurements.json` bereit. Die Seite bleibt statisch. Es gibt keine Schreibzugriffe auf DataLoop.

## Start

`Start-Merkmal-Viewer.cmd` doppelklicken. Windows PowerShell 5.1 ist dabei, es muss nichts installiert werden.

Beim ersten Start öffnet sich ein kleines Fenster:

- **Server-URL**: leer lassen, bis der Host feststeht. Beispiel nur für das Format: `https://dataloop.example.com`
- **Projekt-ID oder Projektname**: GUID ohne Anführungszeichen, oder der Projektname
- **Zugriffstoken**: persönliches Token. Es wird mit DPAPI (`ConvertFrom-SecureString`) in `settings.json` neben dem Skript gespeichert und gilt nur für dieses Windows-Benutzerkonto.
- **Intervall**: Abstand der DataLoop-Abfrage, Vorgabe 60 Sekunden
- **Letzte Teile**: wie viele Stücke geholt werden, Vorgabe 50

`settings.json` steht in `.gitignore`. Token und Server-URL gehören nicht ins Repository.

Die Seite liegt auf `http://localhost:8765/`. Dafür ist kein Administratorrecht und kein URL-ACL nötig: das Präfix `http://localhost:` darf ein normaler Benutzer anlegen.

## Einbindung in DataLoop

Nur auf dem Rechner, auf dem das Skript läuft:

```html
<iframe src="http://localhost:8765/" title="Milkyway Merkmale"></iframe>
```

Edge und Chrome behandeln `http://localhost` als sichere Herkunft. Eine https-Seite von DataLoop darf dieses iframe laden. Andere Rechner erreichen den Dienst nicht.

In der Seite steht dann **Live**. Fehlen die Live-Daten, bleibt **Beispieldaten**. Die Fähnchen und die Kamera werden beim Nachladen nicht zurückgesetzt.

## Was gelesen wird

Basis ist `${Server-URL}/dataloopcore/api/metrology/v2`, mit `Authorization: Bearer`. Nur GET.

- Teile: `InspectorPieces?$filter=inspectorProject/id eq <guid>&$orderby=creationDateUser desc&$top=N` (GUID ohne Anführungszeichen). Ein Projektname wird als `InspectorProject/name eq '...'` geschickt, wie in der öffentlichen DataLoop-Doku.
- Je Teil einmal: `Controls?$filter=inspectorPiece/id eq <guid>`. Ein Control ist ein Merkmal. Der Schlüssel ist `objectName + " / " + name` und bleibt über die Teile gleich. `tolerance.low` und `tolerance.up` sind Abweichungen vom Nennwert: USL = Nennwert + up, LSL = Nennwert + low. Ohne Nennwert gilt der Messwert als Abweichung und die Grenzen sind low/up.
- `MeasurementObjects?$filter=inspectorPiece/id eq <guid>` liefert die Elemente (Slot, Circle, Cylinder, Plane, ...) für die Liste im Modus Vorbereiten.

Bereits gelesene Teile bleiben im Speicher. Beim nächsten Intervall werden nur neue Teile abgefragt.

## Vorbereiten und veröffentlichen

**Vorbereiten** setzt Fußpunkte, Kreise oder eine Rechteckfläche, ordnet Merkmale zu und legt die Beschriftung fest. **Abschließen** speichert das nur in diesem Browser (**Lokaler Entwurf**). **Export** schreibt `merkmale-einrichtung.json`. Diese Datei als `data/layout.json` ins Repository legen und veröffentlichen, dann sehen alle die **Veröffentlichte Ansicht**.
