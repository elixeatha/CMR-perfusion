// Pure analysis logic for CMR quantitative perfusion.
// No DOM access here so it can be unit-tested in Node (see tests/).

// AHA 16-segment model. Angles are in degrees, counter-clockwise from 3 o'clock,
// in the standard bullseye orientation (anterior at top, septum on the left).
// ring: 0 = basal (outer), 1 = mid, 2 = apical (inner). Segment 17 (apex) is ignored.
export const SEGMENTS = [
  { id: 1, name: 'Basal anterior', ring: 0, start: 60, end: 120 },
  { id: 2, name: 'Basal anteroseptal', ring: 0, start: 120, end: 180 },
  { id: 3, name: 'Basal inferoseptal', ring: 0, start: 180, end: 240 },
  { id: 4, name: 'Basal inferior', ring: 0, start: 240, end: 300 },
  { id: 5, name: 'Basal inferolateral', ring: 0, start: 300, end: 360 },
  { id: 6, name: 'Basal anterolateral', ring: 0, start: 0, end: 60 },
  { id: 7, name: 'Mid anterior', ring: 1, start: 60, end: 120 },
  { id: 8, name: 'Mid anteroseptal', ring: 1, start: 120, end: 180 },
  { id: 9, name: 'Mid inferoseptal', ring: 1, start: 180, end: 240 },
  { id: 10, name: 'Mid inferior', ring: 1, start: 240, end: 300 },
  { id: 11, name: 'Mid inferolateral', ring: 1, start: 300, end: 360 },
  { id: 12, name: 'Mid anterolateral', ring: 1, start: 0, end: 60 },
  { id: 13, name: 'Apical anterior', ring: 2, start: 45, end: 135 },
  { id: 14, name: 'Apical septal', ring: 2, start: 135, end: 225 },
  { id: 15, name: 'Apical inferior', ring: 2, start: 225, end: 315 },
  { id: 16, name: 'Apical lateral', ring: 2, start: 315, end: 405 },
];

export const SEGMENT_IDS = SEGMENTS.map((s) => s.id);
export const TERRITORIES = ['LAD', 'LCx', 'RCA'];

export const DEFAULT_TERRITORIES = {
  1: 'LAD', 2: 'LAD', 7: 'LAD', 8: 'LAD', 13: 'LAD', 14: 'LAD',
  3: 'RCA', 4: 'RCA', 9: 'RCA', 10: 'RCA', 15: 'RCA',
  5: 'LCx', 6: 'LCx', 11: 'LCx', 12: 'LCx', 16: 'LCx',
};

// PLACEHOLDER thresholds. These must be checked against your Chiribiri reference values
// and changed in Settings before any use. See README.
export const DEFAULT_SETTINGS = {
  stressMbfCutoff: 1.94, // ml/g/min; segment layer abnormal if stress MBF below this...
  mprCutoff: 2.0, // ...AND MPR (stress/rest) below this
  endoEpiCutoff: 1.0, // stress endo:epi below this = inverted gradient (supportive)
  endoEpiDropPct: 15, // stress endo:epi falls by >= this % vs rest endo:epi (supportive)
  minContiguous: 2, // N contiguous abnormal segments within one territory
  diffuseMinPerTerritory: 1, // abnormal segments needed in EVERY territory to call "diffuse"
  plausibleMin: 0.2,
  plausibleMax: 6,
  mbfScaleMax: 4,
  mprScaleMax: 4,
  territories: { ...DEFAULT_TERRITORIES },
};

export function cloneSettings(s = DEFAULT_SETTINGS) {
  return JSON.parse(JSON.stringify(s));
}

// ---------- Geometry / adjacency ----------

function arcOverlap(a, b) {
  let best = 0;
  for (const shift of [-360, 0, 360]) {
    const lo = Math.max(a.start, b.start + shift);
    const hi = Math.min(a.end, b.end + shift);
    best = Math.max(best, hi - lo);
  }
  return best;
}

function shareEdge(a, b) {
  const m = (x) => ((x % 360) + 360) % 360;
  return m(a.end) === m(b.start) || m(b.end) === m(a.start);
}

// Two segments are neighbours on the bullseye if they sit side by side in the same ring,
// or if they are in adjacent rings and overlap angularly.
export const ADJACENCY = (() => {
  const adj = {};
  for (const a of SEGMENTS) {
    adj[a.id] = [];
    for (const b of SEGMENTS) {
      if (a.id === b.id) continue;
      if (a.ring === b.ring && shareEdge(a, b)) adj[a.id].push(b.id);
      else if (Math.abs(a.ring - b.ring) === 1 && arcOverlap(a, b) > 0) adj[a.id].push(b.id);
    }
  }
  return adj;
})();

// Connected clusters of `ids`, using bullseye adjacency restricted to those ids.
export function clusters(ids) {
  const set = new Set(ids);
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const n of ADJACENCY[cur]) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    out.push(comp.sort((x, y) => x - y));
  }
  return out.sort((x, y) => y.length - x.length);
}

