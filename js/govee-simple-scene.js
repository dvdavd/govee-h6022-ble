// govee-simple-scene.js — Simple Scene Generator editor

// ── Protocol encoding ────────────────────────────────────────────────────────

function simpleScenePackets(typeByte, subtypeByte, speed, colors) {
  const colorBytes = [];
  for (const [r, g, b] of colors) {
    colorBytes.push(r & 0xff, g & 0xff, b & 0xff);
  }

  const raw = [0x04, typeByte & 0xff, subtypeByte & 0xff, speed & 0xff, colorBytes.length, ...colorBytes];

  const data = [0xA3, 0x00, 0x01, 0x00];
  let numLines = 0;
  let lastLineMarker = 1;

  for (const b of raw) {
    if (data.length % 19 === 0) {
      numLines++;
      data.push(0xA3);
      lastLineMarker = data.length;
      data.push(numLines);
    }
    data.push(b);
  }

  if (numLines === 0) {
    data[1] = 0x00;
    data[3] = 2;
    while (data.length < 19) data.push(0);
    data.push(0xA3, 0xFF);
  } else {
    data[lastLineMarker] = 0xFF;
    data[3] = numLines + 1;
  }

  const packets = [];
  for (let i = 0; i < data.length; i += 19) {
    const chunk = data.slice(i, i + 19);
    packets.push(finish(chunk));
  }

  packets.push(finish([0x33, 0x05, 0x0A, 0x3D]));
  return packets;
}

async function activateSimpleScene(typeByte, subtypeByte, speed, colors) {
  const packets = simpleScenePackets(typeByte, subtypeByte, speed, colors);
  await sendPackets(packets);
}

// ── Scene type definitions ───────────────────────────────────────────────────

const SIMPLE_SCENE_TYPES = [
  { name: 'Breathe', type: 0x05, subtype: 0x00 },
  { name: 'Gradient', type: 0x00, subtype: 0x00 },
  { name: 'Fire', type: 0x0f, subtype: 0x00 },
  { name: 'Rainbow', type: 0x09, subtype: 0x00 },
  { name: 'Dream', type: 0x0e, subtype: 0x0e },
  { name: 'Graffiti', type: 0x52, subtype: 0x0d },
  { name: 'Gleam', type: 0x53, subtype: 0x00 },
];

const SG_TYPE_INDEX = {
  dream: SIMPLE_SCENE_TYPES.findIndex(s => s.name === 'Dream'),
  graffiti: SIMPLE_SCENE_TYPES.findIndex(s => s.name === 'Graffiti'),
};

const SG_DREAM_SUBTYPES = { up: 0x0d, down: 0x0e };
const SG_GRAFFITI_SUBTYPES = { 1: 0x0d, 2: 0x0e, 3: 0x39, 4: 0x3a };

const SG_DEFAULT_PALETTE = [
  '#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#8b00ff'
];

const SG_MAX_COLORS = 8;
const SG_SCHEMA_VERSION = 2;
const SG_STORAGE_KEY = 'govee_sg_settings';
const SG_PRESETS_KEY = 'govee_sg_presets';

// ── State ────────────────────────────────────────────────────────────────────

let sgSelectedType = 0;
let sgSpeed = 50;
let sgPalette = [...SG_DEFAULT_PALETTE];
let sgActivePresetName = null;
let sgDreamDirection = 'down';
let sgGraffitiVariant = 1;
let sgEditingColorIndex = -1;
let sgColorWheelApi = null;
let appColorEditorSave = null;

function migrateSgTypeSelection(selectedType, data = {}, updateState = true) {
  const n = Number(selectedType);
  if (!Number.isInteger(n)) return 0;
  if (data.schemaVersion >= SG_SCHEMA_VERSION && n >= 0 && n < SIMPLE_SCENE_TYPES.length) {
    return n;
  }
  if ((data.dreamDirection || data.graffitiVariant != null) && n >= 0 && n < SIMPLE_SCENE_TYPES.length) {
    return n;
  }
  if (n <= 3) return n;
  if (n === 4) {
    if (updateState) sgDreamDirection = 'up';
    return SG_TYPE_INDEX.dream;
  }
  if (n === 5) {
    if (updateState) sgDreamDirection = 'down';
    return SG_TYPE_INDEX.dream;
  }
  if (n >= 6 && n <= 9) {
    if (updateState) sgGraffitiVariant = n - 5;
    return SG_TYPE_INDEX.graffiti;
  }
  if (n === 10) return SIMPLE_SCENE_TYPES.findIndex(s => s.name === 'Gleam');
  return Math.max(0, Math.min(SIMPLE_SCENE_TYPES.length - 1, n));
}

