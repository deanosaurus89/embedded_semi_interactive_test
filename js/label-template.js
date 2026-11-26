export const DEFAULT_TEMPLATE = {
  size: "M",
  chart: "line",
  showLimits: true,
  showNominal: true,
  showMean: true,
  showSigma: true,
  showLastValue: true,
  showCpk: true,
  highlightOot: true,
  decimals: 3,
  showUnit: true,
  showName: true,
};

const SIZES = new Set(["S", "M", "L"]);
const CHARTS = new Set(["line", "bar", "values"]);

export function normalizeTemplate(raw) {
  const template = { ...DEFAULT_TEMPLATE };
  if (!raw || typeof raw !== "object") return template;
  if (SIZES.has(raw.size)) template.size = raw.size;
  if (CHARTS.has(raw.chart)) template.chart = raw.chart;
  for (const key of [
    "showLimits",
    "showNominal",
    "showMean",
    "showSigma",
    "showLastValue",
    "showCpk",
    "highlightOot",
    "showUnit",
    "showName",
  ]) {
    if (typeof raw[key] === "boolean") template[key] = raw[key];
  }
  const decimals = Number(raw.decimals);
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 6) template.decimals = decimals;
  return template;
}

export function computeStats(values, characteristic) {
  const count = values.length;
  const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : null;
  let sigma = null;
  if (count >= 2 && mean != null) {
    const square = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    sigma = Math.sqrt(square / (count - 1));
  }
  let cp = null;
  let cpk = null;
  if (sigma && sigma > 0 && mean != null) {
    cp = (characteristic.usl - characteristic.lsl) / (6 * sigma);
    const cpu = (characteristic.usl - mean) / (3 * sigma);
    const cpl = (mean - characteristic.lsl) / (3 * sigma);
    cpk = Math.min(cpu, cpl);
  }
  const outCount = values.filter((value) => isOut(value, characteristic)).length;
  return { count, mean, sigma, cp, cpk, outCount };
}

export function isOut(value, characteristic) {
  return value > characteristic.usl || value < characteristic.lsl;
}

export function renderFlag(characteristic, samples, template) {
  const fmt = numberFormat(template.decimals);
  const fmtIndex = numberFormat(2);
  const values = samples.map((sample) => sample.value);
  const stats = computeStats(values, characteristic);
  const last = samples[samples.length - 1];
  const lastOut = Boolean(template.highlightOot && last && isOut(last.value, characteristic));
  const unit = template.showUnit ? ` ${escapeHtml(characteristic.unit)}` : "";
  const name = template.showName
    ? `<h2 class="flag-name">${escapeHtml(characteristic.name)}</h2>`
    : "";
  const missing = !samples.length;

  let valueRow = "";
  if (template.showLastValue) {
    if (!last) {
      valueRow = `<p class="flag-meta">Keine Istwerte</p>`;
    } else {
      const cls = lastOut ? "oot" : "ok";
      const title = sampleTitle(last, fmt, characteristic.unit);
      valueRow = `<div class="flag-ist"><span class="k">Ist</span><span class="v ${cls}" title="${escapeHtml(title)}">${fmt.format(last.value)}</span>${template.showUnit ? `<span class="u">${escapeHtml(characteristic.unit)}</span>` : ""}</div>`;
    }
  }

  const limits = [];
  if (template.showNominal) limits.push(`<span>Nenn ${fmt.format(characteristic.nominal)}</span>`);
  if (template.showLimits) {
    limits.push(`<span class="limit">USL ${fmt.format(characteristic.usl)}</span>`);
    limits.push(`<span class="limit">LSL ${fmt.format(characteristic.lsl)}</span>`);
  }
  const limitRow = limits.length ? `<p class="flag-limits">${limits.join("")}</p>` : "";

  let chart = "";
  if (!missing && template.chart === "line") chart = lineChart(characteristic, samples, template, stats, fmt);
  if (!missing && template.chart === "bar") chart = barChart(characteristic, samples, template, stats, fmt);
  if (!missing && template.chart === "values") chart = valuesBlock(stats, fmt, fmtIndex, template, unit);

  const legend = template.chart === "values" || missing ? "" : legendRow(template);
  const metaBits = [];
  if (!missing) metaBits.push(`n = ${stats.count}`);
  if (!missing && template.showMean && stats.mean != null) metaBits.push(`Mittel ${fmt.format(stats.mean)}`);
  if (!missing && template.showCpk) {
    metaBits.push(`Cp ${stats.cp == null ? "–" : fmtIndex.format(stats.cp)}`);
    metaBits.push(`Cpk ${stats.cpk == null ? "–" : fmtIndex.format(stats.cpk)}`);
  }
  if (!missing) {
    metaBits.push(stats.outCount === 0 ? "in Toleranz" : `${stats.outCount} außer Toleranz`);
  }
  const meta = metaBits.length ? `<p class="flag-meta">${metaBits.join(" · ")}</p>` : "";

  return {
    outOfTolerance: lastOut,
    count: samples.length,
    outCount: stats.outCount,
    html: `${name}${valueRow}${limitRow}${chart}${legend}${meta}`,
  };
}

