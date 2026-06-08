// govee-state.js — Device state queries, UI rendering, scene/music dictionaries, modals

const SCENE_NAMES = {
  35: 'Reading', 38: 'Night Light', 40: 'Fire', 41: 'Snow Flake',
  42: 'Rainbow', 43: 'Ocean', 44: 'Forest', 45: 'Joyful', 46: 'Wave',
  47: 'Starry Sky', 99: 'White Light',
  8478: 'Sunrise', 8479: 'Sunset', 8480: 'Sunset Glow', 8481: 'Aurora',
  8482: 'Spring Wind', 8483: 'Sky', 8484: 'Firefly', 8485: 'Falling Petals',
  8486: 'Cherry Blossoms', 8487: 'Raining', 8488: 'Desert', 8489: 'Karst Cave',
  8490: 'Mountain Forest', 8491: 'Feather', 8492: 'Spring', 8493: 'Summer',
  8494: 'Fall', 8495: 'Winter', 8496: 'Lake',
  8497: 'Morning', 8498: 'Afternoon', 8499: 'Leisure', 8500: 'Refreshing',
  8501: 'Fish Tank', 8502: 'Goldfish', 8503: 'Train', 8504: 'Kitchen Aromas',
  8505: 'Breathe', 8506: 'Gradient', 8507: 'Graffiti', 8508: 'Dreamlike',
  8509: 'Smudge', 8510: "Rubik's Cube", 8511: 'Interlaced', 8512: 'Swing',
  8513: 'Christmas', 8514: 'Halloween', 8515: 'Christmas Bell',
  8516: 'Candy Cane', 8517: "Valentine's Day", 8518: 'Heartbeat',
  8519: "Saint Patrick's Day", 8520: 'Easter Egg', 8521: 'Ghost',
  8522: 'Healing', 8523: 'Accompany', 8524: 'Dreamland', 8525: 'Night',
  8526: 'Mysterious', 8527: 'Soothing',
  8528: 'Earth', 8529: 'Mars', 8530: 'Venus', 8531: 'Uranus',
  8532: 'Jupiter', 8533: 'Milky Way',
  15626: 'Simple Scene Generator', 20900: 'Flash (Zootopia 2)',
  20901: 'Graffiti 4', 20902: 'Judy', 20903: 'Nick',
  20904: 'ZDP Duo', 20905: 'ZDP Trio',
  23040: "Mother's Hug",
  21780: 'Christmas Baubles', 21781: 'Christmas Eve', 21782: 'Candy Cane B',
  21783: 'Santa Hat', 21784: 'Christmas Stripe', 21785: 'Christmas Stripe B',
  21786: 'Christmas Stripe C', 21787: 'Christmas Stripe D',
  21788: 'Christmas Gift', 21789: 'Christmas Wreath', 21790: 'Snow House',
  21791: 'Christmas Tree', 21792: 'Gingerbread Man', 21793: 'Christmas Stocking',
  21794: 'Santa Claus', 21795: 'Grim Graveyard', 21796: 'Poison',
  21797: 'Lightning Bats', 21798: 'Halloween Witches', 21799: 'Thanksgiving',

  'Flash (Sound)': 'Flash (Sound)',
  'Spin (Sound)': 'Spin (Sound)',
  'Lightning (Sound)': 'Lightning (Sound)',
};

const MUSIC_NAMES = {
  0x33: 'Hopping', 0x38: 'Rhythm', 0x39: 'Energic', 0x54: 'Spectrum',
  0x55: 'Color Painting', 0x63: 'Light Waves', 0x64: 'Dandelion', 0x65: 'Meteor Shower',
};

const SCENE_CODE_ALIASES = {
  'Breathe': 8505,
  'Rainbow': 8505,
  'Gleam': 8505,
  'Flash (Sound)': 8505,
  'Spin (Sound)': 8505,
  'Lightning (Sound)': 8505,
  'Gradient': 8506,
  'Graffiti': 8507,
  'Dreamlike': 8508,
};

let currentCustomColor = null;
let sceneHoldUntil = 0;
let colorHoldUntil = 0;
let heldCustomColor = null;
let activeScenePreview = null;
const DISPLAY_RGB_KEY = 'govee-display-rgb-source';

function rgbToDisplayHex(r, g, b) {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Number(v) || 0)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function parseModeKelvin(r) {
  const be = (r[6] << 8) | r[7];
  const le = r[6] | (r[7] << 8);
  if (be >= 1800 && be <= 8000) return be;
  if (le >= 1800 && le <= 8000) return le;
  return null;
}

