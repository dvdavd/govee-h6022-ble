// govee-matrix.js — 12x11 matrix pixel editor (ported from govee-matrix-card)

const MATRIX_WIDTH = 12;
const MATRIX_HEIGHT = 11;
const MATRIX_PIXEL_COUNT = MATRIX_WIDTH * MATRIX_HEIGHT;
const MATRIX_MAX_SPEED = 100;
const MATRIX_MAX_COLORS = 40;
const MATRIX_LAYER_COUNT = 3;
const MATRIX_STORAGE_KEY = 'govee_matrix_settings';
const MATRIX_PRESETS_KEY = 'govee_matrix_presets';
const MATRIX_PREVIEW_AREA_SAMPLES = [-0.3, 0, 0.3];

const MATRIX_DEFAULT_PALETTE = [
  '#ff0000', '#ff3300', '#ff6600', '#ff9900', '#ffcc00', '#ffff00', '#ccff00', '#99ff00',
  '#33ff00', '#00ff00', '#00ff66', '#00cc66', '#009944', '#006622', '#00ffaa', '#00ffff',
  '#00ccff', '#0099ff', '#0066ff', '#0033ff', '#0000ff', '#3300ff', '#6600ff', '#9900ff',
  '#cc00ff', '#ff00ff', '#ff0080', '#990000', '#663300', '#003366', '#330066', '#ffffff',
];

const MATRIX_DIRECTIONS = [
  ['twinkle', 'Twinkle'],
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['up-left', 'Up left'],
  ['up-right', 'Up right'],
  ['down-left', 'Down left'],
  ['down-right', 'Down right'],
];

const MATRIX_TOOLS = [
  ['pencil', 'Pixel'],
  ['brush', 'Brush'],
  ['line', 'Line'],
  ['circle', 'Circle'],
  ['rect', 'Rect'],
  ['fill', 'Fill'],
  ['picker', 'Pick colour'],
  ['eraser', 'Erase'],
];

const MATRIX_TOOL_ICONS = {
  pencil: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /><path d="M13.5 6.5l4 4" /></svg>`,
  brush: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21v-4a4 4 0 1 1 4 4h-4" /><path d="M21 3a16 16 0 0 0 -12.8 10.2" /><path d="M21 3a16 16 0 0 1 -10.2 12.8" /><path d="M10.6 9a9 9 0 0 1 4.4 4.4" /></svg>`,
  line: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19l16 -14" /></svg>`,
  circle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /></svg>`,
  rect: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10" /></svg>`,
  fill: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16l1.465 1.638a2 2 0 1 1 -3.015 .099l1.55 -1.737" /><path d="M13.737 9.737c2.299 -2.3 3.23 -5.095 2.081 -6.245c-1.15 -1.15 -3.945 -.217 -6.244 2.082c-2.3 2.299 -3.231 5.095 -2.082 6.244c1.15 1.15 3.946 .218 6.245 -2.081" /><path d="M7.492 11.818c.362 .362 .768 .676 1.208 .934l6.895 4.047c1.078 .557 2.255 -.075 3.692 -1.512c1.437 -1.437 2.07 -2.614 1.512 -3.692c-.372 -.718 -1.72 -3.017 -4.047 -6.895a6.015 6.015 0 0 0 -.934 -1.208" /></svg>`,
  picker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7l6 6" /><path d="M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4" /></svg>`,
  eraser: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3" /><path d="M18 13.3l-6.3 -6.3" /></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" /></svg>`,
  floppy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" /><path d="M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M14 4l0 4l-6 0l0 -4" /></svg>`,
};

function matrixLedIndex(row, col) {
  return row * MATRIX_WIDTH + col;
}

function matrixRowCol(index) {
  return { row: Math.floor(index / MATRIX_WIDTH), col: index % MATRIX_WIDTH };
}

function matrixIndexIfValid(row, col) {
  if (row < 0 || row >= MATRIX_HEIGHT || col < 0 || col >= MATRIX_WIDTH) return null;
  return matrixLedIndex(row, col);
}

