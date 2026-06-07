// govee-color-utils.js — Shared colour conversion utilities

function hsv2rgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r, g, b;
  if      (h < 60)  [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const df = mx - mn;
  let h = 0;
  if (df) {
    if      (mx === r) h = ((g - b) / df) % 6;
    else if (mx === g) h = (b - r) / df + 2;
    else               h = (r - g) / df + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? df / mx : 0, mx];
}

const CAL_PREF_KEY = 'govee-calibration-enabled';
const CAL_SETTINGS_KEY = 'govee-calibration-settings';

const DEFAULT_CALIBRATION_SETTINGS = {
  enabled: true,
  features: {
    builtInScenes: true,
    customSimpleScenes: true,
    customAdvancedScenes: true,
    solidColours: true,
  },
  correction: {
    redScale: 0.95,
    blueWhiteCut: 0.5,
  },
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function loadCalibrationSettings() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(CAL_SETTINGS_KEY) || 'null');
  } catch (e) {
    stored = null;
  }

  const legacyEnabled = localStorage.getItem(CAL_PREF_KEY);
  const enabled = stored?.enabled != null
    ? stored.enabled !== false
    : legacyEnabled !== 'false';

  return {
    enabled,
    features: {
      ...DEFAULT_CALIBRATION_SETTINGS.features,
      ...(stored?.features || {}),
    },
    correction: {
      redScale: clampNumber(
        stored?.correction?.redScale,
        0,
        1.5,
        DEFAULT_CALIBRATION_SETTINGS.correction.redScale
      ),
      blueWhiteCut: clampNumber(
        stored?.correction?.blueWhiteCut,
        0,
        1,
        DEFAULT_CALIBRATION_SETTINGS.correction.blueWhiteCut
      ),
    },
  };
}

function saveCalibrationSettings(settings) {
  const normalized = {
    enabled: settings?.enabled !== false,
    features: {
      ...DEFAULT_CALIBRATION_SETTINGS.features,
      ...(settings?.features || {}),
    },
    correction: {
      redScale: clampNumber(
        settings?.correction?.redScale,
        0,
        1.5,
        DEFAULT_CALIBRATION_SETTINGS.correction.redScale
      ),
      blueWhiteCut: clampNumber(
        settings?.correction?.blueWhiteCut,
        0,
        1,
        DEFAULT_CALIBRATION_SETTINGS.correction.blueWhiteCut
      ),
    },
  };
  localStorage.setItem(CAL_SETTINGS_KEY, JSON.stringify(normalized));
  localStorage.setItem(CAL_PREF_KEY, normalized.enabled ? 'true' : 'false');
  return normalized;
}

function isCalibrationEnabled() {
  return loadCalibrationSettings().enabled;
}

function setCalibrationEnabled(on) {
  const settings = loadCalibrationSettings();
  settings.enabled = !!on;
  saveCalibrationSettings(settings);
}

function isCalibrationFeatureEnabled(feature) {
  const settings = loadCalibrationSettings();
  if (!settings.enabled) return false;
  if (!feature) return true;
  return settings.features[feature] !== false;
}

function setCalibrationFeatureEnabled(feature, on) {
  const settings = loadCalibrationSettings();
  settings.features[feature] = !!on;
  saveCalibrationSettings(settings);
}

function setCalibrationCorrection(patch) {
  const settings = loadCalibrationSettings();
  settings.correction = { ...settings.correction, ...(patch || {}) };
  saveCalibrationSettings(settings);
}

// White point observation: (255,255,255) → (253,255,146)
// Blue gain is non-linear: full intensity for saturated blue, cut for white.
function applyCalibration(r, g, b, feature = null) {
  if (!isCalibrationFeatureEnabled(feature)) return [r, g, b];
  const { correction } = loadCalibrationSettings();
  const whiteness = Math.min(r, g) / 255;
  const blueGain = 1.0 - correction.blueWhiteCut * whiteness;
  return [
    Math.round(r * correction.redScale),
    g,
    Math.max(0, Math.min(255, Math.round(b * blueGain))),
  ];
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

// Populate a preset <select> and sync its delete button.
// activePresetName: current value (string|null), returned (possibly nulled) as new active name.
function syncPresetSelect(selectId, deleteBtnId, names, activePresetName, onClearedCb) {
  const select = document.getElementById(selectId);
  const deleteBtn = document.getElementById(deleteBtnId);
  if (!select) return activePresetName;

  const noPresets = !names.length;
  let active = activePresetName;

  if (active && !names.includes(active)) {
    active = null;
    onClearedCb?.();
  }

  select.innerHTML = '';
  if (noPresets) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No saved presets';
    select.appendChild(opt);
  } else {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'New...';
    select.appendChild(empty);

    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  }
  select.disabled = noPresets;

  select.value = (active && names.includes(active)) ? active : '';
  if (deleteBtn) deleteBtn.disabled = !active;

  return active;
}