function customSceneDisplayLabel(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.startsWith('sg:')) {
    const name = key.slice(3);
    if (name) return name;
    const presets = typeof loadSgPresets === 'function' ? loadSgPresets() : {};
    const preset = presets[name];
    const scene = typeof resolveSgSceneConfig === 'function'
      ? resolveSgSceneConfig(preset)
      : typeof SIMPLE_SCENE_TYPES !== 'undefined'
      ? SIMPLE_SCENE_TYPES[preset?.selectedType ?? 0]
      : null;
    return scene ? `${scene.name} (Custom)` : 'Custom Scene';
  }
  if (key.startsWith('matrix:')) return key.slice(7) || 'Custom Matrix';
  return null;
}

function sceneCodeFromKey(key) {
  if (key == null) return null;
  if (String(Number(key)) === String(key)) return Number(key);
  if (typeof key !== 'string') return null;
  if (key.startsWith('sg:')) return 15626;
  if (key.startsWith('matrix:')) return 8524;
  return SCENE_CODE_ALIASES[key] ?? null;
}

function sceneDisplayName(sceneCode) {
  if (activeScenePreview?.sceneCode === sceneCode && activeScenePreview.label) {
    return activeScenePreview.label;
  }
  const key = typeof activeSceneKey !== 'undefined' ? activeSceneKey : null;
  const activeCode = sceneCodeFromKey(key);
  if (activeCode === sceneCode) {
    const customLabel = customSceneDisplayLabel(key);
    if (customLabel) return customLabel;
  }
  if (activeCode === sceneCode && key && !key.includes(':')) {
    return key.replace(/ \(Sound\)$/, '');
  }
  return SCENE_NAMES[sceneCode] || `#${sceneCode}`;
}

function rememberActiveScene(key, sceneCode, label, gradient = null) {
  if (typeof activeSceneKey !== 'undefined') activeSceneKey = key;
  activeScenePreview = { key, sceneCode, label, gradient };
}

function rgbObject(r, g, b) {
  return {
    r: Math.max(0, Math.min(255, Math.round(Number(r) || 0))),
    g: Math.max(0, Math.min(255, Math.round(Number(g) || 0))),
    b: Math.max(0, Math.min(255, Math.round(Number(b) || 0))),
  };
}