function newMatrixLayer() {
  return {
    pixels: Array(MATRIX_PIXEL_COUNT).fill(null),
    direction: 'twinkle',
    speed: 80,
  };
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

// ── Protocol encoding ────────────────────────────────────────────────────────

function h6022BlockHeader(gsize, numGroups) {
  return [gsize + 15, 0x00, 0x03, gsize + 1, 0x00, numGroups];
}

function h6022GroupsBytes(groups) {
  const data = [];
  for (const [[r, g, b], indices] of groups) {
    if (indices.length > 255) throw new Error(`Group has ${indices.length} indices; max 255`);
    data.push(indices.length, r & 0xff, g & 0xff, b & 0xff);
    for (const i of indices) data.push(i & 0xff);
  }
  return data;
}

function buildMatrixSceneMulti(blocks, background, bgBrightness) {
  if (!blocks.length) throw new Error('at least one block required');

  const rendered = blocks.map((blk, i) => {
    const rate = (blk.rate ?? 0x50) & 0xff;
    const level = (blk.level ?? 100) & 0xff;
    const mode = (blk.mode ?? 0x00) & 0xff;
    const zOrder = (i + 1) & 0xff;
    const gdata = h6022GroupsBytes(blk.groups);
    const tail = [rate, level, mode, 0x00, zOrder, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00];
    return { gdata, tail, numGroups: blk.groups.length };
  });

  const [br, bg, bb] = background;
  const firstGdata = rendered[0].gdata;
  const mainHeader = [
    br & 0xff, bg & 0xff, bb & 0xff,
    bgBrightness & 0xff,
    0x00,
    blocks.length,
    ...h6022BlockHeader(firstGdata.length, rendered[0].numGroups),
  ];

  const data = [0x41, ...mainHeader];
  for (let i = 0; i < rendered.length; i++) {
    if (i > 0) {
      data.push(...h6022BlockHeader(rendered[i].gdata.length, rendered[i].numGroups));
    }
    data.push(...rendered[i].gdata, ...rendered[i].tail);
  }

  return data;
}

function buildMatrixSceneParam(layers, bgColor, bgBrightness) {
  const activeLayers = layers
    .map((layer) => {
      const byColor = new Map();
      layer.pixels.forEach((color, index) => {
        if (!isHexColor(color)) return;
        if (!byColor.has(color)) byColor.set(color, []);
        byColor.get(color).push(index);
      });
      if (!byColor.size) return null;
      return {
        groups: Array.from(byColor.entries()).map(([color, leds]) => ({
          color: hexToRgb(color),
          leds,
        })),
        mode: MATRIX_DIRECTIONS.findIndex(([v]) => v === layer.direction),
        rate: layer.speed,
        level: 100,
      };
    })
    .filter(Boolean);

  if (!activeLayers.length) {
    activeLayers.push({
      groups: [{ color: [0, 0, 0], leds: [0] }],
      mode: 0,
      rate: 80,
      level: 100,
    });
  }

  const bgRgb = bgColor ? hexToRgb(bgColor) : [0, 0, 0];
  const bgBri = bgColor ? bgBrightness : 0;

  const blocks = activeLayers.map((l) => ({
    groups: l.groups.map((g) => [g.color, g.leds]),
    rate: l.rate,
    level: l.level,
    mode: l.mode,
  }));

  return buildMatrixSceneMulti(blocks, bgRgb, bgBri);
}

function matrixCurrentPresetData() {
  const layers = matrixBuildLayers();
  const bgRgb = matrixBgColor ? hexToRgb(matrixBgColor) : [0, 0, 0];
  const bgBrightness = matrixBgColor ? matrixBgBrightness : 0;

  const presetData = {
    background: bgRgb,
    bg_brightness: bgBrightness,
  };

  if (layers.length === 1) {
    Object.assign(presetData, {
      groups: layers[0].groups,
      mode: layers[0].mode,
      rate: layers[0].rate,
    });
  } else {
    presetData.layers = layers;
  }

  return presetData;
}

async function applyMatrix() {
  if (!isConnected()) return;

  const btn = document.getElementById('matrixApply');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    let param = buildMatrixSceneParam(
      matrixLayers,
      matrixBgColor,
      matrixBgBrightness
    );
    // H6022 prefix transform: strip 0x41, prepend 0x58 0x5A
    if (param[0] === 0x41) param = [0x58, 0x5A, ...param.slice(1)];
    const packets = buildA3MultiPacket(param);
    // Scene code 8524 (0x214c): lo=0x4c, hi=0x21
    packets.push(finish([0x33, 0x05, 0x04, 0x4c, 0x21]));

    await runBleTransaction('Matrix', async () => {
      await sendPackets(packets);
      const label = matrixActivePresetName || 'Custom Matrix';
      if (typeof rememberActiveScene === 'function') {
        rememberActiveScene(
          matrixActivePresetName ? `matrix:${matrixActivePresetName}` : 'matrix:',
          8524,
          label,
          matrixPresetPreviewGradient(matrixCurrentPresetData())
        );
      }
      assumeLightOn({ musicMode: false, sceneCode: 8524, modeDisplay: { kind: 'scene', label } });
      if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
    });

    btn.textContent = '✓ Done';
    setTimeout(() => {
      btn.textContent = 'Apply Matrix';
      btn.disabled = false;
    }, 1500);
  } catch (e) {
    log('err', `Matrix: ${e.message}`);
    btn.textContent = '✗ Failed';
    setTimeout(() => {
      btn.textContent = 'Apply Matrix';
      btn.disabled = false;
    }, 2000);
  }
}

// ── State ────────────────────────────────────────────────────────────────────

let matrixPalette = [...MATRIX_DEFAULT_PALETTE];
let matrixSelectedColor = matrixPalette[0];
let matrixLayers = Array.from({ length: MATRIX_LAYER_COUNT }, newMatrixLayer);
let matrixActiveLayer = 0;
let matrixTool = 'pencil';
let matrixLastPaintTool = 'pencil';
let matrixPaintTarget = 'fg';
let matrixBgColor = null;
let matrixBgBrightness = 100;
let matrixActivePresetName = null;
let matrixPainting = false;
let matrixRightPainting = false;
let matrixShapeStart = null;
let matrixPreviewIndices = [];
let matrixCombinedPreviewFrame = null;

// ── localStorage ─────────────────────────────────────────────────────────────

function loadMatrixSettings() {
  try {
    const raw = localStorage.getItem(MATRIX_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);

    if (Array.isArray(data.palette)) {
      matrixPalette = data.palette.filter(isHexColor).slice(0, MATRIX_MAX_COLORS);
      if (!matrixPalette.length) matrixPalette = [...MATRIX_DEFAULT_PALETTE];
    }

    if (isHexColor(data.selectedColor)) matrixSelectedColor = data.selectedColor;
    else matrixSelectedColor = matrixPalette[0];

    if (MATRIX_TOOLS.some(([v]) => v === data.tool)) matrixTool = data.tool;
    matrixLastPaintTool = matrixTool === 'picker' ? 'pencil' : matrixTool;

    if (data.paintTarget === 'bg') matrixPaintTarget = 'bg';

    if (isHexColor(data.bgColor)) matrixBgColor = data.bgColor;

    if (Number.isInteger(data.bgBrightness)) {
      matrixBgBrightness = Math.max(0, Math.min(100, data.bgBrightness));
    }

    if (data.activePresetName) matrixActivePresetName = data.activePresetName;

    if (Array.isArray(data.layers)) {
      matrixLayers = Array.from({ length: MATRIX_LAYER_COUNT }, (_, i) => {
        const l = data.layers[i];
        if (!l) return newMatrixLayer();
        return {
          pixels: Array.isArray(l.pixels)
            ? l.pixels.map((c) => (isHexColor(c) ? c : null))
            : Array(MATRIX_PIXEL_COUNT).fill(null),
          direction: MATRIX_DIRECTIONS.some(([v]) => v === l.direction) ? l.direction : 'twinkle',
          speed: Number.isInteger(l.speed) ? Math.max(0, Math.min(MATRIX_MAX_SPEED, l.speed)) : 80,
        };
      });
    } else if (data.pixels) {
      matrixLayers = Array.from({ length: MATRIX_LAYER_COUNT }, newMatrixLayer);
      matrixLayers[0].pixels = Array.isArray(data.pixels)
        ? data.pixels.map((c) => (isHexColor(c) ? c : null))
        : Array(MATRIX_PIXEL_COUNT).fill(null);
      if (MATRIX_DIRECTIONS.some(([v]) => v === data.direction)) {
        matrixLayers[0].direction = data.direction;
      }
      if (Number.isInteger(data.speed)) {
        matrixLayers[0].speed = Math.max(0, Math.min(MATRIX_MAX_SPEED, data.speed));
      }
    }
  } catch (e) {
    console.warn('Failed to load matrix settings:', e);
  }
}

