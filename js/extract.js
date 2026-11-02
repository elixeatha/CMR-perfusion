// Read the 32 MBF values from a photo using the Claude API (vision + structured JSON output).
//
// This is a static, build-free page hosted on GitHub Pages, so it calls the Messages API
// directly with fetch. The API key is the user's own and stays on their device.

const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-opus-5-5';

const SEGMENT_NAMES = [
  'Basal Anterior', 'Basal Anteroseptal', 'Basal Inferoseptal', 'Basal Inferior',
  'Basal Inferolateral', 'Basal Anterolateral', 'Mid Anterior', 'Mid Anteroseptal',
  'Mid Inferoseptal', 'Mid Inferior', 'Mid Inferolateral', 'Mid Anterolateral',
  'Apical Anterior', 'Apical Septal', 'Apical Inferior', 'Apical Lateral',
];

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['map_type', 'segments', 'warnings'],
  properties: {
    map_type: { type: 'string', enum: ['stress', 'rest', 'unknown'] },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['segment', 'name', 'endo', 'epi'],
        properties: {
          segment: { type: 'integer' },
          name: { type: 'string' },
          endo: nullableNumber,
          epi: nullableNumber,
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

function prompt(expected) {
  return `This is a photo of a screen showing a CMR quantitative perfusion results table (expected to be the ${expected.toUpperCase()} map).
It lists the 16 AHA myocardial segments with mean myocardial blood flow (MBF, ml/g/min) in two columns: Epi (epicardial) and Endo (endocardial).

Transcribe the numbers exactly as printed. Rules:
- Read the column headers carefully. On many scanners the Epi column comes BEFORE the Endo column. Put each value in the correct field.
- Map rows to AHA segment numbers by name: ${SEGMENT_NAMES.map((n, i) => `${i + 1} = ${n}`).join('; ')}.
- Return exactly 16 segment entries, 1 to 16, each once. Ignore the GLOBAL row and any apex/segment 17.
- Copy digits exactly; do not round, estimate, or "correct" values. If a number is unreadable, cut off, or blurred, use null and add a warning naming the segment.
- If a column label or the row order is unclear, add a warning.
- Set map_type to "stress" or "rest" only if the image clearly says so; otherwise "unknown".
- Do not transcribe any names, dates of birth, hospital/NHS numbers or other identifiers that may be visible.`;
}

/**
 * @param {string} base64Jpeg - JPEG data without the data: prefix
 * @param {{apiKey: string, model?: string, expected: 'stress'|'rest'}} opts
 */
export async function extractFromImage(base64Jpeg, { apiKey, model = DEFAULT_MODEL, expected }) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings first.');
  const body = {
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    // Server-side fallback if the request is declined by a safety classifier.
    fallbacks: 'default',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg } },
          { type: 'text', text: prompt(expected) },
        ],
      },
    ],
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Network error contacting the Claude API (${e.message}). Check your connection.`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('The API key was rejected (401). Check it in Settings.');
    if (res.status === 429) throw new Error('Rate limited (429). Wait a moment and try again.');
    if (res.status >= 500) throw new Error(`Claude API is temporarily unavailable (${res.status}). Try again.`);
    throw new Error(`Claude API error ${res.status}: ${msg}`);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error('The request was declined. Enter the values manually.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('The response was cut off. Try again, or enter the values manually.');
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Could not parse the values returned. Try a clearer photo or enter values manually.');
  }
}

// Downscale a photo to <= maxEdge px on the long side and return base64 JPEG (no prefix)
// plus a data URL for preview. Nothing is stored.
export async function prepareImage(file, maxEdge = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not open that image. Try a JPEG or PNG.'));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return { dataUrl, base64: dataUrl.split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