function sameRgb(a, b) {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

function loadStoredDisplayRgb() {
  try {
    const data = JSON.parse(localStorage.getItem(DISPLAY_RGB_KEY) || 'null');
    if (!data?.source || !data?.sent) return null;
    return {
      source: rgbObject(data.source.r, data.source.g, data.source.b),
      sent: rgbObject(data.sent.r, data.sent.g, data.sent.b),
      savedAt: Number(data.savedAt) || 0,
    };
  } catch (e) {
    return null;
  }
}

function clearStoredDisplayRgb() {
  localStorage.removeItem(DISPLAY_RGB_KEY);
}

function storeDisplayRgb(r, g, b) {
  const source = rgbObject(r, g, b);
  const [sr, sg, sb] = applyCalibration(source.r, source.g, source.b, 'solidColours');
  localStorage.setItem(DISPLAY_RGB_KEY, JSON.stringify({
    source,
    sent: rgbObject(sr, sg, sb),
    savedAt: Date.now(),
  }));
}

function rememberChosenRgb(r, g, b) {
  const source = rgbObject(r, g, b);
  heldCustomColor = { type: 'rgb', ...source };
  colorHoldUntil = Date.now() + 15000;
  storeDisplayRgb(source.r, source.g, source.b);
}

function displayRgbPatch(r, g, b) {
  currentCustomColor = { type: 'rgb', r, g, b };
  return {
    musicMode: false,
    sceneCode: 0,
    colorHex: rgbToDisplayHex(r, g, b),
    modeDisplay: { kind: 'rgb', label: rgbToDisplayHex(r, g, b) },
  };
}

function chosenRgbPatch(readback) {
  if (Date.now() < colorHoldUntil && heldCustomColor?.type === 'rgb') {
    return displayRgbPatch(heldCustomColor.r, heldCustomColor.g, heldCustomColor.b);
  }

  const stored = loadStoredDisplayRgb();
  if (!stored) return null;
  const device = rgbObject(readback.r, readback.g, readback.b);
  const currentCorrected = rgbObject(...applyCalibration(stored.source.r, stored.source.g, stored.source.b, 'solidColours'));
  if (sameRgb(device, stored.sent) || sameRgb(device, currentCorrected)) {
    return displayRgbPatch(stored.source.r, stored.source.g, stored.source.b);
  }

  clearStoredDisplayRgb();
  return null;
}

async function queryPresets(colourCount, sceneCount) {
  const colours = [];
  const scenes  = [];

  const colourPages = Math.ceil(colourCount / 4);
  for (let p = 1; p <= colourPages; p++) {
    const r = await requestPacket([0xaa, 0x73, p], expectOpcode(0xaa, 0x73));
    if (r[0] !== 0xaa || r[1] !== 0x73) continue;
    const n = Math.min(4, colourCount - (p - 1) * 4);
    for (let i = 0; i < n; i++) {
      const b = 3 + i * 4;
      colours.push({ type: r[b], b1: r[b+1], b2: r[b+2], b3: r[b+3] });
    }
  }

  const scenePages = Math.ceil(sceneCount / 4);
  for (let p = 1; p <= scenePages; p++) {
    const r = await requestPacket([0xaa, 0x74, p], expectOpcode(0xaa, 0x74));
    if (r[0] !== 0xaa || r[1] !== 0x74) continue;
    const n = Math.min(4, sceneCount - (p - 1) * 4);
    for (let i = 0; i < n; i++) {
      const b = 3 + i * 4;
      const code = r[b] | (r[b+1] << 8);
      if (code !== 0) scenes.push(code);
    }
  }

  return { colours, scenes };
}

function readAscii(bytes, offset) {
  const s = bytes.slice(offset).filter(b => b > 0 && b < 128);
  return new TextDecoder().decode(s) || null;
}

async function queryState() {
  return {
    ...await queryLiveState(),
    ...await queryStaticInfo(),
    ...await queryBedtimeState(),
    ...await queryPresetState(),
  };
}

function mergeState(base, patch) {
  const merged = { ...(base || {}), ...(patch || {}) };
  const kind = patch?.modeDisplay?.kind;
  const keepScene = Date.now() < sceneHoldUntil
    && base?.sceneCode > 0
    && patch?.sceneCode === 0
    && (kind === 'rgb' || kind === 'cct');

  if (keepScene) {
    return {
      ...merged,
      musicMode: false,
      sceneCode: base.sceneCode,
      modeDisplay: base.modeDisplay,
    };
  }

  if (patch?.musicMode === false && patch?.sceneCode > 0) {
    sceneHoldUntil = Date.now() + 15000;
  }

  return merged;
}

function assumeLightOn(patch) {
  if (patch?.musicMode === false && patch?.sceneCode > 0) {
    sceneHoldUntil = Date.now() + 15000;
    colorHoldUntil = 0;
    heldCustomColor = null;
    clearStoredDisplayRgb();
  } else if (patch?.sceneCode === 0 || patch?.musicMode === true) {
    sceneHoldUntil = 0;
    activeScenePreview = null;
    if (typeof activeSceneKey !== 'undefined') activeSceneKey = null;
  }
  if (patch?.modeDisplay?.kind === 'rgb' && currentCustomColor?.type === 'rgb') {
    rememberChosenRgb(currentCustomColor.r, currentCustomColor.g, currentCustomColor.b);
  } else if (patch?.modeDisplay?.kind === 'cct' || patch?.musicMode === true) {
    colorHoldUntil = 0;
    heldCustomColor = null;
    clearStoredDisplayRgb();
  }
  currentState = mergeState(currentState, { on: true, ...(patch || {}) });
  updateUI(currentState);
}

function parsePowerState(r) {
  return (r[0] === 0xaa && r[1] === 0x01) ? { on: r[2] === 1 } : {};
}

function parseBrightnessState(r) {
  return (r[0] === 0xaa && r[1] === 0x04) ? { brightness: r[2] } : {};
}

function parseModeState(r) {
  if (r[0] === 0xaa && r[1] === 0x05) {
    const mode = r[2];
    if (mode === 0x13) {
      const label = MUSIC_NAMES[r[3]] || `Preset ${r[3]}`;
      colorHoldUntil = 0;
      heldCustomColor = null;
      clearStoredDisplayRgb();
      return { musicMode: true, sceneCode: null, musicPreset: r[3], musicSensitivity: r[4], modeDisplay: { kind: 'music', label } };
    }
    if (mode === 0x0d) {
      if (r[3] === 0x01) {
        colorHoldUntil = 0;
        heldCustomColor = null;
        clearStoredDisplayRgb();
        return { musicMode: true, sceneCode: null, musicPreset: null, modeDisplay: { kind: 'music', label: 'Browser Mic' } };
      }
      const kelvin = parseModeKelvin(r);
      if (kelvin) {
        colorHoldUntil = 0;
        heldCustomColor = null;
        clearStoredDisplayRgb();
        currentCustomColor = { type: 'cct', kelvin };
        return { musicMode: false, sceneCode: 0, cctKelvin: kelvin, modeDisplay: { kind: 'cct', label: `${kelvin}K` } };
      }
      const [rVal, gVal, bVal] = [r[3], r[4], r[5]];
      const chosen = chosenRgbPatch({ r: rVal, g: gVal, b: bVal });
      if (chosen) return chosen;
      currentCustomColor = { type: 'rgb', r: rVal, g: gVal, b: bVal };
      return { musicMode: false, sceneCode: 0, colorHex: rgbToDisplayHex(rVal, gVal, bVal), modeDisplay: { kind: 'rgb', label: rgbToDisplayHex(rVal, gVal, bVal) } };
    }
    const sceneCode = mode === 0x04 ? (r[3] | (r[4] << 8)) : (mode | (r[3] << 8));
    colorHoldUntil = 0;
    heldCustomColor = null;
    clearStoredDisplayRgb();
    return { musicMode: false, sceneCode };
  }
  return {};
}

function parseBedtimeState(r) {
  if (r[0] !== 0xaa || r[1] !== 0x30) return {};
  return {
    bedtime: {
      enabled:     r[2] === 0x01,
      startHour:   r[3],
      startMinute: r[4],
      endHour:     r[5],
      endMinute:   r[6],
      sensitivity: r[7],
      brightness:  r[8],
    },
  };
}

function applyStateReport(r) {
  if (!currentState) return false;

  let patch = {};
  if (r[0] === 0xaa && r[1] === 0x01) patch = parsePowerState(r);
  else if (r[0] === 0xaa && r[1] === 0x04) patch = parseBrightnessState(r);
  else if (r[0] === 0xaa && r[1] === 0x05) patch = parseModeState(r);
  else if (r[0] === 0xaa && r[1] === 0x30) patch = parseBedtimeState(r);
  else return false;

  currentState = mergeState(currentState, patch);
  updateUI(currentState);
  return true;
}

async function queryPowerState() {
  const r01 = await requestPacket([0xaa, 0x01], expectOpcode(0xaa, 0x01));
  return parsePowerState(r01);
}

async function queryBrightnessState() {
  const r04 = await requestPacket([0xaa, 0x04], expectOpcode(0xaa, 0x04));
  return parseBrightnessState(r04);
}

async function queryModeState() {
  const r05 = await requestPacket([0xaa, 0x05, 0x01], expectOpcode(0xaa, 0x05));
  return parseModeState(r05);
}

async function queryLiveState() {
  return {
    ...await queryPowerState(),
    ...await queryBrightnessState(),
    ...await queryModeState(),
  };
}

async function queryStaticInfo() {
  const s = {};

  const r06 = await requestPacket([0xaa, 0x06], expectOpcode(0xaa, 0x06));
  if (r06[0] === 0xaa && r06[1] === 0x06) s.fwWifi = readAscii(r06, 2);

  const r07 = await requestPacket([0xaa, 0x07, 0x03], expectOpcode(0xaa, 0x07));
  if (r07[0] === 0xaa && r07[1] === 0x07) s.fwMcu = readAscii(r07, 3);

  const r20 = await requestPacket([0xaa, 0x20], expectOpcode(0xaa, 0x20));
  if (r20[0] === 0xaa && r20[1] === 0x20) s.fw20 = readAscii(r20, 2);

  const r21 = await requestPacket([0xaa, 0x21], expectOpcode(0xaa, 0x21));
  if (r21[0] === 0xaa && r21[1] === 0x21) s.fw21 = readAscii(r21, 2);

  const r14 = await requestPacket([0xaa, 0x14], expectOpcode(0xaa, 0x14));
  if (r14[0] === 0xaa && r14[1] === 0x14) s.deviceId = hex(r14.slice(2, 8));

  return s;
}

async function queryBedtimeState() {
  const r30 = await requestPacket([0xaa, 0x30], expectOpcode(0xaa, 0x30));
  return parseBedtimeState(r30);
}

async function queryPresetState() {
  const s = {};
  const r72 = await requestPacket([0xaa, 0x72], expectOpcode(0xaa, 0x72));
  if (r72[0] === 0xaa && r72[1] === 0x72) {
    s.colourPresets = r72[2];
    s.scenePresets  = r72[3];
    const p = await queryPresets(s.colourPresets, s.scenePresets);
    s.colourPresetList = p.colours;
    s.scenePresetList  = p.scenes;
  }

  return s;
}

function updateUI(s) {
  updateBulbCard(s);

  if (s.brightness != null) {
    const el = document.getElementById('brightnessSlider');
    el.value = s.brightness;
    document.getElementById('brightnessSliderVal').textContent = s.brightness;
  }

  if (s.modeDisplay?.kind === 'rgb' && s.colorHex) {
    const picker = document.getElementById('colorPicker');
    if (picker && picker.value.toUpperCase() !== s.colorHex.toUpperCase()) {
      picker.value = s.colorHex;
      window.syncColourWheel?.();
    }
  }

  if (s.fwWifi)   document.getElementById('fwWifi').textContent = s.fwWifi;
  if (s.fwMcu)    document.getElementById('fwMcu').textContent  = s.fwMcu;
  if (s.fw20)     document.getElementById('fw20').textContent   = s.fw20;
  if (s.fw21)     document.getElementById('fw21').textContent   = s.fw21;
  if (s.deviceId) document.getElementById('devId').textContent  = s.deviceId;
  if (s.colourPresets != null)
    document.getElementById('presetCounts').textContent = `${s.colourPresets} colour · ${s.scenePresets} scene`;

  if (s.bedtime) {
    const bt = s.bedtime;
    const sub = document.getElementById('bedtimeBtnSub');
    const p2 = n => String(n).padStart(2, '0');
    if (bt.enabled && sub) {
      sub.textContent = `${p2(bt.startHour)}:${p2(bt.startMinute)}–${p2(bt.endHour)}:${p2(bt.endMinute)}`;
    } else if (sub) {
      sub.textContent = '';
    }
  }

  renderPresets(s);
  if (typeof renderScenePresetGrid === 'function') renderScenePresetGrid(s);
  if (typeof updateFavButtons === 'function') updateFavButtons();
  highlightActiveScene(s.musicMode ? null : s.sceneCode);
}

function highlightActiveScene(sceneCode) {
  const badges = document.querySelectorAll('.scene-badge');
  const activeKey = typeof activeSceneKey !== 'undefined' ? activeSceneKey : null;
  const activeKeyCode = sceneCodeFromKey(activeKey);
  const useActiveKey = activeKey && activeKeyCode === sceneCode;
  const matching = [...badges].filter(b =>
    Number(b.dataset.sceneCode) === sceneCode && !b.classList.contains('preset-scene-badge')
  );
  const isAmbiguous = matching.length > 1;
  badges.forEach(b => {
    const codeMatch = sceneCode != null && Number(b.dataset.sceneCode) === sceneCode;
    let isActive = codeMatch;
    if (isActive && useActiveKey) {
      isActive = b.dataset.sceneKey === activeKey;
    }
    if (isActive && !b.classList.contains('preset-scene-badge') && isAmbiguous) {
      isActive = !!activeKey && b.dataset.sceneKey === activeKey;
    }
    b.classList.toggle('active', isActive);
  });
}

function _bulbCardBorderForState(s, bri) {
  const FALLBACK_COLOR = `rgba(0,172,231,${(0.70 * bri).toFixed(2)})`;

  if (s.musicMode) {
    return {
      borderColor: FALLBACK_COLOR,
      glow: `0 0 ${Math.round(10 * bri)}px rgba(0,172,231,${(0.30 * bri).toFixed(2)})`,
    };
  }

  if (s.sceneCode && s.sceneCode > 0) {
    if (activeScenePreview?.sceneCode === s.sceneCode && activeScenePreview.gradient) {
      return { borderColor: _cssColorsWithOpacity(activeScenePreview.gradient, bri), glow: '' };
    }

    const activeBadge = activeSceneKey
      ? [...document.querySelectorAll('.scene-badge')].find(b => b.dataset.sceneKey === activeSceneKey)
      : null;
    const badge = activeBadge || document.querySelector(`.scene-badge[data-scene-code="${s.sceneCode}"]`);
    if (badge?._sceneColors?.length) {
      const borderColor = badge._sceneColors.length === 1
        ? `rgba(${badge._sceneColors[0].rgb.join(',')},${bri.toFixed(2)})`
        : weightedSceneGradient(badge._sceneColors, bri);
      return { borderColor, glow: '' };
    }
    if (badge?._sceneGradient) return { borderColor: _cssColorsWithOpacity(badge._sceneGradient, bri), glow: '' };

    // No DOM badge yet (tab not yet rendered) — compute directly from scene data
    if (typeof scenePreviewGradient === 'function') {
      const key = activeSceneKey || (() => {
        if (typeof SCENE_CATEGORIES !== 'undefined') {
          for (const [, keys] of Object.entries(SCENE_CATEGORIES)) {
            for (const k of keys) {
              if (typeof k === 'number' && k === s.sceneCode) return k;
            }
          }
        }
        return null;
      })();
      if (key != null) {
        const gradient = scenePreviewGradient(key);
        if (gradient) return { borderColor: _cssColorsWithOpacity(gradient, bri), glow: '' };
      }
    }
    return { borderColor: FALLBACK_COLOR, glow: '' };
  }

  if (currentCustomColor?.type === 'rgb') {
    const { r, g, b } = currentCustomColor;
    return {
      borderColor: `rgba(${r},${g},${b},${(0.70 * bri).toFixed(2)})`,
      glow: `inset 0 0 0 1px rgba(${r},${g},${b},${(0.8 * bri).toFixed(2)}), 0 0 ${Math.round(10 * bri)}px rgba(${r},${g},${b},${(0.35 * bri).toFixed(2)})`,
    };
  }

  if (currentCustomColor?.type === 'cct') {
    const rgb = cctToRgb(currentCustomColor.kelvin);
    const [r, g, b] = rgb.slice(4, -1).split(',').map(Number);
    return {
      borderColor: `rgba(${r},${g},${b},${(0.70 * bri).toFixed(2)})`,
      glow: `inset 0 0 0 1px rgba(${r},${g},${b},${(0.8 * bri).toFixed(2)}), 0 0 ${Math.round(10 * bri)}px rgba(${r},${g},${b},${(0.35 * bri).toFixed(2)})`,
    };
  }

  return { borderColor: FALLBACK_COLOR, glow: '' };
}

function _cssColorsWithOpacity(value, opacity) {
  const alpha = Math.max(0, Math.min(1, opacity)).toFixed(2);
  return value
    .replace(/#([0-9a-f]{6})/gi, (_, h) =>
      `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`)
    .replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/gi, `rgba($1,$2,$3,${alpha})`)
    .replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/gi, `rgba($1,$2,$3,${alpha})`);
}