function saveMatrixSettings() {
  try {
    const data = {
      palette: matrixPalette,
      selectedColor: matrixSelectedColor,
      tool: matrixTool,
      paintTarget: matrixPaintTarget,
      bgColor: isHexColor(matrixBgColor) ? matrixBgColor : null,
      bgBrightness: matrixBgBrightness,
      activePresetName: matrixActivePresetName,
      layers: matrixLayers.map((l) => ({
        pixels: l.pixels,
        direction: l.direction,
        speed: l.speed,
      })),
    };
    localStorage.setItem(MATRIX_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save matrix settings:', e);
  }
}

function loadMatrixPresets() {
  try {
    const raw = localStorage.getItem(MATRIX_PRESETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveMatrixPresets(presets) {
  try {
    localStorage.setItem(MATRIX_PRESETS_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('Failed to save matrix presets:', e);
  }
}

function matrixDirectionLoopCells(direction) {
  const [dr, dc] = matrixDirectionDelta(direction);
  if (dr && dc) return MATRIX_WIDTH * MATRIX_HEIGHT;
  if (dr) return MATRIX_HEIGHT;
  if (dc) return MATRIX_WIDTH;
  return 1;
}

function matrixTwinklePeriod(speed) {
  return Math.max(500, 5500 - speed * 50);
}

function matrixMovingLoopPeriod(speed) {
  return Math.max(1300, 13000 - speed * 117);
}

// ── Drawing tools ────────────────────────────────────────────────────────────

function matrixToolColor() {
  return matrixTool === 'eraser' ? null : matrixSelectedColor;
}

function matrixBrushIndices(index) {
  const { row, col } = matrixRowCol(index);
  const indices = [];
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      const next = matrixIndexIfValid(r, c);
      if (next !== null) indices.push(next);
    }
  }
  return indices;
}

function matrixLineIndices(start, end) {
  const from = matrixRowCol(start);
  const to = matrixRowCol(end);
  let x0 = from.col;
  let y0 = from.row;
  const x1 = to.col;
  const y1 = to.row;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const indices = [];

  while (true) {
    indices.push(matrixLedIndex(y0, x0));
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return indices;
}

function matrixRectIndices(start, end) {
  const a = matrixRowCol(start);
  const b = matrixRowCol(end);
  const top = Math.min(a.row, b.row);
  const bottom = Math.max(a.row, b.row);
  const left = Math.min(a.col, b.col);
  const right = Math.max(a.col, b.col);
  const indices = new Set();
  for (let col = left; col <= right; col++) {
    indices.add(matrixLedIndex(top, col));
    indices.add(matrixLedIndex(bottom, col));
  }
  for (let row = top; row <= bottom; row++) {
    indices.add(matrixLedIndex(row, left));
    indices.add(matrixLedIndex(row, right));
  }
  return Array.from(indices);
}

function matrixCircleIndices(start, end) {
  const a = matrixRowCol(start);
  const b = matrixRowCol(end);
  const top = Math.min(a.row, b.row);
  const bottom = Math.max(a.row, b.row);
  const left = Math.min(a.col, b.col);
  const right = Math.max(a.col, b.col);
  const height = bottom - top;
  const width = right - left;
  if (height === 0 && width === 0) return [start];

  const centerRow = top + height / 2;
  const centerCol = left + width / 2;
  const radius = Math.max(1, Math.min(width, height) / 2);
  const indices = new Set();
  const steps = Math.max(16, Math.ceil(radius * 16));
  for (let i = 0; i < steps; i++) {
    const angle = (Math.PI * 2 * i) / steps;
    const row = Math.round(centerRow + Math.sin(angle) * radius);
    const col = Math.round(centerCol + Math.cos(angle) * radius);
    const next = matrixIndexIfValid(row, col);
    if (next !== null) indices.add(next);
  }
  return Array.from(indices);
}

function matrixFillFrom(index, color) {
  const pixels = matrixLayers[matrixActiveLayer].pixels;
  const target = pixels[index] ?? null;
  if (target === color) return;
  const queue = [index];
  const seen = new Set();
  const indices = [];

  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if ((pixels[current] ?? null) !== target) continue;
    indices.push(current);

    const { row, col } = matrixRowCol(current);
    [
      matrixIndexIfValid(row - 1, col),
      matrixIndexIfValid(row + 1, col),
      matrixIndexIfValid(row, col - 1),
      matrixIndexIfValid(row, col + 1),
    ].forEach((next) => {
      if (next !== null && !seen.has(next)) queue.push(next);
    });
  }
  matrixPaintIndices(indices, color);
}

function matrixPaintIndices(indices, color) {
  const pixels = matrixLayers[matrixActiveLayer].pixels;
  Array.from(new Set(indices)).forEach((index) => {
    pixels[index] = color;
    matrixUpdatePixelElement(index, color);
  });
  matrixUpdateLayerTabs();
  matrixRenderCombinedPreview();
  saveMatrixSettings();
}

function matrixShapeIndices(start, end) {
  if (matrixTool === 'line') return matrixLineIndices(start, end);
  if (matrixTool === 'rect') return matrixRectIndices(start, end);
  if (matrixTool === 'circle') return matrixCircleIndices(start, end);
  return [];
}

function matrixPreviewShape(index) {
  if (!Number.isInteger(matrixShapeStart)) return;
  matrixClearPreview();
  const color = matrixToolColor();
  matrixPreviewIndices = matrixShapeIndices(matrixShapeStart, index);
  matrixPreviewIndices.forEach((i) => matrixUpdatePixelElement(i, color, true));
}

function matrixClearPreview() {
  if (!matrixPreviewIndices.length) return;
  const pixels = matrixLayers[matrixActiveLayer].pixels;
  matrixPreviewIndices.forEach((index) => {
    matrixUpdatePixelElement(index, pixels[index] ?? null);
  });
  matrixPreviewIndices = [];
}

function matrixHandleToolDown(index) {
  if (matrixTool === 'picker') {
    matrixPickPaletteColor(index);
    matrixPainting = false;
    return;
  }
  if (matrixTool === 'fill') {
    matrixFillFrom(index, matrixToolColor());
    matrixPainting = false;
    return;
  }
  if (matrixTool === 'pencil' || matrixTool === 'eraser') {
    matrixPaintIndices([index], matrixToolColor());
    return;
  }
  if (matrixTool === 'brush') {
    matrixPaintIndices(matrixBrushIndices(index), matrixToolColor());
  }
}

function matrixHandleToolMove(index) {
  if (matrixTool === 'pencil' || matrixTool === 'eraser') {
    matrixPaintIndices([index], matrixToolColor());
    return;
  }
  if (matrixTool === 'brush') {
    matrixPaintIndices(matrixBrushIndices(index), matrixToolColor());
    return;
  }
  if (matrixTool === 'line' || matrixTool === 'rect' || matrixTool === 'circle') {
    matrixPreviewShape(index);
  }
}

function matrixHandleToolUp(index) {
  if (!Number.isInteger(matrixShapeStart)) return;
  const color = matrixToolColor();
  if (matrixTool === 'line') {
    matrixPaintIndices(matrixLineIndices(matrixShapeStart, index), color);
  } else if (matrixTool === 'rect') {
    matrixPaintIndices(matrixRectIndices(matrixShapeStart, index), color);
  } else if (matrixTool === 'circle') {
    matrixPaintIndices(matrixCircleIndices(matrixShapeStart, index), color);
  }
}

function matrixPickPaletteColor(index) {
  const color = matrixLayers[matrixActiveLayer].pixels[index];
  if (!isHexColor(color)) return;
  if (!matrixPalette.includes(color)) {
    if (matrixPalette.length >= MATRIX_MAX_COLORS) return;
    matrixPalette.push(color);
    saveMatrixSettings();
    matrixRenderPalette();
  }
  matrixSelectPaletteColor(color);
  matrixSwitchBackFromPicker();
}

function matrixSwitchBackFromPicker() {
  if (matrixTool !== 'picker') return;
  matrixTool = matrixLastPaintTool;
  if (matrixTool === 'picker') matrixTool = 'pencil';
  matrixUpdateToolButtons();
  saveMatrixSettings();
}

// ── UI rendering ─────────────────────────────────────────────────────────────

function matrixEffectiveBgColor() {
  if (!matrixBgColor) return null;
  const [r, g, b] = hexToRgb(matrixBgColor).map((c) => Math.round(c * matrixBgBrightness / 100));
  return `rgb(${r},${g},${b})`;
}

function matrixEffectiveBgRgb() {
  if (!matrixBgColor) return null;
  return hexToRgb(matrixBgColor).map((c) => Math.round(c * matrixBgBrightness / 100));
}

function matrixApplyPixelStyle(element, color, preview = false) {
  if (color) {
    element.style.background = preview ? color + '99' : color;
  } else {
    const bg = matrixEffectiveBgColor();
    element.style.background = bg ?? '';
  }
  element.style.zIndex = '';
  element.style.boxShadow = '';
  element.style.opacity = '';
}

function matrixUpdatePixelElement(index, color, preview = false) {
  const element = document.querySelector(`.matrix-pixel[data-index="${index}"]`);
  if (!element) return;
  matrixApplyPixelStyle(element, color, preview);
}

function matrixRenderGrid() {
  const grid = document.getElementById('matrixGrid');
  grid.innerHTML = '';

  for (let row = 0; row < MATRIX_HEIGHT; row++) {
    for (let col = 0; col < MATRIX_WIDTH; col++) {
      const index = matrixLedIndex(row, col);
      const pixel = document.createElement('button');
      pixel.className = 'matrix-pixel';
      pixel.dataset.index = index;
      pixel.setAttribute('aria-label', `Pixel row ${row + 1}, column ${col + 1}`);
      const color = matrixLayers[matrixActiveLayer].pixels[index];
      matrixApplyPixelStyle(pixel, color);
      grid.appendChild(pixel);
    }
  }
  matrixRenderCombinedPreview();
}

function matrixOpenPaletteColorEditor(index) {
  const original = matrixPalette[index];
  if (!isHexColor(original)) return;
  window.openAppColorEditor?.({
    title: 'Edit Matrix Colour',
    value: original,
    onSave: (hex) => {
      if (!isHexColor(hex)) return;
      matrixPalette[index] = hex;
      if (matrixSelectedColor === original) matrixSelectedColor = hex;
      if (matrixBgColor === original) matrixBgColor = hex;
      matrixLayers.forEach(layer => {
        layer.pixels = layer.pixels.map(color => color === original ? hex : color);
      });
      saveMatrixSettings();
      matrixRenderPalette();
      matrixRenderGrid();
    },
  });
}

function matrixOpenNewPaletteColorEditor() {
  window.openAppColorEditor?.({
    title: 'New Matrix Colour',
    value: '#ffffff',
    onSave: (hex) => {
      if (!isHexColor(hex)) return;
      if (!matrixPalette.includes(hex) && matrixPalette.length < MATRIX_MAX_COLORS) {
        matrixPalette.push(hex);
      }
      matrixSelectPaletteColor(hex);
      saveMatrixSettings();
      matrixRenderPalette();
    },
  });
}

function matrixRenderPalette() {
  const container = document.getElementById('matrixPalette');
  container.innerHTML = '';

  matrixPalette.forEach((hex, i) => {
    const swatch = document.createElement('button');
    swatch.className = 'matrix-swatch' + (hex === matrixSelectedColor ? ' selected' : '');
    swatch.style.background = hex;
    swatch.setAttribute('aria-label', `Select colour ${hex}`);
    swatch.setAttribute('aria-pressed', hex === matrixSelectedColor ? 'true' : 'false');
    swatch.onclick = () => matrixSelectPaletteColor(hex);

    if (matrixPaintTarget === 'bg' && hex === matrixBgColor) {
      swatch.classList.add('bg-selected');
    }

    if (i >= MATRIX_DEFAULT_PALETTE.length) {
      const del = document.createElement('button');
      del.className = 'matrix-swatch-del';
      del.textContent = '✕';
      del.setAttribute('aria-label', `Remove colour ${hex}`);
      del.onclick = (e) => {
        e.stopPropagation();
        matrixPalette.splice(i, 1);
        if (matrixSelectedColor === hex) matrixSelectedColor = matrixPalette[0];
        if (matrixBgColor === hex) matrixBgColor = null;
        saveMatrixSettings();
        matrixRenderPalette();
      };
      swatch.appendChild(del);
    }

    swatch.ondblclick = () => matrixOpenPaletteColorEditor(i);

    container.appendChild(swatch);
  });

  if (matrixPalette.length < MATRIX_MAX_COLORS) {
    const add = document.createElement('button');
    add.className = 'matrix-swatch matrix-swatch-add';
    add.textContent = '+';
    add.setAttribute('aria-label', 'Add colour');
    add.onclick = matrixOpenNewPaletteColorEditor;
    container.appendChild(add);
  }

  if (matrixPaintTarget === 'bg') {
    const none = document.createElement('button');
    none.className = 'matrix-swatch matrix-swatch-none';
    none.setAttribute('aria-label', 'No background colour');
    none.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16" stroke="currentColor" stroke-width="2"/></svg>';
    none.onclick = () => {
      matrixBgColor = null;
      saveMatrixSettings();
      matrixRenderPalette();
      matrixRenderGrid();
      matrixUpdateBgControls();
    };
    container.appendChild(none);
  }
}

function matrixSelectPaletteColor(hex) {
  matrixSelectedColor = hex;
  if (matrixPaintTarget === 'bg') {
    matrixBgColor = hex;
    matrixUpdateBgControls();
    matrixRenderGrid();
  }
  saveMatrixSettings();
  matrixRenderPalette();
}

function matrixRenderLayerPreview(tab, layerIndex) {
  let preview = tab.querySelector('.matrix-layer-preview');
  if (!preview) {
    preview = document.createElement('span');
    preview.className = 'matrix-layer-preview';
    preview.setAttribute('aria-hidden', 'true');
    tab.prepend(preview);
  }

  preview.innerHTML = '';
  for (let row = 0; row < MATRIX_HEIGHT; row++) {
    for (let col = 0; col < MATRIX_WIDTH; col++) {
      const index = matrixLedIndex(row, col);
      const pixel = document.createElement('span');
      pixel.className = 'matrix-layer-preview-pixel';
      const color = matrixLayers[layerIndex].pixels[index];
      if (isHexColor(color)) pixel.style.background = color;
      preview.appendChild(pixel);
    }
  }
}

function matrixDirectionDelta(direction) {
  return {
    up: [-1, 0],
    down: [1, 0],
    left: [0, -1],
    right: [0, 1],
    'up-left': [-1, -1],
    'up-right': [-1, 1],
    'down-left': [1, -1],
    'down-right': [1, 1],
  }[direction] ?? [0, 0];
}

function matrixLayerPeriod(layer) {
  if (layer.direction === 'twinkle' || layer.speed <= 0) return 0;
  return matrixMovingLoopPeriod(layer.speed) / matrixDirectionLoopCells(layer.direction);
}

function matrixLayerOffset(layer, now) {
  const period = matrixLayerPeriod(layer);
  return period > 0 ? now / period : 0;
}

function matrixTwinkleAlpha(layer, now) {
  if (layer.direction !== 'twinkle') return 1;
  if (layer.speed <= 0) return 1;
  const period = matrixTwinklePeriod(layer.speed);
  return 0.18 + 0.82 * ((Math.sin(now / period * Math.PI * 2) + 1) / 2);
}

function matrixWrapCoord(value, size) {
  return ((value % size) + size) % size;
}

function matrixWrappedCell(value, size) {
  return matrixWrapCoord(Math.floor(value), size);
}

function matrixSampleLayerPixel(layer, row, col, weight, sample) {
  const color = layer.pixels[matrixLedIndex(row, col)];
  if (!isHexColor(color)) return;

  const rgb = hexToRgb(color);
  sample.rgb[0] += rgb[0] * weight;
  sample.rgb[1] += rgb[1] * weight;
  sample.rgb[2] += rgb[2] * weight;
  sample.alpha += weight;
}

function matrixSampleMovingLayer(layer, row, col, now) {
  const [dr, dc] = matrixDirectionDelta(layer.direction);
  const offset = matrixLayerOffset(layer, now);
  const sourceRow = matrixWrapCoord(row - dr * offset, MATRIX_HEIGHT);
  const sourceCol = matrixWrapCoord(col - dc * offset, MATRIX_WIDTH);
  const row0 = matrixWrappedCell(sourceRow, MATRIX_HEIGHT);
  const col0 = matrixWrappedCell(sourceCol, MATRIX_WIDTH);
  const rowT = sourceRow - Math.floor(sourceRow);
  const colT = sourceCol - Math.floor(sourceCol);
  const rowSamples = dr === 0
    ? [[row0, 1]]
    : [[row0, 1 - rowT], [matrixWrapCoord(row0 + 1, MATRIX_HEIGHT), rowT]];
  const colSamples = dc === 0
    ? [[col0, 1]]
    : [[col0, 1 - colT], [matrixWrapCoord(col0 + 1, MATRIX_WIDTH), colT]];
  const sample = { rgb: [0, 0, 0], alpha: 0 };

  rowSamples.forEach(([sampleRow, rowWeight]) => {
    colSamples.forEach(([sampleCol, colWeight]) => {
      matrixSampleLayerPixel(layer, sampleRow, sampleCol, rowWeight * colWeight, sample);
    });
  });

  if (sample.alpha <= 0) return null;
  return {
    rgb: sample.rgb.map((channel) => Math.round(channel / sample.alpha)),
    alpha: Math.min(1, sample.alpha),
  };
}

function matrixMovingLayerSamplePoints(layer, row, col) {
  const [dr, dc] = matrixDirectionDelta(layer.direction);
  if (dr === 0 && dc === 0) return [[row, col, 1]];

  const rows = dr === 0 ? [[row, 1]] : MATRIX_PREVIEW_AREA_SAMPLES.map((offset) => [row + offset, 1 / MATRIX_PREVIEW_AREA_SAMPLES.length]);
  const cols = dc === 0 ? [[col, 1]] : MATRIX_PREVIEW_AREA_SAMPLES.map((offset) => [col + offset, 1 / MATRIX_PREVIEW_AREA_SAMPLES.length]);
  const points = [];

  rows.forEach(([sampleRow, rowWeight]) => {
    cols.forEach(([sampleCol, colWeight]) => {
      points.push([sampleRow, sampleCol, rowWeight * colWeight]);
    });
  });

  return points;
}

function matrixSampleLayerForLed(layer, row, col, now) {
  const sample = { rgb: [0, 0, 0], alpha: 0 };

  matrixMovingLayerSamplePoints(layer, row, col).forEach(([sampleRow, sampleCol, sampleWeight]) => {
    const pointSample = matrixSampleMovingLayer(layer, sampleRow, sampleCol, now);
    if (!pointSample) return;

    sample.rgb[0] += pointSample.rgb[0] * pointSample.alpha * sampleWeight;
    sample.rgb[1] += pointSample.rgb[1] * pointSample.alpha * sampleWeight;
    sample.rgb[2] += pointSample.rgb[2] * pointSample.alpha * sampleWeight;
    sample.alpha += pointSample.alpha * sampleWeight;
  });

  if (sample.alpha <= 0) return null;
  return {
    rgb: sample.rgb.map((channel) => Math.round(channel / sample.alpha)),
    alpha: Math.min(1, sample.alpha),
  };
}

function matrixBlendRgb(base, top, alpha) {
  return [
    Math.round(base[0] * (1 - alpha) + top[0] * alpha),
    Math.round(base[1] * (1 - alpha) + top[1] * alpha),
    Math.round(base[2] * (1 - alpha) + top[2] * alpha),
  ];
}

function matrixAnimatedPixelRgb(row, col, now) {
  let rgb = matrixEffectiveBgRgb() ?? [0, 0, 0];

  for (let i = MATRIX_LAYER_COUNT - 1; i >= 0; i--) {
    const layer = matrixLayers[i];
    const sample = matrixSampleLayerForLed(layer, row, col, now);
    if (!sample) continue;
    rgb = matrixBlendRgb(rgb, sample.rgb, sample.alpha * matrixTwinkleAlpha(layer, now));
  }

  return rgb;
}

function matrixRenderCombinedPreview() {
  const preview = document.getElementById('matrixCombinedPreview');
  if (!preview) return;
  if (preview.children.length === MATRIX_PIXEL_COUNT) {
    matrixStartCombinedPreviewAnimation();
    return;
  }

  preview.innerHTML = '';
  for (let row = 0; row < MATRIX_HEIGHT; row++) {
    for (let col = 0; col < MATRIX_WIDTH; col++) {
      const index = matrixLedIndex(row, col);
      const pixel = document.createElement('span');
      pixel.className = 'matrix-combined-preview-pixel';
      pixel.dataset.row = row;
      pixel.dataset.col = col;
      pixel.dataset.index = index;
      preview.appendChild(pixel);
    }
  }
  matrixStartCombinedPreviewAnimation();
}

function matrixPaintCombinedPreviewFrame(now) {
  const preview = document.getElementById('matrixCombinedPreview');
  if (!preview) return;

  preview.querySelectorAll('.matrix-combined-preview-pixel').forEach((pixel) => {
    const rgb = matrixAnimatedPixelRgb(
      parseInt(pixel.dataset.row, 10),
      parseInt(pixel.dataset.col, 10),
      now
    );
    pixel.style.background = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : '';
  });
}

function matrixStartCombinedPreviewAnimation() {
  if (matrixCombinedPreviewFrame !== null) return;

  const tick = (now) => {
    matrixPaintCombinedPreviewFrame(now);
    matrixCombinedPreviewFrame = requestAnimationFrame(tick);
  };
  matrixCombinedPreviewFrame = requestAnimationFrame(tick);
}

function matrixUpdateLayerTabs() {
  for (let i = 0; i < MATRIX_LAYER_COUNT; i++) {
    const tab = document.getElementById(`matrixLayerTab${i}`);
    if (!tab) continue;
    tab.className = 'matrix-layer-tab' +
      (i === matrixActiveLayer ? ' active' : '') +
      (matrixLayers[i].pixels.some(isHexColor) ? ' has-pixels' : '');
    matrixRenderLayerPreview(tab, i);
  }
}

function matrixUpdateToolButtons() {
  document.querySelectorAll('.matrix-tool-btn').forEach((btn) => {
    const active = btn.dataset.tool === matrixTool;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function matrixUpdatePaintTargetButtons() {
  setSegmentValue('matrixPaintTargetTabs', 'paintTarget', matrixPaintTarget);
}

function matrixUpdateBgControls() {
  const controls = document.getElementById('matrixBgControls');
  if (!controls) return;
  controls.style.display = (matrixPaintTarget === 'bg' && matrixBgColor !== null) ? '' : 'none';
}

function matrixUpdateLayerControls() {
  const layer = matrixLayers[matrixActiveLayer];
  const dirSelect = document.getElementById('matrixDirection');
  const speedSlider = document.getElementById('matrixSpeed');
  const speedVal = document.getElementById('matrixSpeedVal');
  if (dirSelect) dirSelect.value = layer.direction;
  if (speedSlider) speedSlider.value = layer.speed;
  if (speedVal) speedVal.textContent = layer.speed;
}

function matrixSwitchLayer(i) {
  matrixActiveLayer = i;
  matrixUpdateLayerTabs();
  matrixUpdateLayerControls();
  matrixRenderGrid();
}

function matrixClearLayer(layerIndex = matrixActiveLayer) {
  matrixLayers[layerIndex].pixels = Array(MATRIX_PIXEL_COUNT).fill(null);
  matrixUpdateLayerTabs();
  matrixRenderCombinedPreview();
  if (layerIndex === matrixActiveLayer) matrixRenderGrid();
  saveMatrixSettings();
}

function matrixClearAll() {
  matrixLayers = Array.from({ length: MATRIX_LAYER_COUNT }, newMatrixLayer);
  matrixBgColor = null;
  matrixBgBrightness = 100;
  matrixActivePresetName = null;
  matrixActiveLayer = 0;
  matrixUpdateLayerTabs();
  matrixUpdateLayerControls();
  matrixUpdateBgControls();
  matrixRenderGrid();
  matrixRenderPalette();
  matrixRenderCombinedPreview();
  matrixUpdatePresetSelect();
  saveMatrixSettings();
}

// ── Preset management ────────────────────────────────────────────────────────

function matrixUpdatePresetSelect() {
  const names = Object.keys(loadMatrixPresets()).sort();
  matrixActivePresetName = syncPresetSelect('matrixPresetSelect', 'matrixDeletePreset', names, matrixActivePresetName, saveMatrixSettings);
}

function matrixLoadPreset(name) {
  const presets = loadMatrixPresets();
  const preset = presets[name];
  if (!preset) return;

  const state = matrixEditorStateFromPreset(preset);
  if (!state) return;

  matrixLayers = state.layers;
  matrixBgColor = state.bgColor;
  matrixBgBrightness = state.bgBrightness;
  matrixActiveLayer = 0;
  matrixActivePresetName = name;

  saveMatrixSettings();
  matrixUpdatePresetSelect();
  matrixUpdateLayerTabs();
  matrixUpdateLayerControls();
  matrixUpdateBgControls();
  matrixRenderPalette();
  matrixRenderGrid();
  matrixRenderCombinedPreview();
}

function matrixEditorStateFromPreset(preset) {
  if (!preset || typeof preset !== 'object') return null;
  const bg = Array.isArray(preset.background) && preset.background.length === 3
    ? preset.background
    : [0, 0, 0];
  const bgBrightness = Number.isInteger(preset.bg_brightness)
    ? Math.max(0, Math.min(100, preset.bg_brightness))
    : 0;

  return {
    layers: matrixLayersFromPreset(preset),
    bgColor: bgBrightness > 0 ? `#${bg.map((c) =>
      Math.max(0, Math.min(255, Number(c) || 0)).toString(16).padStart(2, '0')
    ).join('')}` : null,
    bgBrightness: bgBrightness > 0 ? bgBrightness : 100,
  };
}

function matrixLayersFromPreset(preset) {
  const layers = Array.from({ length: MATRIX_LAYER_COUNT }, newMatrixLayer);
  const sourceLayers = Array.isArray(preset.layers)
    ? preset.layers
    : [{
      groups: preset.groups,
      mode: preset.mode,
      rate: preset.rate,
    }];

  sourceLayers.slice(0, MATRIX_LAYER_COUNT).forEach((source, i) => {
    const layer = layers[i];
    if (MATRIX_DIRECTIONS.some(([value]) => value === source?.mode)) {
      layer.direction = source.mode;
    }
    if (Number.isInteger(source?.rate)) {
      layer.speed = Math.max(0, Math.min(MATRIX_MAX_SPEED, source.rate));
    }
    if (!Array.isArray(source?.groups)) return;
    source.groups.forEach((group) => {
      if (!Array.isArray(group?.color) || group.color.length !== 3 || !Array.isArray(group.leds)) {
        return;
      }
      const color = `#${group.color.map((c) =>
        Math.max(0, Math.min(255, Number(c) || 0)).toString(16).padStart(2, '0')
      ).join('')}`;
      group.leds.forEach((led) => {
        if (Number.isInteger(led) && led >= 0 && led < MATRIX_PIXEL_COUNT) {
          layer.pixels[led] = color;
        }
      });
    });
  });
  return layers;
}

function matrixSavePreset() {
  let name = matrixActivePresetName;
  if (!name) {
    name = prompt('Save preset as:', '');
    if (!name?.trim()) return;
    name = name.trim();
  }

  saveMatrixSettings();

  const presets = loadMatrixPresets();
  presets[name] = matrixCurrentPresetData();
  saveMatrixPresets(presets);

  matrixActivePresetName = name;
  saveMatrixSettings();
  matrixUpdatePresetSelect();
  if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
}

function matrixDeletePreset() {
  if (!matrixActivePresetName) return;
  if (!confirm(`Delete preset "${matrixActivePresetName}"?`)) return;

  const presets = loadMatrixPresets();
  delete presets[matrixActivePresetName];
  saveMatrixPresets(presets);

  matrixActivePresetName = null;
  saveMatrixSettings();
  matrixUpdatePresetSelect();
  if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
}

function matrixBuildLayers() {
  const activeLayers = matrixLayers
    .map((layer) => {
      const byColor = new Map();
      layer.pixels.forEach((color, index) => {
        if (!isHexColor(color)) return;
        if (!byColor.has(color)) byColor.set(color, []);
        byColor.get(color).push(index);
      });
      if (!byColor.size) return null;
      return {
        groups: Array.from(byColor.entries()).map(([color, leds]) => ({
          color: hexToRgb(color),
          leds,
        })),
        mode: layer.direction,
        rate: layer.speed,
        level: 100,
      };
    })
    .filter(Boolean);

  return activeLayers.length
    ? activeLayers
    : [{ groups: [{ color: [0, 0, 0], leds: [0] }], mode: 'twinkle', rate: 80, level: 100 }];
}

// ── Initialization ───────────────────────────────────────────────────────────

function initMatrix() {
  loadMatrixSettings();

  const grid = document.getElementById('matrixGrid');
  matrixInitIcons();
  grid.addEventListener('contextmenu', (e) => e.preventDefault());

  grid.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const index = matrixIndexFromPoint(e.clientX, e.clientY);
    if (!Number.isInteger(index)) return;
    if (e.button === 2) {
      matrixRightPainting = true;
      matrixPaintIndices([index], null);
      grid.setPointerCapture?.(e.pointerId);
      return;
    }
    matrixShapeStart = index;
    matrixPainting = true;
    grid.setPointerCapture?.(e.pointerId);
    matrixHandleToolDown(index);
  });

  grid.addEventListener('pointermove', (e) => {
    e.preventDefault();
    const index = matrixIndexFromPoint(e.clientX, e.clientY);
    if (!Number.isInteger(index)) return;
    if (matrixRightPainting) {
      matrixPaintIndices([index], null);
      return;
    }
    if (matrixPainting) matrixHandleToolMove(index);
  });

  grid.addEventListener('pointerup', (e) => {
    if (!matrixRightPainting) {
      const index = matrixIndexFromPoint(e.clientX, e.clientY);
      if (Number.isInteger(index)) matrixHandleToolUp(index);
      matrixClearPreview();
    }
    matrixPainting = false;
    matrixRightPainting = false;
    matrixShapeStart = null;
    grid.releasePointerCapture?.(e.pointerId);
  });

  window.addEventListener('pointerup', () => {
    matrixClearPreview();
    matrixPainting = false;
    matrixRightPainting = false;
    matrixShapeStart = null;
  });

  document.querySelectorAll('.matrix-tool-btn').forEach((btn) => {
    btn.onclick = () => {
      const tool = btn.dataset.tool;
      if (tool !== 'picker' && tool !== 'eraser') matrixLastPaintTool = tool;
      matrixTool = tool;
      matrixUpdateToolButtons();
      saveMatrixSettings();
    };
  });

  bindSegmentValue('matrixPaintTargetTabs', 'paintTarget', paintTarget => {
    matrixPaintTarget = paintTarget === 'bg' ? 'bg' : 'fg';
    matrixUpdatePaintTargetButtons();
    matrixUpdateBgControls();
    matrixRenderPalette();
    saveMatrixSettings();
  });

  for (let i = 0; i < MATRIX_LAYER_COUNT; i++) {
    const tab = document.getElementById(`matrixLayerTab${i}`);
    if (!tab) continue;
    const clear = tab.querySelector('.matrix-layer-clear');
    tab.onclick = (e) => {
      if (e.target.closest('.matrix-layer-clear')) return;
      matrixSwitchLayer(i);
    };
    if (clear) {
      clear.onclick = (e) => {
        e.stopPropagation();
        matrixClearLayer(i);
      };
      clear.onkeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        matrixClearLayer(i);
      };
    }
  }

  document.getElementById('matrixDirection').onchange = (e) => {
    matrixLayers[matrixActiveLayer].direction = e.target.value;
    matrixRenderCombinedPreview();
    saveMatrixSettings();
  };

  const speedSlider = document.getElementById('matrixSpeed');
  const speedVal = document.getElementById('matrixSpeedVal');
  speedSlider.oninput = (e) => {
    matrixLayers[matrixActiveLayer].speed = parseInt(e.target.value, 10);
    speedVal.textContent = e.target.value;
  };
  speedSlider.onchange = () => saveMatrixSettings();

  const bgSlider = document.getElementById('matrixBgBrightness');
  const bgVal = document.getElementById('matrixBgBrightnessVal');
  bgSlider.oninput = (e) => {
    matrixBgBrightness = parseInt(e.target.value, 10);
    bgVal.textContent = e.target.value;
    matrixRenderGrid();
  };
  bgSlider.onchange = () => saveMatrixSettings();

  document.getElementById('matrixReset').onclick = () => {
    matrixPalette = [...MATRIX_DEFAULT_PALETTE];
    matrixSelectedColor = matrixPalette[0];
    saveMatrixSettings();
    matrixRenderPalette();
  };

  document.getElementById('matrixPresetSelect').onchange = (e) => {
    const name = e.target.value;
    if (name) {
      matrixLoadPreset(name);
    } else {
      matrixActivePresetName = null;
      saveMatrixSettings();
      matrixUpdatePresetSelect();
    }
  };

  document.getElementById('matrixSavePreset').onclick = matrixSavePreset;
  document.getElementById('matrixDeletePreset').onclick = matrixDeletePreset;
  document.getElementById('matrixClearAll').onclick = matrixClearAll;
  document.getElementById('matrixApply').onclick = applyMatrix;

  matrixUpdateToolButtons();
  matrixUpdatePaintTargetButtons();
  matrixUpdateBgControls();
  matrixUpdateLayerTabs();
  matrixUpdateLayerControls();
  matrixRenderPalette();
  matrixRenderGrid();
  matrixUpdatePresetSelect();
}

function matrixInitIcons() {
  document.querySelectorAll('.matrix-tool-btn').forEach((btn) => {
    const icon = MATRIX_TOOL_ICONS[btn.dataset.tool];
    if (icon) btn.innerHTML = icon;
  });
  const savePreset = document.getElementById('matrixSavePreset');
  const deletePreset = document.getElementById('matrixDeletePreset');
  document.querySelectorAll('.matrix-layer-clear').forEach((btn) => {
    btn.innerHTML = MATRIX_TOOL_ICONS.trash;
  });
  if (savePreset) savePreset.innerHTML = MATRIX_TOOL_ICONS.floppy;
  if (deletePreset) deletePreset.innerHTML = MATRIX_TOOL_ICONS.trash;
}

function matrixIndexFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element || !element.classList.contains('matrix-pixel')) return null;
  const index = parseInt(element.dataset.index, 10);
  return Number.isInteger(index) ? index : null;
}

document.addEventListener('DOMContentLoaded', initMatrix);