// ---------- Validation ----------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// values: { [segId]: { endo, epi } }
export function validateValues(values, settings = DEFAULT_SETTINGS, label = '') {
  const cells = {};
  const errors = [];
  const warnings = [];
  const pre = label ? `${label}: ` : '';
  for (const id of SEGMENT_IDS) {
    cells[id] = { endo: null, epi: null };
    for (const layer of ['endo', 'epi']) {
      const v = values?.[id]?.[layer];
      if (!isNum(v)) {
        cells[id][layer] = 'missing';
        errors.push(`${pre}segment ${id} ${layer} is missing`);
      } else if (v < settings.plausibleMin || v > settings.plausibleMax) {
        cells[id][layer] = 'implausible';
        warnings.push(`${pre}segment ${id} ${layer} = ${v} is outside ${settings.plausibleMin}–${settings.plausibleMax}`);
      }
    }
  }
  // Duplicated rows (same endo AND epi as another segment) often mean a mis-read line.
  const seen = new Map();
  for (const id of SEGMENT_IDS) {
    const r = values?.[id];
    if (!r || !isNum(r.endo) || !isNum(r.epi)) continue;
    const key = `${r.endo}|${r.epi}`;
    if (seen.has(key)) {
      const other = seen.get(key);
      for (const sid of [other, id]) {
        for (const layer of ['endo', 'epi']) if (!cells[sid][layer]) cells[sid][layer] = 'duplicate';
      }
      warnings.push(`${pre}segments ${other} and ${id} have identical endo and epi values (possible duplicated line)`);
    } else seen.set(key, id);
  }
  return { cells, errors, warnings };
}

