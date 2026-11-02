// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyse, validateValues, crossCheck, ADJACENCY, clusters, cloneSettings,
  DEFAULT_SETTINGS, normaliseExtraction, emptyValues,
} from '../js/logic.js';
import { TEST_CASES } from '../js/testcases.js';

const run = (k, s = DEFAULT_SETTINGS) => analyse(TEST_CASES[k].stress, TEST_CASES[k].rest, s);

test('adjacency is symmetric and sensible', () => {
  for (const [a, ns] of Object.entries(ADJACENCY)) for (const b of ns) assert.ok(ADJACENCY[b].includes(Number(a)));
  assert.deepEqual([...ADJACENCY[1]].sort((a, b) => a - b), [2, 6, 7]);
  assert.deepEqual([...ADJACENCY[5]].sort((a, b) => a - b), [4, 6, 11]);
  assert.deepEqual([...ADJACENCY[12]].sort((a, b) => a - b), [6, 7, 11, 13, 16]);
  assert.deepEqual([...ADJACENCY[14]].sort((a, b) => a - b), [8, 9, 13, 15]);
});

test('normal case: no ischaemia', () => {
  const r = run('normal');
  assert.equal(r.ischaemia, false);
  assert.equal(r.abnormalCount, 0);
  assert.equal(r.diffuse, false);
  assert.equal(r.microvascular, false);
});

test('LAD case: LAD only, subendocardial, supported by endo:epi', () => {
  const r = run('lad');
  assert.deepEqual(r.ischaemicTerritories, ['LAD']);
  const lad = r.territories.find((t) => t.territory === 'LAD');
  assert.deepEqual(lad.ischaemicSegments, [1, 2, 7, 8, 13, 14]);
  assert.equal(lad.supportive.length, 6);
  assert.ok(r.rows.filter((x) => x.abnormal).every((x) => x.pattern === 'subendocardial'));
  assert.equal(r.diffuse, false);
});

test('diffuse case: all territories, microvascular note', () => {
  const r = run('diffuse');
  assert.equal(r.diffuse, true);
  assert.equal(r.microvascular, true);
  assert.equal(r.abnormalCount, 16);
  assert.ok(r.summary.some((l) => /diffuse/.test(l)));
  assert.ok(r.summary.some((l) => /microvascular/.test(l)));
});

test('contiguity: one isolated abnormal segment is not ischaemic; N is configurable', () => {
  const stress = structuredClone(TEST_CASES.normal.stress);
  stress[4] = { endo: 1.2, epi: 1.4 };
  let r = analyse(stress, TEST_CASES.normal.rest, DEFAULT_SETTINGS);
  assert.equal(r.ischaemia, false);
  assert.deepEqual(r.territories.find((t) => t.territory === 'RCA').isolatedSegments, [4]);
  const s1 = cloneSettings();
  s1.minContiguous = 1;
  r = analyse(stress, TEST_CASES.normal.rest, s1);
  assert.deepEqual(r.ischaemicTerritories, ['RCA']);
});

test('contiguity is within territory only', () => {
  // 6 (LCx) and 1 (LAD) are neighbours but in different territories.
  const stress = structuredClone(TEST_CASES.normal.stress);
  stress[1] = { endo: 1.2, epi: 1.4 };
  stress[6] = { endo: 1.2, epi: 1.4 };
  const r = analyse(stress, TEST_CASES.normal.rest, DEFAULT_SETTINGS);
  assert.equal(r.ischaemia, false);
  // Editing territories so both belong to LAD makes it contiguous.
  const s = cloneSettings();
  s.territories[6] = 'LAD';
  assert.deepEqual(analyse(stress, TEST_CASES.normal.rest, s).ischaemicTerritories, ['LAD']);
});

test('segment needs BOTH low stress MBF and low MPR', () => {
  const stress = structuredClone(TEST_CASES.normal.stress);
  const rest = structuredClone(TEST_CASES.normal.rest);
  // low stress MBF but low rest too -> MPR preserved -> normal
  stress[1] = { endo: 1.5, epi: 1.4 };
  rest[1] = { endo: 0.5, epi: 0.45 };
  assert.equal(analyse(stress, rest).rows[0].abnormal, false);
});

test('validation flags missing, implausible and duplicate rows', () => {
  const v = structuredClone(TEST_CASES.normal.stress);
  v[3].endo = null;
  v[5].epi = 7.5;
  v[9] = { ...v[10] };
  const { cells, errors, warnings } = validateValues(v);
  assert.equal(cells[3].endo, 'missing');
  assert.equal(cells[5].epi, 'implausible');
  assert.equal(cells[9].endo, 'duplicate');
  assert.equal(errors.length, 1);
  assert.equal(warnings.length, 2);
});

test('cross-check warns when rest > stress', () => {
  assert.equal(crossCheck(TEST_CASES.normal.rest, TEST_CASES.normal.stress).length, 1);
  assert.equal(crossCheck(TEST_CASES.normal.stress, TEST_CASES.normal.rest).length, 0);
});

test('normaliseExtraction handles duplicates and bad ids', () => {
  const { values, warnings } = normaliseExtraction({
    segments: [
      { segment: 1, endo: 1.56, epi: 1.58 },
      { segment: 1, endo: 9, epi: 9 },
      { segment: 17, endo: 1, epi: 1 },
      { segment: 2, endo: null, epi: 1.79 },
    ],
    warnings: [],
  });
  assert.deepEqual(values[1], { endo: 1.56, epi: 1.58 });
  assert.equal(values[2].endo, null);
  assert.equal(values[3].endo, null);
  assert.equal(warnings.length, 2);
  assert.ok(emptyValues()[16]);
});

test('test cases have no validation warnings', () => {
  for (const k of Object.keys(TEST_CASES)) {
    for (const which of ['stress', 'rest']) {
      const v = validateValues(TEST_CASES[k][which]);
      assert.equal(v.errors.length + v.warnings.length, 0, `${k} ${which}: ${v.warnings.join('; ')}`);
    }
  }
});