function updateBulbCard(s) {
  const card     = document.getElementById('bulbCard');
  const statusEl = document.getElementById('bulbStatus');
  const modeEl   = document.getElementById('bulbMode');
  const detailEl = document.getElementById('bulbDetail');
  const toggleBtn = document.getElementById('toggleBtn');
  const toggleBtnBrand = document.getElementById('toggleBtnBrand');

  if (s.on !== true && s.on !== false) {
    statusEl.textContent = 'Disconnected';
    modeEl.textContent = '—';
    detailEl.textContent = '';
    card.style.removeProperty('--sg');
    card.style.removeProperty('--sg-dim');
    card.style.removeProperty('--glow-alpha');
    card.style.removeProperty('--inner-alpha');

    card.classList.remove('lit');
    toggleBtn.classList.remove('on');
    toggleBtnBrand.classList.remove('on');
    return;
  }

  statusEl.textContent = s.on ? 'On' : 'Off';
  toggleBtn.classList.toggle('on', s.on === true);
  toggleBtnBrand.classList.toggle('on', s.on === true);

  const briRaw = s.on ? Math.max(0, Math.min(1, (s.brightness ?? 100) / 100)) : 0;
  const bri = briRaw > 0 ? 0.5 + briRaw * 0.5 : 0;

  if (bri === 0) {
    card.style.removeProperty('--sg');
    card.style.removeProperty('--sg-dim');
    card.style.removeProperty('--glow-alpha');
    card.style.removeProperty('--inner-alpha');

    card.classList.remove('lit');
    modeEl.textContent = modeTextForState(s);
    detailEl.textContent = '';
    return;
  }

  const { borderColor } = _bulbCardBorderForState(s, bri);
  const { borderColor: borderColorDim } = _bulbCardBorderForState(s, bri * 0.4);
  const toGradient = c => c.startsWith('linear-gradient') ? c : `linear-gradient(${c},${c})`;

  modeEl.textContent = modeTextForState(s);
  detailEl.textContent = '';
  card.style.setProperty('--sg', toGradient(borderColor));
  card.style.setProperty('--sg-dim', toGradient(borderColorDim));
  card.style.setProperty('--glow-alpha', (0.12 + 0.38 * bri).toFixed(2));
  card.style.setProperty('--inner-alpha', (0.92 - 0.16 * bri).toFixed(2));
  card.classList.toggle('lit', s.on === true);

  const live = document.getElementById('a11yLive');
  if (live) {
    const prev = live.dataset.lastAnnounced;
    const msg = `${s.on ? 'On' : 'Off'} — ${modeTextForState(s)}`;
    if (msg !== prev) { live.textContent = msg; live.dataset.lastAnnounced = msg; }
  }
}