function numberFormat(decimals) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function sampleTitle(sample, fmt, unit) {
  const name = sample.pieceName || sample.pieceId || "Teil";
  const when = sample.timestamp ? ` · ${sample.timestamp}` : "";
  const verdict = sample.test ? ` · ${sample.test}` : "";
  return `${name}: ${fmt.format(sample.value)} ${unit}${when}${verdict}`;
}

function scaleOf(characteristic, values, stats, template) {
  const extras = [...values, characteristic.usl, characteristic.lsl, characteristic.nominal];
  if (template.showMean && stats.mean != null) extras.push(stats.mean);
  if (template.showSigma && stats.mean != null && stats.sigma) {
    extras.push(stats.mean + 3 * stats.sigma, stats.mean - 3 * stats.sigma);
  }
  let min = Math.min(...extras);
  let max = Math.max(...extras);
  const pad = (max - min) * 0.16 || Math.abs(characteristic.nominal) * 0.01 || 0.001;
  min -= pad;
  max += pad;
  return { min, max: max === min ? min + 1 : max };
}

function lineChart(characteristic, samples, template, stats, fmt) {
  const values = samples.map((sample) => sample.value);
  const { min, max } = scaleOf(characteristic, values, stats, template);
  const width = 200;
  const height = 52;
  const padL = 2;
  const padR = 2;
  const padT = 4;
  const padB = 4;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const xAt = (index) => padL + (values.length === 1 ? innerW / 2 : (index / (values.length - 1)) * innerW);
  const yAt = (value) => padT + (1 - (value - min) / (max - min)) * innerH;
  const horizontal = (value, className) =>
    `<line class="${className}" x1="${padL}" x2="${width - padR}" y1="${yAt(value).toFixed(2)}" y2="${yAt(value).toFixed(2)}" />`;
  const parts = [];
  if (template.showLimits) {
    const top = Math.min(yAt(characteristic.usl), yAt(characteristic.lsl));
    const band = Math.abs(yAt(characteristic.usl) - yAt(characteristic.lsl));
    parts.push(`<rect class="band" x="${padL}" y="${top.toFixed(2)}" width="${innerW}" height="${band.toFixed(2)}"></rect>`);
    parts.push(horizontal(characteristic.usl, "limit"));
    parts.push(horizontal(characteristic.lsl, "limit"));
  }
  if (template.showNominal) parts.push(horizontal(characteristic.nominal, "nominal"));
  if (template.showMean && stats.mean != null) parts.push(horizontal(stats.mean, "mean"));
  if (template.showSigma && stats.sigma) {
    parts.push(horizontal(stats.mean + 3 * stats.sigma, "sigma"));
    parts.push(horizontal(stats.mean - 3 * stats.sigma, "sigma"));
  }
  if (values.length > 1) {
    parts.push(
      `<polyline class="series" points="${values
        .map((value, index) => `${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`)
        .join(" ")}" />`,
    );
  }
  const radius = values.length > 40 ? 1.5 : values.length > 20 ? 2.05 : 2.5;
  parts.push(
    values
      .map((value, index) => {
        const out = template.highlightOot && isOut(value, characteristic);
        return `<circle class="pt${out ? " oot" : ""}" cx="${xAt(index).toFixed(2)}" cy="${yAt(value).toFixed(2)}" r="${out ? radius + 1 : radius}"><title>${escapeHtml(sampleTitle(samples[index], fmt, characteristic.unit))}</title></circle>`;
      })
      .join(""),
  );
  return svgWrap(characteristic, samples.length, stats.outCount, width, height, parts.join(""));
}

function barChart(characteristic, samples, template, stats, fmt) {
  const values = samples.map((sample) => sample.value);
  const { min, max } = scaleOf(characteristic, values, stats, template);
  const width = 200;
  const height = 52;
  const padL = 2;
  const padR = 2;
  const padT = 4;
  const padB = 4;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const yAt = (value) => padT + (1 - (value - min) / (max - min)) * innerH;
  const slot = innerW / values.length;
  const barW = Math.max(0.8, slot * 0.72);
  const baseline = yAt(Math.min(max, Math.max(min, 0)) ? 0 : min);
  const zero = min <= 0 && max >= 0 ? yAt(0) : yAt(min);
  const parts = [];
  if (template.showLimits) {
    parts.push(`<line class="limit" x1="${padL}" x2="${width - padR}" y1="${yAt(characteristic.usl).toFixed(2)}" y2="${yAt(characteristic.usl).toFixed(2)}" />`);
    parts.push(`<line class="limit" x1="${padL}" x2="${width - padR}" y1="${yAt(characteristic.lsl).toFixed(2)}" y2="${yAt(characteristic.lsl).toFixed(2)}" />`);
  }
  if (template.showNominal) {
    parts.push(`<line class="nominal" x1="${padL}" x2="${width - padR}" y1="${yAt(characteristic.nominal).toFixed(2)}" y2="${yAt(characteristic.nominal).toFixed(2)}" />`);
  }
  if (template.showMean && stats.mean != null) {
    parts.push(`<line class="mean" x1="${padL}" x2="${width - padR}" y1="${yAt(stats.mean).toFixed(2)}" y2="${yAt(stats.mean).toFixed(2)}" />`);
  }
  parts.push(
    values
      .map((value, index) => {
        const y = yAt(value);
        const top = Math.min(y, zero);
        const h = Math.max(0.8, Math.abs(zero - y));
        const out = template.highlightOot && isOut(value, characteristic);
        const x = padL + index * slot + (slot - barW) / 2;
        return `<rect class="bar${out ? " oot" : ""}" x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}"><title>${escapeHtml(sampleTitle(samples[index], fmt, characteristic.unit))}</title></rect>`;
      })
      .join(""),
  );
  void baseline;
  return svgWrap(characteristic, samples.length, stats.outCount, width, height, parts.join(""));
}

function valuesBlock(stats, fmt, fmtIndex, template) {
  const rows = [];
  if (template.showMean && stats.mean != null) rows.push(`<span>Mittel ${fmt.format(stats.mean)}</span>`);
  if (template.showSigma && stats.sigma != null) rows.push(`<span>σ ${fmt.format(stats.sigma)}</span>`);
  if (template.showCpk) {
    rows.push(`<span>Cp ${stats.cp == null ? "–" : fmtIndex.format(stats.cp)}</span>`);
    rows.push(`<span>Cpk ${stats.cpk == null ? "–" : fmtIndex.format(stats.cpk)}</span>`);
  }
  return `<div class="value-block" data-n="${stats.count}" data-oot="${stats.outCount}">${rows.join("")}</div>`;
}

function svgWrap(characteristic, count, outCount, width, height, body) {
  const label = `${characteristic.name}: ${count} Istwerte, ${outCount} außer Toleranz`;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}" data-n="${count}" data-oot="${outCount}">${body}</svg>`;
}

function legendRow(template) {
  const items = [`<span class="series"><i></i>Ist</span>`];
  if (template.showNominal) items.push(`<span class="nominal"><i></i>Nenn</span>`);
  if (template.showMean) items.push(`<span class="mean"><i></i>Mittel</span>`);
  if (template.showLimits) items.push(`<span class="limit"><i></i>USL/LSL</span>`);
  if (template.showSigma) items.push(`<span class="sigma"><i></i>±3σ</span>`);
  return `<p class="legend" aria-hidden="true">${items.join("")}</p>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