// Cross-check stress vs rest (e.g. photos placed in the wrong slot).
export function crossCheck(stress, rest) {
  const warnings = [];
  const mean = (vals) => {
    const xs = SEGMENT_IDS.flatMap((id) => [vals?.[id]?.endo, vals?.[id]?.epi]).filter(isNum);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  const ms = mean(stress);
  const mr = mean(rest);
  if (isNum(ms) && isNum(mr) && mr >= ms) {
    warnings.push(`Mean rest MBF (${mr.toFixed(2)}) is not lower than mean stress MBF (${ms.toFixed(2)}). Were the stress and rest photos swapped?`);
  }
  return warnings;
}

// ---------- Analysis ----------

export function analyse(stress, rest, settings = DEFAULT_SETTINGS) {
  const s = settings;
  const rows = SEGMENTS.map((seg) => {
    const sEndo = stress[seg.id].endo;
    const sEpi = stress[seg.id].epi;
    const rEndo = rest[seg.id].endo;
    const rEpi = rest[seg.id].epi;
    const sMean = (sEndo + sEpi) / 2;
    const rMean = (rEndo + rEpi) / 2;
    const mprEndo = sEndo / rEndo;
    const mprEpi = sEpi / rEpi;
    const mprMean = sMean / rMean;
    const ratioStress = sEndo / sEpi;
    const ratioRest = rEndo / rEpi;
    const endoAbn = sEndo < s.stressMbfCutoff && mprEndo < s.mprCutoff;
    const epiAbn = sEpi < s.stressMbfCutoff && mprEpi < s.mprCutoff;
    const abnormal = endoAbn || epiAbn;
    const pattern = endoAbn && epiAbn ? 'transmural' : endoAbn ? 'subendocardial' : epiAbn ? 'subepicardial' : '';
    const ratioInverted = ratioStress < s.endoEpiCutoff;
    const ratioDropPct = ratioRest > 0 ? ((ratioRest - ratioStress) / ratioRest) * 100 : 0;
    const ratioDrop = ratioDropPct >= s.endoEpiDropPct;
    return {
      id: seg.id,
      name: seg.name,
      territory: s.territories[seg.id],
      sEndo, sEpi, rEndo, rEpi, sMean, rMean,
      mprEndo, mprEpi, mprMean,
      ratioStress, ratioRest, ratioDropPct,
      endoAbn, epiAbn, abnormal, pattern,
      ratioInverted, ratioDrop,
      ratioSupport: ratioInverted || ratioDrop,
    };
  });

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  const territories = TERRITORIES.map((t) => {
    const segs = rows.filter((r) => r.territory === t).map((r) => r.id);
    const abn = segs.filter((id) => byId[id].abnormal);
    const cl = clusters(abn);
    const largest = cl[0]?.length || 0;
    const ischaemic = largest >= s.minContiguous;
    const contiguous = cl.filter((c) => c.length >= s.minContiguous).flat().sort((a, b) => a - b);
    const isolated = cl.filter((c) => c.length < s.minContiguous).flat().sort((a, b) => a - b);
    return {
      territory: t,
      segments: segs,
      abnormal: abn,
      clusters: cl,
      largestCluster: largest,
      ischaemic,
      ischaemicSegments: contiguous,
      isolatedSegments: isolated,
      supportive: contiguous.filter((id) => byId[id].ratioSupport),
    };
  });

  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const global = {
    stressMbf: avg(rows.map((r) => r.sMean)),
    restMbf: avg(rows.map((r) => r.rMean)),
    stressEndo: avg(rows.map((r) => r.sEndo)),
    stressEpi: avg(rows.map((r) => r.sEpi)),
  };
  global.mpr = global.stressMbf / global.restMbf;
  global.ratioStress = global.stressEndo / global.stressEpi;

  const ischaemicTerritories = territories.filter((t) => t.ischaemic).map((t) => t.territory);
  const diffuse = territories.every((t) => t.abnormal.length >= Math.max(1, s.diffuseMinPerTerritory));
  const ratioPreserved = global.ratioStress >= s.endoEpiCutoff;
  const microvascular = global.stressMbf < s.stressMbfCutoff && ratioPreserved;

  const result = {
    rows,
    territories,
    global,
    ischaemia: ischaemicTerritories.length > 0,
    ischaemicTerritories,
    diffuse,
    microvascular,
    ratioPreserved,
    abnormalCount: rows.filter((r) => r.abnormal).length,
  };
  result.summary = buildSummary(result, s);
  return result;
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');

export function buildSummary(r, s) {
  const lines = [];
  if (r.ischaemia) {
    const n = r.ischaemicTerritories.length;
    lines.push(
      `Inducible ischaemia: YES — ${r.ischaemicTerritories.join(', ')} territor${n > 1 ? 'ies' : 'y'}` +
        (r.diffuse ? '.' : n === 1 ? ' (single-territory pattern).' : ' (multi-territory pattern).')
    );
  } else {
    lines.push(
      r.abnormalCount
        ? `Inducible ischaemia: NO territory meets the rule of ≥${s.minContiguous} contiguous abnormal segments.`
        : 'Inducible ischaemia: NO — no segment meets both the stress MBF and MPR criteria.'
    );
  }
  for (const t of r.territories) {
    if (t.ischaemic) {
      const rowsT = r.rows.filter((x) => t.ischaemicSegments.includes(x.id));
      const sub = rowsT.filter((x) => x.pattern === 'subendocardial').length;
      const trans = rowsT.filter((x) => x.pattern === 'transmural').length;
      lines.push(
        `${t.territory}: segments ${t.ischaemicSegments.join(', ')}` +
          ` (${trans} transmural, ${sub} subendocardial-only)` +
          `; endo:epi inversion/drop supports this in ${t.supportive.length}/${t.ischaemicSegments.length}.`
      );
    }
    if (t.isolatedSegments.length) {
      lines.push(`${t.territory}: isolated abnormal segment(s) ${t.isolatedSegments.join(', ')} — below the contiguity rule, not called ischaemic.`);
    }
  }
  lines.push(
    `Global: stress MBF ${f2(r.global.stressMbf)}, rest MBF ${f2(r.global.restMbf)} ml/g/min, MPR ${f2(r.global.mpr)}, stress endo:epi ${f2(r.global.ratioStress)}.`
  );
  if (r.diffuse) {
    lines.push('Pattern: abnormal segments in ALL three territories — suggests diffuse disease rather than single-territory ischaemia.');
    if (r.microvascular) {
      lines.push('Endo:epi gradient preserved with globally low stress MBF — consider coronary microvascular dysfunction.');
    } else {
      lines.push('Endo:epi gradient globally inverted — consider balanced multivessel epicardial CAD (correlate with angiography/CT).');
    }
  } else if (r.microvascular) {
    lines.push('Global stress MBF is low with a preserved endo:epi gradient — consider a microvascular component.');
  }
  return lines;
}

// ---------- Helpers ----------

export function emptyValues() {
  return Object.fromEntries(SEGMENT_IDS.map((id) => [id, { endo: null, epi: null }]));
}

export function valuesFromArrays(endo, epi) {
  return Object.fromEntries(SEGMENT_IDS.map((id, i) => [id, { endo: endo[i], epi: epi[i] }]));
}

// Normalise the JSON returned by the vision extraction into { values, warnings }.
export function normaliseExtraction(json) {
  const values = emptyValues();
  const warnings = [];
  const seen = new Set();
  for (const item of json?.segments || []) {
    const id = Number(item.segment);
    if (!SEGMENT_IDS.includes(id)) {
      warnings.push(`Ignored row with segment number ${item.segment}`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`Segment ${id} was returned more than once — check it`);
      continue;
    }
    seen.add(id);
    values[id] = {
      endo: isNum(item.endo) ? item.endo : null,
      epi: isNum(item.epi) ? item.epi : null,
    };
  }
  for (const w of json?.warnings || []) warnings.push(`Reader: ${w}`);
  return { values, warnings, mapType: json?.map_type || 'unknown' };
}