function resolveSgSceneConfig(data = null) {
  const selectedType = data
    ? migrateSgTypeSelection(data.selectedType ?? 0, data, false)
    : sgSelectedType;
  const scene = SIMPLE_SCENE_TYPES[selectedType] || SIMPLE_SCENE_TYPES[0];
  const oldType = Number(data?.selectedType);
  const oldDreamDirection = oldType === 4 ? 'up' : oldType === 5 ? 'down' : null;
  const oldGraffitiVariant = oldType >= 6 && oldType <= 9 ? oldType - 5 : null;
  const direction = data?.dreamDirection || oldDreamDirection || sgDreamDirection;
  const variant = Number(data?.graffitiVariant ?? oldGraffitiVariant ?? sgGraffitiVariant) || 1;
  if (scene.name === 'Dream') {
    return { ...scene, subtype: SG_DREAM_SUBTYPES[direction] ?? SG_DREAM_SUBTYPES.down };
  }
  if (scene.name === 'Graffiti') {
    return { ...scene, subtype: SG_GRAFFITI_SUBTYPES[variant] ?? SG_GRAFFITI_SUBTYPES[1] };
  }
  return scene;
}

// ── localStorage ─────────────────────────────────────────────────────────────

function loadSgSettings() {
  try {
    const stored = localStorage.getItem(SG_STORAGE_KEY);
    if (!stored) return;
    const data = JSON.parse(stored);
    if (data.dreamDirection) sgDreamDirection = data.dreamDirection;
    if (data.graffitiVariant != null) sgGraffitiVariant = Number(data.graffitiVariant) || 1;
    if (data.selectedType != null) sgSelectedType = migrateSgTypeSelection(data.selectedType, data);
    if (data.speed != null) sgSpeed = data.speed;
    if (data.palette) sgPalette = data.palette;
    if (data.activePresetName) sgActivePresetName = data.activePresetName;
  } catch (e) {
    console.warn('Failed to load SG settings:', e);
  }
}

