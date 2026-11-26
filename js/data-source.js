// Loads characteristic JSON and refreshes it. No network policy lives here:
// the caller passes URLs. A localhost page prefers /data/live-measurements.json
// and otherwise stays on the example file.

const MIN_SECONDS = 5;

export function normalizeMeasurements(raw) {
  if (!raw || !Array.isArray(raw.characteristics)) {
    throw new Error("measurements schema");
  }
  const pieceNames = new Map();
  if (Array.isArray(raw.pieces)) {
    for (const piece of raw.pieces) {
      if (!piece || piece.id == null) continue;
      pieceNames.set(String(piece.id), {
        name: piece.name ? String(piece.name) : String(piece.id),
        timestamp: piece.timestamp ? String(piece.timestamp) : undefined,
      });
    }
  }
  const characteristics = raw.characteristics.filter(validCharacteristic).map((characteristic) => ({
    id: String(characteristic.id),
    name: String(characteristic.name || characteristic.id),
    objectName: characteristic.objectName ? String(characteristic.objectName) : "",
    controlName: characteristic.controlName ? String(characteristic.controlName) : "",
    displayName: characteristic.displayName ? String(characteristic.displayName) : "",
    unit: characteristic.unit || "mm",
    nominal: Number(characteristic.nominal),
    usl: Number(characteristic.usl),
    lsl: Number(characteristic.lsl),
    defaultAnchor: characteristic.defaultAnchor || null,
    measurements: characteristic.measurements
      .map((sample) => normalizeSample(sample, pieceNames))
      .filter((sample) => Number.isFinite(sample.value)),
  }));
  const features = Array.isArray(raw.features)
    ? raw.features
        .filter((feature) => feature && feature.name)
        .map((feature) => ({
          name: String(feature.name),
          type: feature.type ? String(feature.type) : "",
        }))
    : [];
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    source: raw.source ?? "example",
    refreshSeconds: positiveSeconds(raw.refreshSeconds),
    part: raw.part ?? { id: "part", name: "Bauteil" },
    characteristics,
    features,
    fetchedAt: raw.fetchedAt ? String(raw.fetchedAt) : "",
  };
}

function normalizeSample(sample, pieceNames) {
  const pieceId = String(sample.pieceId ?? "");
  const known = pieceNames.get(pieceId);
  return {
    pieceId,
    pieceName: sample.pieceName ? String(sample.pieceName) : known?.name || pieceId,
    value: Number(sample.value),
    timestamp: sample.timestamp ? String(sample.timestamp) : known?.timestamp,
    creationDateUser: sample.creationDateUser
      ? String(sample.creationDateUser)
      : (sample.timestamp ? String(sample.timestamp) : known?.timestamp || ""),
    test: sample.test ? String(sample.test) : "",
    userProperties: exampleProperties(sample, pieceId),
  };
}

function exampleProperties(sample, pieceId) {
  if (sample.userProperties && typeof sample.userProperties === "object") {
    const props = {};
    for (const [key, value] of Object.entries(sample.userProperties)) {
      if (value != null && value !== "") props[key] = String(value);
    }
    if (Object.keys(props).length) return props;
  }
  const tail = pieceId.replace(/\D/g, "") || "1000";
  const machines = ["CMM-1", "CMM-2", "CMM-3"];
  const shifts = ["Frueh", "Spaet", "Nacht"];
  const n = Number(tail) || 1000;
  return {
    Auftrag: `AUF-${tail}`,
    Maschine: machines[n % machines.length],
    Pruefer: "M. Beispiel",
    Schicht: shifts[n % shifts.length],
  };
}

function validCharacteristic(characteristic) {
  return (
    characteristic &&
    characteristic.id != null &&
    Array.isArray(characteristic.measurements) &&
    [characteristic.nominal, characteristic.usl, characteristic.lsl].every(isFiniteNumber)
  );
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= MIN_SECONDS ? number : null;
}

export function createDataSource({ exampleUrl, liveUrl, intervalSeconds, onData, onStatus }) {
  let timer = 0;
  let mode = "example";
  let stopped = false;

  async function readJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return normalizeMeasurements(await response.json());
  }

  function localhost() {
    const host = location.hostname;
    return host === "localhost" || host === "127.0.0.1";
  }

  async function tick(initial) {
    if (stopped) return;
    if (localhost()) {
      try {
        const live = await readJson(typeof liveUrl === "function" ? liveUrl() : liveUrl);
        const switched = mode !== "live";
        mode = "live";
        onData(live, { mode, initial, switched });
        onStatus({ mode, ok: true, fetchedAt: live.fetchedAt });
        return;
      } catch (error) {
        if (mode === "live") {
          onStatus({ mode: "live", ok: false, message: String(error.message || error) });
          return;
        }
      }
    }
    try {
      const example = await readJson(exampleUrl);
      mode = "example";
      onData(example, { mode, initial, switched: false });
      onStatus({ mode, ok: true });
    } catch (error) {
      if (initial) throw error;
      onStatus({ mode, ok: false, message: String(error.message || error) });
    }
  }

  function seconds() {
    return Math.max(MIN_SECONDS, Number(intervalSeconds()) || 60);
  }

  return {
    async start() {
      stopped = false;
      await tick(true);
      timer = window.setInterval(() => {
        tick(false).catch((error) => onStatus({ mode, ok: false, message: String(error.message || error) }));
      }, seconds() * 1000);
    },
    restart() {
      window.clearInterval(timer);
      if (stopped) return;
      timer = window.setInterval(() => {
        tick(false).catch(() => {});
      }, seconds() * 1000);
    },
    stop() {
      stopped = true;
      window.clearInterval(timer);
    },
    mode() {
      return mode;
    },
    refresh() {
      return tick(false);
    },
  };
}
