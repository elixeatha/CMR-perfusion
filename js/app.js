import {
  SEGMENTS, SEGMENT_IDS, TERRITORIES, DEFAULT_SETTINGS, cloneSettings,
  validateValues, crossCheck, analyse, emptyValues, normaliseExtraction,
} from './logic.js';
import { bullseyeSVG, legendSVG } from './bullseye.js';
import { extractFromImage, prepareImage, DEFAULT_MODEL } from './extract.js';
import { TEST_CASES } from './testcases.js';

// ---------- Storage (settings + optional API key only; never values or photos) ----------
const LS_SETTINGS = 'cmrp.settings.v1';
const LS_KEY = 'cmrp.apikey';
const LS_MODEL = 'cmrp.model';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc. */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function loadSettings() {
  const s = cloneSettings();
  try {
    const saved = JSON.parse(store.get(LS_SETTINGS) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (k === 'territories') continue;
        if (Number.isFinite(saved[k])) s[k] = saved[k];
      }
      if (saved.territories) {
        for (const id of SEGMENT_IDS) if (TERRITORIES.includes(saved.territories[id])) s.territories[id] = saved.territories[id];
      }
    }
  } catch { /* ignore corrupt settings */ }
  return s;
}

// ---------- State ----------
const state = {
  settings: loadSettings(),
  apiKey: store.get(LS_KEY) || '',
  remember: !!store.get(LS_KEY),
  model: store.get(LS_MODEL) || DEFAULT_MODEL,
  maps: {
    stress: { values: emptyValues(), photo: null, mapType: null, notes: [] },
    rest: { values: emptyValues(), photo: null, mapType: null, notes: [] },
  },
  confirmed: false,
  result: null,
  selectedSeg: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const LABEL = { stress: 'Stress', rest: 'Rest' };

// ---------- Map cards ----------
function renderMapCard(kind) {
  const card = $(`.map[data-kind="${kind}"]`);
  const m = state.maps[kind];
  card.innerHTML = `
    <div class="map-head">
      <h2>${LABEL[kind]} map</h2>
      <span class="muted small">MBF, ml/g/min</span>
    </div>
    <div class="btnrow" style="margin-top:8px">
      <label class="btn filebtn">Take photo<input type="file" accept="image/*" capture="environment" data-file="${kind}"></label>
      <label class="btn filebtn ghost">Upload<input type="file" accept="image/*" data-file="${kind}"></label>
      <button type="button" class="btn primary" data-read="${kind}" ${m.photo ? '' : 'disabled'}>Read values</button>
    </div>
    <p class="status" data-status="${kind}"></p>
    <div class="map-body ${m.photo ? 'has-photo' : ''}">
      ${m.photo ? `<div class="photo"><img src="${m.photo}" alt="${LABEL[kind]} map photo" data-zoom="${kind}"><span class="muted zoom-hint">Tap photo to enlarge</span></div>` : ''}
      <div>
        <table class="vals">
          <thead><tr><th>#</th><th>Segment</th><th>Endo</th><th>Epi</th></tr></thead>
          <tbody>
            ${SEGMENTS.map((s) => `
              <tr>
                <td>${s.id}</td>
                <td class="segname">${s.name}<div class="flag" data-flag="${kind}-${s.id}"></div></td>
                <td><input type="text" inputmode="decimal" autocomplete="off" data-kind="${kind}" data-seg="${s.id}" data-layer="endo" value="${fmtInput(m.values[s.id].endo)}" aria-label="${LABEL[kind]} segment ${s.id} endo"></td>
                <td><input type="text" inputmode="decimal" autocomplete="off" data-kind="${kind}" data-seg="${s.id}" data-layer="epi" value="${fmtInput(m.values[s.id].epi)}" aria-label="${LABEL[kind]} segment ${s.id} epi"></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

const fmtInput = (v) => (Number.isFinite(v) ? String(v) : '');

function setStatus(kind, msg, cls = '') {
  const el = $(`[data-status="${kind}"]`);
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${cls}`;
}

function parseNum(str) {
  const t = String(str).trim().replace(',', '.');
  if (t === '') return null;
  if (!/^[-+]?\d*\.?\d+$/.test(t)) return NaN;
  return parseFloat(t);
}

// ---------- Validation / issues ----------
function refreshValidation() {
  const s = state.settings;
  const errors = [];
  const warnings = [];
  for (const kind of ['stress', 'rest']) {
    const m = state.maps[kind];
    const v = validateValues(m.values, s, LABEL[kind]);
    errors.push(...v.errors);
    warnings.push(...v.warnings);
    for (const id of SEGMENT_IDS) {
      const flags = [];
      for (const layer of ['endo', 'epi']) {
        const input = $(`input[data-kind="${kind}"][data-seg="${id}"][data-layer="${layer}"]`);
        const st = v.cells[id][layer];
        if (input) input.className = st || '';
        if (st) flags.push(`${layer} ${st}`);
      }
      const fl = $(`[data-flag="${kind}-${id}"]`);
      if (fl) {
        fl.textContent = flags.join(', ');
        fl.className = `flag ${flags.every((f) => f.endsWith('duplicate')) ? 'dup' : ''}`;
      }
    }
    for (const n of m.notes) warnings.push(`${LABEL[kind]}: ${n}`);
    if (m.mapType && m.mapType !== 'unknown' && m.mapType !== kind) {
      warnings.push(`${LABEL[kind]} slot: the photo appears to be labelled "${m.mapType}". Check that the photos are in the right slots.`);
    }
  }
  const missingCount = errors.length;
  if (!missingCount) warnings.push(...crossCheck(state.maps.stress.values, state.maps.rest.values));

  const list = $('#issues');
  const items = [];
  if (missingCount) items.push(`<li class="err">${missingCount} value(s) missing or not a number — fill them in before analysis.</li>`);
  for (const e of errors.slice(0, 6)) items.push(`<li class="err">${esc(e)}</li>`);
  if (errors.length > 6) items.push(`<li class="err">…and ${errors.length - 6} more</li>`);
  for (const w of warnings) items.push(`<li class="wrn">${esc(w)}</li>`);
  if (!items.length) items.push('<li class="ok">✓ All 32 + 32 values present and plausible.</li>');
  list.innerHTML = items.join('');

  const verified = $('#chk-verified').checked;
  $('#btn-confirm').disabled = !(missingCount === 0 && verified);
  return { errors, warnings };
}

function invalidateResults() {
  state.confirmed = false;
  state.result = null;
  $('#results').hidden = true;
}

// ---------- Photo + extraction ----------
async function onFile(kind, file) {
  if (!file) return;
  setStatus(kind, 'Preparing photo…');
  try {
    const { dataUrl, base64 } = await prepareImage(file);
    state.maps[kind].photo = dataUrl;
    state.maps[kind].base64 = base64;
    renderMapCard(kind);
    refreshValidation();
    if (state.apiKey) {
      await readValues(kind);
    } else {
      setStatus(kind, 'Photo loaded. Add your API key in Settings, then tap "Read values" — or type the values in.', '');
    }
  } catch (e) {
    setStatus(kind, e.message, 'err');
  }
}

async function readValues(kind) {
  const m = state.maps[kind];
  if (!m.base64) return;
  if (!state.apiKey) {
    setStatus(kind, 'Add your Claude API key in Settings first.', 'err');
    openSettings();
    return;
  }
  const btn = $(`[data-read="${kind}"]`);
  if (btn) btn.disabled = true;
  setStatus(kind, 'Reading values with Claude… (this can take up to a minute)');
  try {
    const json = await extractFromImage(m.base64, { apiKey: state.apiKey, model: state.model, expected: kind });
    const { values, warnings, mapType } = normaliseExtraction(json);
    m.values = values;
    m.notes = warnings;
    m.mapType = mapType;
    invalidateResults();
    $('#chk-verified').checked = false;
    renderMapCard(kind);
    setStatus(kind, 'Values read. Check every number against the photo and correct any errors.', 'ok');
  } catch (e) {
    setStatus(kind, e.message, 'err');
    if (btn) btn.disabled = false;
  }
  refreshValidation();
}

// ---------- Results ----------
function runAnalysis() {
  const { errors } = refreshValidation();
  if (errors.length) return;
  const s = state.settings;
  state.result = analyse(state.maps.stress.values, state.maps.rest.values, s);
  state.confirmed = true;
  renderResults();
  $('#results').hidden = false;
}

function renderResults() {
  const r = state.result;
  const s = state.settings;
  if (!r) return;

  // Summary
  const [headline, ...rest] = r.summary;
  $('#summary').innerHTML =
    `<p class="headline ${r.ischaemia ? 'pos' : 'neg'}">${esc(headline)}</p>` +
    rest.map((l) => `<p class="${/diffuse|microvascular|multivessel/i.test(l) ? 'note' : ''}">${esc(l)}</p>`).join('');
  $('#settings-used').textContent =
    `Rules used: abnormal if stress MBF < ${s.stressMbfCutoff} AND MPR < ${s.mprCutoff} (endo or epi); ` +
    `endo:epi supportive if < ${s.endoEpiCutoff} or ≥${s.endoEpiDropPct}% drop vs rest; ` +
    `territory ischaemic if ≥${s.minContiguous} contiguous abnormal segments; ` +
    `diffuse if ≥${s.diffuseMinPerTerritory} abnormal in every territory.`;

  // Bullseyes
  const abn = new Set(r.rows.filter((x) => x.abnormal).map((x) => x.id));
  const pick = (a, b) => Object.fromEntries(r.rows.map((x) => [x.id, { endo: x[a], epi: x[b] }]));
  $('#be-stress').innerHTML = bullseyeSVG(pick('sEndo', 'sEpi'), { max: s.mbfScaleMax, abnormal: abn, title: 'Stress MBF', idPrefix: 'be-s' });
  $('#be-rest').innerHTML = bullseyeSVG(pick('rEndo', 'rEpi'), { max: s.mbfScaleMax, title: 'Rest MBF', idPrefix: 'be-r' });
  $('#be-mpr').innerHTML = bullseyeSVG(pick('mprEndo', 'mprEpi'), { max: s.mprScaleMax, abnormal: abn, title: 'MPR', idPrefix: 'be-m' });
  $('#lg-stress').innerHTML = legendSVG({ max: s.mbfScaleMax, unit: 'ml/g/min', cutoff: s.stressMbfCutoff });
  $('#lg-rest').innerHTML = legendSVG({ max: s.mbfScaleMax, unit: 'ml/g/min' });
  $('#lg-mpr').innerHTML = legendSVG({ max: s.mprScaleMax, unit: 'ratio', cutoff: s.mprCutoff });
  $('#seg-detail').textContent = 'Tap a segment.';
  if (state.selectedSeg) selectSegment(state.selectedSeg);

  // Table
  const low = (v, cut) => (v < cut ? 'low' : '');
  const terrIsch = new Map();
  for (const t of r.territories) for (const id of t.ischaemicSegments) terrIsch.set(id, true);
  const head = `<thead><tr>
    <th>#</th><th>Segment</th><th>Terr.</th>
    <th>Stress<br>endo</th><th>Stress<br>epi</th><th>Rest<br>endo</th><th>Rest<br>epi</th>
    <th>MPR<br>endo</th><th>MPR<br>epi</th><th>MPR<br>trans.</th>
    <th>Endo:epi<br>stress</th><th>Endo:epi<br>rest</th><th>Status</th></tr></thead>`;
  const body = r.rows.map((x) => {
    let status = 'Normal';
    if (x.abnormal) status = `Abnormal (${x.pattern})${terrIsch.get(x.id) ? '' : ', isolated'}`;
    const sup = x.ratioSupport ? (x.ratioInverted ? 'inverted' : `↓${x.ratioDropPct.toFixed(0)}%`) : '';
    return `<tr class="${x.abnormal ? 'abn' : ''}">
      <td>${x.id}</td><td class="l">${x.name}</td><td class="l">${x.territory}</td>
      <td class="${low(x.sEndo, s.stressMbfCutoff)}">${f2(x.sEndo)}</td>
      <td class="${low(x.sEpi, s.stressMbfCutoff)}">${f2(x.sEpi)}</td>
      <td>${f2(x.rEndo)}</td><td>${f2(x.rEpi)}</td>
      <td class="${low(x.mprEndo, s.mprCutoff)}">${f2(x.mprEndo)}</td>
      <td class="${low(x.mprEpi, s.mprCutoff)}">${f2(x.mprEpi)}</td>
      <td class="${low(x.mprMean, s.mprCutoff)}">${f2(x.mprMean)}</td>
      <td class="${x.ratioSupport ? 'sup' : ''}">${f2(x.ratioStress)}${sup ? ` <small>(${sup})</small>` : ''}</td>
      <td>${f2(x.ratioRest)}</td>
      <td class="l">${status}</td></tr>`;
  }).join('');
  const g = r.global;
  const foot = `<tfoot><tr><td></td><td class="l"><strong>Global (mean)</strong></td><td></td>
    <td>${f2(g.stressEndo)}</td><td>${f2(g.stressEpi)}</td><td colspan="3"></td>
    <td>${f2(g.mpr)}</td><td>${f2(g.ratioStress)}</td><td colspan="2"></td></tr></tfoot>`;
  $('#results-table').innerHTML = head + `<tbody>${body}</tbody>` + foot;
}

function selectSegment(id) {
  state.selectedSeg = id;
  $$('.be-seg').forEach((p) => p.classList.toggle('sel', Number(p.dataset.seg) === id));
  const x = state.result?.rows.find((row) => row.id === id);
  if (!x) return;
  $('#seg-detail').innerHTML =
    `<strong>${x.id} ${esc(x.name)}</strong> (${x.territory}) — stress ${f2(x.sEndo)}/${f2(x.sEpi)}, ` +
    `rest ${f2(x.rEndo)}/${f2(x.rEpi)} ml/g/min (endo/epi); MPR ${f2(x.mprEndo)}/${f2(x.mprEpi)}; ` +
    `endo:epi ${f2(x.ratioStress)} stress, ${f2(x.ratioRest)} rest. ` +
    `<strong>${x.abnormal ? `Abnormal (${x.pattern})` : 'Normal'}</strong>`;
}

// ---------- Settings ----------
const NUM_FIELDS = ['stressMbfCutoff', 'mprCutoff', 'endoEpiCutoff', 'endoEpiDropPct', 'minContiguous',
  'diffuseMinPerTerritory', 'plausibleMin', 'plausibleMax', 'mbfScaleMax', 'mprScaleMax'];

function populateSettings() {
  const s = state.settings;
  for (const k of NUM_FIELDS) $(`#set-${k}`).value = s[k];
  $('#set-apikey').value = state.apiKey;
  $('#set-remember').checked = state.remember;
  $('#set-model').value = state.model;
  $('#territory-grid').innerHTML = SEGMENTS.map((seg) => `
    <label>${seg.id} ${seg.name}
      <select data-terr="${seg.id}">${TERRITORIES.map((t) => `<option ${s.territories[seg.id] === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </label>`).join('');
}

function openSettings() {
  populateSettings();
  if (!$('#settings').open) $('#settings').showModal();
}

function saveSettings() {
  const s = state.settings;
  for (const k of NUM_FIELDS) {
    const v = parseFloat($(`#set-${k}`).value);
    if (Number.isFinite(v)) s[k] = ['minContiguous', 'diffuseMinPerTerritory'].includes(k) ? Math.max(1, Math.round(v)) : v;
  }
  for (const sel of $$('[data-terr]')) s.territories[sel.dataset.terr] = sel.value;
  store.set(LS_SETTINGS, JSON.stringify(s));

  state.apiKey = $('#set-apikey').value.trim();
  state.remember = $('#set-remember').checked;
  if (state.remember && state.apiKey) store.set(LS_KEY, state.apiKey);
  else store.del(LS_KEY);
  state.model = $('#set-model').value.trim() || DEFAULT_MODEL;
  store.set(LS_MODEL, state.model);

  refreshValidation();
  if (state.confirmed) {
    state.result = analyse(state.maps.stress.values, state.maps.rest.values, s);
    renderResults();
  }
}

// ---------- Wiring ----------
function loadCase(key) {
  const c = TEST_CASES[key];
  for (const kind of ['stress', 'rest']) {
    state.maps[kind] = { values: structuredClone(c[kind]), photo: null, mapType: null, notes: [] };
    renderMapCard(kind);
  }
  $('#case-expect').textContent = `Loaded "${c.label}". Expected: ${c.expect}.`;
  $('#chk-verified').checked = false;
  invalidateResults();
  refreshValidation();
}

function clearAll() {
  for (const kind of ['stress', 'rest']) {
    state.maps[kind] = { values: emptyValues(), photo: null, mapType: null, notes: [] };
    renderMapCard(kind);
  }
  $('#case-expect').textContent = '';
  $('#chk-verified').checked = false;
  invalidateResults();
  refreshValidation();
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('input[type="file"][data-file]')) {
    onFile(t.dataset.file, t.files?.[0]);
    t.value = '';
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('.vals input[data-kind]')) {
    const v = parseNum(t.value);
    state.maps[t.dataset.kind].values[t.dataset.seg][t.dataset.layer] = v;
    invalidateResults();
    refreshValidation();
  } else if (t.closest('#settings-form')) {
    saveSettings();
  }
});

document.addEventListener('click', (e) => {
  const t = e.target;
  const readBtn = t.closest('[data-read]');
  if (readBtn) return readValues(readBtn.dataset.read);
  const caseBtn = t.closest('[data-case]');
  if (caseBtn) return loadCase(caseBtn.dataset.case);
  if (t.closest('[data-zoom]')) {
    $('#zoom-img').src = state.maps[t.closest('[data-zoom]').dataset.zoom].photo;
    return $('#zoom').showModal();
  }
  const seg = t.closest('.be-seg');
  if (seg) return selectSegment(Number(seg.dataset.seg));
});

$('#btn-clear').addEventListener('click', clearAll);
$('#btn-settings').addEventListener('click', openSettings);
$('#settings').addEventListener('close', saveSettings);
$('#settings-form').addEventListener('change', saveSettings);
$('#btn-reset').addEventListener('click', () => {
  state.settings = cloneSettings();
  store.set(LS_SETTINGS, JSON.stringify(state.settings));
  const key = $('#set-apikey').value;
  const remember = $('#set-remember').checked;
  const model = $('#set-model').value;
  populateSettings();
  $('#set-apikey').value = key;
  $('#set-remember').checked = remember;
  $('#set-model').value = model;
  saveSettings();
});
$('#chk-verified').addEventListener('change', refreshValidation);
$('#btn-confirm').addEventListener('click', () => {
  runAnalysis();
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

renderMapCard('stress');
renderMapCard('rest');
refreshValidation();
