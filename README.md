# CMR Perfusion Analyser

Mobile-friendly single-page web app for checking CMR quantitative perfusion maps.
It works in iPhone Safari and can use the phone camera.

> **Decision-support / research tool. Not for standalone clinical diagnosis.**
> Do not photograph patient names, NHS numbers, dates of birth or any other identifiers.

## Workflow

1. Take or upload a photo of the **stress** and the **rest** results tables (16 AHA segments, Epi and Endo MBF columns).
2. Claude (vision, `claude-opus-5-5`) reads the 32 values from each photo as strict JSON (`{segment, endo, epi}`).
3. Check every number in the editable table next to the photo. The app flags these problems:
   - missing values (these block analysis)
   - implausible values (outside 0.2–6 ml/g/min by default)
   - duplicated rows
   - segments that the reader returned twice
   - rest MBF higher than stress MBF (photos possibly swapped)
4. Tick "I have checked every value", then press **Confirm and analyse**.
5. The output has three parts:
   - stress, rest and MPR bullseyes (inner half = endo, outer half = epi; scale runs black → purple → blue → yellow → white)
   - a per-segment table
   - a summary

## Clinical rules (all editable in Settings)

| Rule | Default |
|---|---|
| Segment abnormal | stress MBF < cut-off **AND** MPR < cut-off, in the endo **or** epi layer (so a segment can be abnormal on the endo layer alone) |
| Stress MBF cut-off | **1.94 ml/g/min (placeholder: verify)** |
| MPR cut-off | **2.0 (placeholder: verify)** |
| Endo:epi (supportive only) | stress endo:epi < 1.0 (inverted) or ≥ 15 % drop vs rest |
| Territory ischaemic | ≥ N contiguous abnormal segments **within the same territory** (N = 2) |
| Diffuse | ≥ 1 abnormal segment in **all three** territories |
| Microvascular note | global stress MBF < cut-off with preserved global endo:epi |
| Territories | LAD 1, 2, 7, 8, 13, 14 · RCA 3, 4, 9, 10, 15 · LCx 5, 6, 11, 12, 16 (segment 17 ignored) |

"Contiguous" means neighbours on the bullseye: side by side in the same ring, or overlapping in the next ring.

**The numeric thresholds are placeholders. Replace them with your Chiribiri-based reference values in Settings before use.**

## Privacy and API key

- No photos or values are stored. Settings, and your API key if you tick "Remember", are kept in this browser's `localStorage` only.
- Photos are downscaled on the device and sent directly from the browser to the Anthropic API.
- The API key lives in the browser. Use a key with a low spend limit, and don't share the device or the page with the key saved.

## Test cases

Built-in made-up cases:
- **Normal**: no ischaemia
- **Single-vessel LAD**: subendocardial defect in 1, 2, 7, 8, 13, 14, with an inverted endo:epi ratio
- **Diffuse reduction**: all three territories abnormal, preserved endo:epi, so the microvascular note appears

Run the logic tests with:

```sh
node --test 'tests/*.test.mjs'
```

## Hosting (GitHub Pages)

Static files only, with no build step. In Repository → Settings → Pages → Source, choose **GitHub Actions**.
- `.github/workflows/static.yml` deploys the site on each push to `main`.
- `.github/workflows/test.yml` runs the logic tests on pushes and pull requests.

To run it locally, use `python3 -m http.server` and open http://localhost:8000.

## Files

- `index.html`, `css/styles.css`: UI
- `js/logic.js`: segment model, adjacency, validation, analysis and summary (pure, unit-tested)
- `js/bullseye.js`: SVG bullseye and legend
- `js/extract.js`: photo downscaling and the Claude vision call
- `js/testcases.js`: made-up test data
- `js/app.js`: UI wiring