function saveSgSettings() {
  try {
    const data = {
      selectedType: sgSelectedType,
      schemaVersion: SG_SCHEMA_VERSION,
      dreamDirection: sgDreamDirection,
      graffitiVariant: sgGraffitiVariant,
      speed: sgSpeed,
      palette: sgPalette,
      activePresetName: sgActivePresetName,
    };
    localStorage.setItem(SG_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save SG settings:', e);
  }
}

function loadSgPresets() {
  try {
    const raw = localStorage.getItem(SG_PRESETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSgPresets(presets) {
  try {
    localStorage.setItem(SG_PRESETS_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('Failed to save SG presets:', e);
  }
}

function sgUpdatePresetSelect() {
  const names = Object.keys(loadSgPresets()).sort();
  sgActivePresetName = syncPresetSelect('sgPresetSelect', 'sgDeletePreset', names, sgActivePresetName, saveSgSettings);
}

function sgLoadPreset(name) {
  const presets = loadSgPresets();
  const preset = presets[name];
  if (!preset) return;

  if (preset.dreamDirection) sgDreamDirection = preset.dreamDirection;
  if (preset.graffitiVariant != null) sgGraffitiVariant = Number(preset.graffitiVariant) || 1;
  if (preset.selectedType != null) sgSelectedType = migrateSgTypeSelection(preset.selectedType, preset);
  if (preset.speed != null) sgSpeed = preset.speed;
  if (Array.isArray(preset.palette)) sgPalette = [...preset.palette];
  sgActivePresetName = name;

  saveSgSettings();
  sgUpdatePresetSelect();

  const speedSlider = document.getElementById('sgSpeed');
  const speedVal = document.getElementById('sgSpeedVal');
  renderSgTypeSeg();
  if (speedSlider) speedSlider.value = sgSpeed;
  if (speedVal) speedVal.textContent = sgSpeed;
  renderSgPalette();
}

function sgSavePreset() {
  let name = sgActivePresetName;
  if (!name) {
    name = prompt('Save preset as:', '');
    if (!name?.trim()) return;
    name = name.trim();
  }

  const presets = loadSgPresets();
  presets[name] = {
    selectedType: sgSelectedType,
    schemaVersion: SG_SCHEMA_VERSION,
    dreamDirection: sgDreamDirection,
    graffitiVariant: sgGraffitiVariant,
    speed: sgSpeed,
    palette: [...sgPalette],
  };
  saveSgPresets(presets);

  sgActivePresetName = name;
  saveSgSettings();
  sgUpdatePresetSelect();
  if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
}

function sgDeletePreset() {
  if (!sgActivePresetName) return;
  if (!confirm(`Delete preset "${sgActivePresetName}"?`)) return;

  const presets = loadSgPresets();
  delete presets[sgActivePresetName];
  saveSgPresets(presets);

  sgActivePresetName = null;
  saveSgSettings();
  sgUpdatePresetSelect();
  if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function renderSgPalette() {
  const container = document.getElementById('sgPalette');
  container.innerHTML = '';

  sgPalette.forEach((hex, i) => {
    const swatch = document.createElement('div');
    swatch.className = 'sg-swatch';
    swatch.style.background = hex;
    swatch.style.setProperty('--swatch-color', hex);
    swatch.onclick = () => openSgColorEditor(i);

    const del = document.createElement('button');
    del.className = 'sg-swatch-del';
    del.textContent = '✕';
    del.onclick = (e) => {
      e.stopPropagation();
      sgPalette.splice(i, 1);
      saveSgSettings();
      renderSgPalette();
    };

    swatch.append(del);
    container.appendChild(swatch);
  });

  if (sgPalette.length < SG_MAX_COLORS) {
    const add = document.createElement('button');
    add.className = 'sg-swatch sg-swatch-add';
    add.style.setProperty('--swatch-color', '#ffffff');
    add.textContent = '+';
    add.onclick = () => {
      sgPalette.push('#ffffff');
      saveSgSettings();
      renderSgPalette();
    };
    container.appendChild(add);
  }
}

function openSgColorEditor(index) {
  openAppColorEditor({
    title: 'Edit Palette Colour',
    value: sgPalette[index] || '#ffffff',
    onSave: (hex) => {
      sgPalette[index] = hex;
      saveSgSettings();
      renderSgPalette();
    },
  });
  sgEditingColorIndex = index;
}

function openAppColorEditor({ title = 'Edit Colour', value = '#ffffff', onSave } = {}) {
  appColorEditorSave = typeof onSave === 'function' ? onSave : null;
  const titleEl = document.getElementById('sgColorTitle');
  if (titleEl) titleEl.textContent = title;
  openModal('sgColorModal');
  sgColorWheelApi?.setHex(value);
  requestAnimationFrame(() => sgColorWheelApi?.sync());
}

function closeSgColorEditor() {
  closeModal('sgColorModal');
  sgEditingColorIndex = -1;
  appColorEditorSave = null;
}

function saveSgColorEditor() {
  const hex = document.getElementById('sgColorValue').value;
  appColorEditorSave?.(hex);
  closeSgColorEditor();
}

function initSgColorWheel() {
  const wheel = document.getElementById('sgColorWheel');
  const handle = document.getElementById('sgColorHandle');
  const picker = document.getElementById('sgColorValue');
  const swatch = document.getElementById('sgColorSwatch');
  const hexEl = document.getElementById('sgColorHex');
  const rgbEl = document.getElementById('sgColorRgbText');
  const brightness = document.getElementById('sgColorBrightness');
  const brightnessVal = document.getElementById('sgColorBrightnessVal');
  if (!wheel || !handle || !picker || !swatch || !hexEl || !rgbEl || !brightness || !brightnessVal) return null;

  const ctx = wheel.getContext('2d');
  const W = wheel.width;
  const R = W / 2;
  let currentHue = 0;
  let currentSat = 0;

  function drawWheel() {
    const img = ctx.createImageData(W, W);
    const d = img.data;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - R;
        const dy = y - R;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * W + x) * 4;
        if (dist > R) {
          d[i + 3] = 0;
          continue;
        }
        const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const sat = Math.min(dist / R, 1);
        const [r, g, b] = hsv2rgb(hue, sat, 1);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
        d[i + 3] = dist > R - 1.5 ? Math.round(255 * (R - dist + 1.5)) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function placeHandle(h, s) {
    const rect = wheel.getBoundingClientRect();
    if (!rect.width) return;
    const rad = s * R;
    const ang = h * Math.PI / 180;
    const sc = rect.width / W;
    handle.style.left = `${(R + rad * Math.cos(ang)) * sc}px`;
    handle.style.top = `${(R + rad * Math.sin(ang)) * sc}px`;
  }

  function currentBrightness() {
    return Math.max(0, Math.min(100, parseInt(brightness.value, 10) || 0)) / 100;
  }

  function hexFromRgb(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function applyRgb(r, g, b) {
    const normalized = hexFromRgb(r, g, b).toUpperCase();
    handle.style.background = normalized;
    swatch.style.background = normalized;
    picker.value = normalized.toLowerCase();
    hexEl.textContent = normalized;
    rgbEl.textContent = `${r}, ${g}, ${b}`;
  }

  function applyCurrentColor() {
    const [r, g, b] = hsv2rgb(currentHue, currentSat, currentBrightness());
    applyRgb(r, g, b);
    wheel.style.filter = `brightness(${0.18 + currentBrightness() * 0.82})`;
    brightnessVal.textContent = `${Math.round(currentBrightness() * 100)}%`;
  }

  function selectionFromPointer(clientX, clientY) {
    const rect = wheel.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (clientX - rect.left) / rect.width * W - R;
    const y = (clientY - rect.top) / rect.height * W - R;
    const dist = Math.sqrt(x * x + y * y);
    const ang = Math.atan2(y, x);
    const hue = (ang * 180 / Math.PI + 360) % 360;
    const sat = Math.min(dist / R, 1);
    const sc = rect.width / W;
    const rad = Math.min(dist, R);
    return { ang, rad, sc, hue, sat };
  }

  function pickAt(clientX, clientY) {
    const pick = selectionFromPointer(clientX, clientY);
    if (!pick) return;
    handle.style.left = `${(R + pick.rad * Math.cos(pick.ang)) * pick.sc}px`;
    handle.style.top = `${(R + pick.rad * Math.sin(pick.ang)) * pick.sc}px`;
    currentHue = pick.hue;
    currentSat = pick.sat;
    applyCurrentColor();
  }

  let dragging = false;
  wheel.addEventListener('pointerdown', e => {
    dragging = true;
    try { wheel.setPointerCapture(e.pointerId); } catch (_) {}
    pickAt(e.clientX, e.clientY);
  });
  wheel.addEventListener('pointermove', e => { if (dragging) pickAt(e.clientX, e.clientY); });
  wheel.addEventListener('pointerup', e => { if (dragging) { pickAt(e.clientX, e.clientY); dragging = false; } });
  wheel.addEventListener('pointercancel', () => { dragging = false; });

  function setHex(hex) {
    picker.value = hex;
    sync();
  }

  function sync() {
    const hex = picker.value || '#ffffff';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const [h, s, v] = rgb2hsv(r, g, b);
    currentHue = h;
    currentSat = s;
    brightness.value = Math.round(v * 100);
    placeHandle(currentHue, currentSat);
    applyCurrentColor();
  }

  brightness.addEventListener('input', applyCurrentColor);
  drawWheel();
  requestAnimationFrame(sync);
  return { setHex, sync };
}

function renderSgTypeSeg() {
  const seg = document.getElementById('sgTypeSeg');
  if (!seg) return;
  if (seg.children.length !== SIMPLE_SCENE_TYPES.length) {
    seg.innerHTML = '';
  }
  SIMPLE_SCENE_TYPES.forEach((scene, i) => {
    let btn = seg.querySelector(`button[data-type-index="${i}"]`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.typeIndex = i;
      seg.appendChild(btn);
    }
    btn.textContent = scene.name;
    btn.onclick = () => {
      if (sgSelectedType === i) return;
      sgSelectedType = i;
      saveSgSettings();
      renderSgTypeSeg();
    };
  });
  setSegmentValue(seg, 'typeIndex', sgSelectedType);
  renderSgOptionControls();
}

function renderSgOptionControls() {
  const scene = SIMPLE_SCENE_TYPES[sgSelectedType];
  const dreamPanel = document.getElementById('sgDreamOptions');
  const graffitiPanel = document.getElementById('sgGraffitiOptions');
  dreamPanel?.classList.toggle('visible', scene?.name === 'Dream');
  graffitiPanel?.classList.toggle('visible', scene?.name === 'Graffiti');

  setSegmentValue('sgDreamDirection', 'direction', sgDreamDirection);
  document.querySelectorAll('#sgDreamDirection button').forEach(btn => {
    btn.onclick = () => {
      sgDreamDirection = btn.dataset.direction === 'up' ? 'up' : 'down';
      saveSgSettings();
      renderSgOptionControls();
    };
  });

  setSegmentValue('sgGraffitiVariant', 'variant', sgGraffitiVariant);
  document.querySelectorAll('#sgGraffitiVariant button').forEach(btn => {
    btn.onclick = () => {
      sgGraffitiVariant = Number(btn.dataset.variant);
      saveSgSettings();
      renderSgOptionControls();
    };
  });
}

// ── UI initialization ────────────────────────────────────────────────────────

function initSimpleScene() {
  loadSgSettings();

  sgColorWheelApi = initSgColorWheel();
  window.addEventListener('resize', () => requestAnimationFrame(() => sgColorWheelApi?.sync()));
  renderSgTypeSeg();

  const speedSlider = document.getElementById('sgSpeed');
  const speedVal = document.getElementById('sgSpeedVal');
  speedSlider.value = sgSpeed;
  speedVal.textContent = sgSpeed;
  speedSlider.oninput = (e) => {
    sgSpeed = parseInt(e.target.value, 10);
    speedVal.textContent = sgSpeed;
  };
  speedSlider.onchange = () => saveSgSettings();

  renderSgPalette();

  document.getElementById('sgPresetSelect').onchange = (e) => {
    const name = e.target.value;
    if (name) {
      sgLoadPreset(name);
    } else {
      sgActivePresetName = null;
      saveSgSettings();
      sgUpdatePresetSelect();
    }
  };

  const savePresetBtn = document.getElementById('sgSavePreset');
  const deletePresetBtn = document.getElementById('sgDeletePreset');
  if (savePresetBtn) savePresetBtn.innerHTML = MATRIX_TOOL_ICONS.floppy;
  if (deletePresetBtn) deletePresetBtn.innerHTML = MATRIX_TOOL_ICONS.trash;
  savePresetBtn.onclick = sgSavePreset;
  deletePresetBtn.onclick = sgDeletePreset;

  sgUpdatePresetSelect();

  const resetBtn = document.getElementById('sgReset');
  resetBtn.onclick = () => {
    sgPalette = [...SG_DEFAULT_PALETTE];
    saveSgSettings();
    renderSgPalette();
  };

  const applyBtn = document.getElementById('sgApply');
  applyBtn.onclick = async () => {
    if (!isConnected()) return;
    try {
      const scene = resolveSgSceneConfig();
      const colors = sgPalette.map(hexToRgb);
      await runBleTransaction('Simple scene', async () => {
        await activateSimpleScene(scene.type, scene.subtype, sgSpeed, colors);
        const label = sgActivePresetName || scene.name;
        if (typeof rememberActiveScene === 'function') {
          rememberActiveScene(
            sgActivePresetName ? `sg:${sgActivePresetName}` : 'sg:',
            15626,
            label,
            sgPresetPreviewGradient({ palette: sgPalette })
          );
        }
        assumeLightOn({ musicMode: false, sceneCode: 15626, modeDisplay: { kind: 'scene', label } });
        if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
        await new Promise(r => setTimeout(r, 200));
        currentState = mergeState(currentState, await queryModeState());
      });
      updateUI(currentState);
    } catch (e) {
      log('err', `Simple scene: ${e.message}`);
    }
  };
}

document.addEventListener('DOMContentLoaded', initSimpleScene);
window.closeSgColorEditor = closeSgColorEditor;
window.saveSgColorEditor = saveSgColorEditor;
window.openAppColorEditor = openAppColorEditor;