function modeTextForState(s) {
  const display = s.modeDisplay;
  if (s.musicMode) return `Music: ${display?.kind === 'music' ? display.label : (MUSIC_NAMES[s.musicPreset] || `Preset ${s.musicPreset}`)}`;
  if (s.sceneCode && s.sceneCode > 0) return `Scene: ${display?.kind === 'scene' ? display.label : sceneDisplayName(s.sceneCode)}`;
  if (display?.kind === 'rgb') return `Color: ${display.label}`;
  if (display?.kind === 'cct') return `White: ${display.label}`;
  if (currentCustomColor?.type === 'rgb') return `Color: ${rgbToDisplayHex(currentCustomColor.r, currentCustomColor.g, currentCustomColor.b)}`;
  if (currentCustomColor?.type === 'cct') return `White: ${currentCustomColor.kelvin}K`;
  return 'Custom';
}

const CCT_MIN_KELVIN = 2700;
const CCT_MAX_KELVIN = 6500;
const CCT_WARM_G = 174;
const CCT_COOL_G = 255;
const CCT_WARM_B = 84;
const CCT_COOL_B = 255;

function cctToRgb(kelvin) {
  const t = Math.max(0, Math.min(1, (kelvin - CCT_MIN_KELVIN) / (CCT_MAX_KELVIN - CCT_MIN_KELVIN)));
  const g = Math.round(CCT_WARM_G + t * (CCT_COOL_G - CCT_WARM_G));
  const b = Math.round(CCT_WARM_B + t * (CCT_COOL_B - CCT_WARM_B));
  return `rgb(255,${g},${b})`;
}

