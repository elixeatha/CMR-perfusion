// Made-up values for checking the logic. NOT real patient data.
// Arrays are in AHA segment order 1..16. All rows are unique so no duplicate warnings fire.
import { valuesFromArrays } from './logic.js';

// Normal: stress ~3 ml/g/min, rest ~0.8, MPR ~3.7, endo > epi (endo:epi ~1.1).
const nStressEndo = [3.12, 3.04, 2.91, 2.83, 2.95, 3.07, 3.21, 3.15, 3.02, 2.88, 2.99, 3.11, 3.32, 3.24, 3.08, 3.18];
const nStressEpi = [2.81, 2.76, 2.63, 2.57, 2.69, 2.78, 2.92, 2.85, 2.74, 2.61, 2.72, 2.82, 3.01, 2.95, 2.79, 2.88];
const nRestEndo = [0.86, 0.82, 0.8, 0.78, 0.81, 0.84, 0.87, 0.83, 0.79, 0.77, 0.83, 0.85, 0.89, 0.88, 0.84, 0.9];
const nRestEpi = [0.81, 0.78, 0.76, 0.74, 0.77, 0.79, 0.82, 0.8, 0.75, 0.73, 0.78, 0.8, 0.84, 0.83, 0.8, 0.85];

// Single-vessel LAD: segments 1, 2, 7, 8, 13, 14 have a subendocardial stress defect
// (stress endo ~1.3, MPR endo ~1.5, epi preserved ~2.1, endo:epi inverted ~0.6).
const ladStressEndo = [...nStressEndo];
const ladStressEpi = [...nStressEpi];
const lad = { 1: [1.35, 2.12], 2: [1.31, 2.08], 7: [1.26, 2.05], 8: [1.22, 2.1], 13: [1.17, 2.02], 14: [1.29, 2.14] };
for (const [id, [endo, epi]] of Object.entries(lad)) {
  ladStressEndo[id - 1] = endo;
  ladStressEpi[id - 1] = epi;
}

// Diffuse reduction: every segment stress ~1.5, rest ~0.9, MPR ~1.7,
// endo:epi preserved (~1.07) -> diffuse + microvascular pattern.
const dStressEndo = [1.56, 1.51, 1.46, 1.49, 1.54, 1.61, 1.52, 1.44, 1.48, 1.57, 1.53, 1.59, 1.43, 1.47, 1.55, 1.5];
const dStressEpi = [1.45, 1.42, 1.37, 1.39, 1.44, 1.5, 1.41, 1.35, 1.38, 1.46, 1.43, 1.48, 1.34, 1.36, 1.45, 1.4];
const dRestEndo = [0.93, 0.9, 0.88, 0.91, 0.92, 0.95, 0.89, 0.87, 0.9, 0.94, 0.91, 0.96, 0.86, 0.88, 0.93, 0.92];
const dRestEpi = [0.88, 0.86, 0.83, 0.87, 0.87, 0.9, 0.85, 0.82, 0.84, 0.89, 0.86, 0.91, 0.81, 0.84, 0.89, 0.86];

export const TEST_CASES = {
  normal: {
    label: 'Normal',
    expect: 'No ischaemia',
    stress: valuesFromArrays(nStressEndo, nStressEpi),
    rest: valuesFromArrays(nRestEndo, nRestEpi),
  },
  lad: {
    label: 'Single-vessel LAD ischaemia',
    expect: 'LAD ischaemia (segments 1, 2, 7, 8, 13, 14), subendocardial, endo:epi inverted',
    stress: valuesFromArrays(ladStressEndo, ladStressEpi),
    rest: valuesFromArrays(nRestEndo, nRestEpi),
  },
  diffuse: {
    label: 'Diffuse reduction',
    expect: 'All three territories abnormal → diffuse; endo:epi preserved → microvascular note',
    stress: valuesFromArrays(dStressEndo, dStressEpi),
    rest: valuesFromArrays(dRestEndo, dRestEpi),
  },
};
