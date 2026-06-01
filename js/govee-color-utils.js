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