function renderPresets(s) {
  const cr = document.getElementById('colourPresetRow');
  window.renderColourPresetWheelMarkers?.(s.colourPresetList || []);
  window.renderCctPresetSliderMarkers?.(s.colourPresetList || []);

  if (s.colourPresetList) {
    const key = JSON.stringify(s.colourPresetList);
    if (cr.dataset.renderedKey === key) return;
    cr.dataset.renderedKey = key;

    cr.innerHTML = '';
    if (!s.colourPresetList.length) {
      cr.textContent = '—';
    } else {
      for (const [index, c] of s.colourPresetList.entries()) {
        const item  = document.createElement('div');
        item.className = 'swatch-item';
        item.dataset.presetIndex = index;
        const dot   = document.createElement('div');
        dot.className = 'swatch-dot';
        const label = document.createElement('div');
        label.className = 'swatch-label';
        if (c.type === 0x01) {
          const k = (c.b1 << 8) | c.b2;
          dot.style.background = cctToRgb(k);
          dot.style.setProperty('--swatch-color', cctToRgb(k));
          dot.title = `${k} K`;
          label.textContent = `${k}K`;
        } else {
          const rgb = `rgb(${c.b1},${c.b2},${c.b3})`;
          dot.style.background = rgb;
          dot.style.setProperty('--swatch-color', rgb);
          const h = [c.b1, c.b2, c.b3].map(v => v.toString(16).padStart(2, '0')).join('');
          dot.title = `#${h}`;
          label.textContent = `#${h}`;
        }
        const dotWrap = document.createElement('div');
        dotWrap.className = 'swatch-dot-wrap';
        dotWrap.appendChild(dot);
        item.append(dotWrap, label);
        cr.appendChild(item);
      }
    }
  }

}

function openFw() {
  const paired = bleDevice ? findPairedDevice(bleDevice) : null;
  const fwPairedEl = document.getElementById('fwPaired');
  const forgetBtn  = document.getElementById('forgetPairBtn');
  if (paired) {
    const d = new Date(paired.pairedAt);
    fwPairedEl.textContent = `Yes · ${d.toLocaleDateString()}`;
    forgetBtn.disabled = false;
  } else {
    fwPairedEl.textContent = 'No';
    forgetBtn.disabled = true;
  }
  openModal('fwOverlay');
}

function forgetPairing() {
  if (!bleDevice) return;
  forgetPairedDevice(bleDevice);
  document.getElementById('fwPaired').textContent = 'No';
  document.getElementById('forgetPairBtn').disabled = true;
  log('info', `Pairing forgotten for ${bleDevice.name}`);
}

function closeFw() { closeModal('fwOverlay'); }
function closeFwOnOuter(e) { if (e.target === document.getElementById('fwOverlay')) closeFw(); }

function populateTz() {
  const sel = document.getElementById('setupTz');
  const browserOff = -new Date().getTimezoneOffset();
  const minuteSteps = [0, 30];
  for (let h = -12; h <= 14; h++) {
    const steps = h === 5 || h === -5 || h === 12 ? [0, 30, 45] : minuteSteps;
    for (const m of steps) {
      if (h === 14 && m > 0) break;
      const total = h * 60 + m;
      const opt = document.createElement('option');
      const sign = total >= 0 ? '+' : '-';
      const hh = String(Math.abs(h)).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      opt.value = `${sign}${hh}:${mm}`;
      opt.textContent = `UTC${sign}${hh}:${mm}`;
      if (total === browserOff) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

function openSetup() {
  document.getElementById('setupSsid').value = '';
  document.getElementById('setupPwd').value = '';
  document.getElementById('setupStatus').textContent = '';
  document.getElementById('setupStatus').className = 'modal-status';
  document.getElementById('setupSendBtn').disabled = false;
  const sel = document.getElementById('setupTz');
  if (!sel.options.length) populateTz();
  openModal('setupOverlay');
  requestAnimationFrame(() => document.getElementById('setupSsid')?.focus());
}

function closeSetup() {
  closeModal('setupOverlay');
}

function closeSetupOnOuter(e) {
  if (e.target === document.getElementById('setupOverlay')) closeSetup();
}

async function sendWifiSetup() {
  const ssid     = document.getElementById('setupSsid').value.trim();
  const pwd      = document.getElementById('setupPwd').value;
  const tzStr    = document.getElementById('setupTz').value;
  const statusEl = document.getElementById('setupStatus');
  const sendBtn  = document.getElementById('setupSendBtn');

  if (sendBtn.disabled) return;
  if (!ssid) { statusEl.textContent = 'SSID is required'; statusEl.className = 'modal-status err'; return; }

  sendBtn.disabled = true;
  statusEl.textContent = 'Sending…';
  statusEl.className = 'modal-status';

  const neg = tzStr.startsWith('-');
  const parts = tzStr.replace(/[+-]/, '').split(':').map(Number);
  let tzMinutes = parts[0] * 60 + (parts[1] || 0);
  if (neg) tzMinutes = -tzMinutes;
  const tzHours   = Math.trunc(tzMinutes / 60);
  const tzRemMins = tzMinutes - tzHours * 60;

  const enc = new TextEncoder();
  const ssidBytes = enc.encode(ssid);
  const pwdBytes  = pwd ? enc.encode(pwd) : new Uint8Array(0);
  const apiUrl    = enc.encode('https://device.govee.com');

  const payload = new Uint8Array(1 + ssidBytes.length + 1 + pwdBytes.length + 4 + 2 + apiUrl.length + 1);
  let off = 0;
  payload[off++] = ssidBytes.length;
  payload.set(ssidBytes, off); off += ssidBytes.length;
  payload[off++] = pwdBytes.length;
  payload.set(pwdBytes, off); off += pwdBytes.length;
  payload[off++] = 0x00;
  payload[off++] = tzHours & 0xff;
  payload[off++] = 0x00;
  payload[off++] = tzRemMins & 0xff;
  payload[off++] = 0x00;
  payload[off++] = apiUrl.length;
  payload.set(apiUrl, off); off += apiUrl.length;
  payload[off++] = 0x00;

  const dataLen = payload.length;
  const nPkts   = Math.ceil(dataLen / 16);

  try {
    await runBleTransaction('WiFi setup', async () => {
      await send(makePacket([0xa1, 0x11, 0x00, nPkts]));
      for (let i = 0; i < nPkts; i++) {
        const chunk = payload.slice(i * 16, (i + 1) * 16);
        const pkt = new Uint8Array(20);
        pkt[0] = 0xa1; pkt[1] = 0x11; pkt[2] = 0x01 + i;
        pkt.set(chunk, 3);
        pkt[19] = xorCk(pkt.slice(0, 19));
        await send(pkt);
      }
      await send(makePacket([0xa1, 0x11, 0xff]));

      statusEl.textContent = 'Waiting for device…';
      const ack = await recvMatch(expectOpcode(0xa1, 0x11, 0x00), 10000);
      if (ack[0] === 0xa1 && ack[1] === 0x11 && ack[2] === 0x00) {
        statusEl.textContent = `Joining "${ssid}"… (up to 30 s)`;
        const result = await recvMatch(expectOpcode(0xee, 0x11), 30000);
        if (result[0] === 0xee && result[1] === 0x11) {
          if (result[2] === 0x00) {
            statusEl.textContent = `WiFi provisioned — device is joining "${ssid}"`;
            statusEl.className = 'modal-status ok';
          } else {
            statusEl.textContent = `Device failed to join "${ssid}" (status 0x${result[2].toString(16)})`;
            statusEl.className = 'modal-status err';
          }
        } else {
          statusEl.textContent = `Unexpected result: ${hex(result.slice(0, 3))}`;
          statusEl.className = 'modal-status err';
        }
      } else {
        statusEl.textContent = `Expected a1 11 00 ack, got ${hex(ack.slice(0, 3))}`;
        statusEl.className = 'modal-status err';
      }
    });
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.className = 'modal-status err';
    log('err', `WiFi setup: ${e.message}`);
  }
  sendBtn.disabled = false;
}
