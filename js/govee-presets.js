// govee-presets.js — Preset slot management (write/delete/reorder)

// ── Protocol encoding ────────────────────────────────────────────────────────

function encodeColourPresetEntry(c) {
  if (c.type === 0x01) {
    return [0x01, c.b1, c.b2, 0x00];
  } else {
    return [0x00, c.b1, c.b2, c.b3];
  }
}

function encodeScenePresetEntry(code) {
  const lo = code & 0xff;
  const hi = (code >> 8) & 0xff;
  const param = typeof SCENE_PARAMS !== 'undefined' ? SCENE_PARAMS[code] : null;
  if (param) {
    const raw = Array.from(atob(param), c => c.charCodeAt(0));
    if (raw[0] === 0x41) {
      const payload = raw.slice(1);
      return [lo, hi, 0x00, 0x00, 0x05, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload];
    }
  }
  return [lo, hi, 0x00, 0xff];
}

async function writeColourPresets(entries) {
  const payload = [0x0b, 0x02, entries.length];
  for (const e of entries) {
    payload.push(...encodeColourPresetEntry(e));
  }
  await sendPackets(buildA3MultiPacket(payload));
  await recvMatch(expectOpcode(0xa3, 0x0b), 10000);
}

async function writeScenePresets(codes) {
  const payload = [0x0b, 0x01];
  for (const code of codes) {
    payload.push(...encodeScenePresetEntry(code));
  }
  await sendPackets(buildA3MultiPacket(payload));
  await recvMatch(expectOpcode(0xa3, 0x0b), 10000);
}

async function deleteScenePreset(code) {
  const lo = code & 0xff;
  const hi = (code >> 8) & 0xff;
  await send(makePacket([0x33, 0x77, lo, hi]));
}

async function reorderScenePresets(codes) {
  const payload = [0x33, 0x78, codes.length];
  for (const code of codes) {
    payload.push(code & 0xff, (code >> 8) & 0xff);
  }
  await send(makePacket(payload));
}

// ── Colour preset editing ────────────────────────────────────────────────────

let editingColourSlot = -1;
let _dragColourSlot = null;
let _dragColourOverSlot = null;
const COLOUR_PRESET_MAX = 8;
let colourPresetWheelApi = null;
let colourPresetEditMode = false;

function selectedColourPresetEntry() {
  if (window.activeColourMode?.() === 'color') {
    const hex = document.getElementById('colorPicker')?.value || '#ffffff';
    return {
      type: 0x00,
      b1: parseInt(hex.slice(1, 3), 16),
      b2: parseInt(hex.slice(3, 5), 16),
      b3: parseInt(hex.slice(5, 7), 16),
    };
  }

  const kelvin = parseInt(document.getElementById('cctSlider')?.value || '4000', 10);
  return { type: 0x01, b1: (kelvin >> 8) & 0xff, b2: kelvin & 0xff, b3: 0x00 };
}

async function persistColourPresetList(entries, label = 'Colour preset') {
  await runBleTransaction(label, async () => {
    await writeColourPresets(entries);
    currentState = mergeState(currentState, { colourPresetList: entries, colourPresets: entries.length });
    updateUI(currentState);
    await new Promise(r => setTimeout(r, 200));
    currentState = mergeState(currentState, await queryPresetState());
  });
  updateUI(currentState);
}

async function updateColourPresetSlot(slot, entry) {
  if (!currentState?.colourPresetList || slot < 0 || slot >= currentState.colourPresetList.length) return;
  const entries = [...currentState.colourPresetList];
  entries[slot] = entry;

  try {
    await persistColourPresetList(entries, 'Colour preset');
  } catch (e) {
    log('err', `Colour preset: ${e.message}`);
  }
}

async function activateColourPresetSlot(slot) {
  const entry = currentState?.colourPresetList?.[slot];
  if (!entry || !isConnected()) return;

  try {
    await runBleTransaction('Colour preset', async () => {
      if (entry.type === 0x01) {
        const kelvin = (entry.b1 << 8) | entry.b2;
        await setCCT(kelvin);
        currentCustomColor = { type: 'cct', kelvin };
        assumeLightOn({ musicMode: false, sceneCode: 0, cctKelvin: kelvin, modeDisplay: { kind: 'cct', label: `${kelvin}K` } });
      } else {
        await setColour(entry.b1, entry.b2, entry.b3);
        currentCustomColor = { type: 'rgb', r: entry.b1, g: entry.b2, b: entry.b3 };
        assumeLightOn({
          musicMode: false,
          sceneCode: 0,
          colorHex: rgbToDisplayHex(entry.b1, entry.b2, entry.b3),
          modeDisplay: { kind: 'rgb', label: rgbToDisplayHex(entry.b1, entry.b2, entry.b3) },
        });
      }
      await new Promise(r => setTimeout(r, 150));
      currentState = mergeState(currentState, await queryModeState());
    });
    updateUI(currentState);
  } catch (e) {
    log('err', `Colour preset: ${e.message}`);
  }
}

async function addSelectedColourPreset() {
  const entries = [...(currentState?.colourPresetList || [])];
  if (entries.length >= COLOUR_PRESET_MAX) return;
  entries.push(selectedColourPresetEntry());

  try {
    await persistColourPresetList(entries, 'Add colour preset');
  } catch (e) {
    log('err', `Add colour preset: ${e.message}`);
  }
}

async function deleteColourPresetSlot(slot) {
  if (!currentState?.colourPresetList || slot < 0 || slot >= currentState.colourPresetList.length) return;
  const entries = currentState.colourPresetList.filter((_, i) => i !== slot);

  try {
    await persistColourPresetList(entries, 'Delete colour preset');
  } catch (e) {
    log('err', `Delete colour preset: ${e.message}`);
  }
}

async function reorderColourPresetSlots(from, to) {
  if (!currentState?.colourPresetList || from === to) return;
  if (from < 0 || to < 0 || from >= currentState.colourPresetList.length || to >= currentState.colourPresetList.length) return;

  const entries = [...currentState.colourPresetList];
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);

  try {
    await persistColourPresetList(entries, 'Reorder colour preset');
  } catch (e) {
    log('err', `Reorder colour preset: ${e.message}`);
  }
}

function openColourPresetEditor(slot) {
  editingColourSlot = slot;
  const preset = currentState?.colourPresetList?.[slot];
  const fallback = preset || selectedColourPresetEntry();

  if (fallback?.type === 0x01) {
    setColourPresetEditorMode('white');
    setColourPresetCctValue((fallback.b1 << 8) | fallback.b2);
  } else {
    const hex = '#' + [fallback?.b1 || 0, fallback?.b2 || 0, fallback?.b3 || 0]
      .map(v => v.toString(16).padStart(2, '0')).join('');
    setColourPresetEditorMode('color');
    colourPresetWheelApi?.setHex(hex);
  }

  openModal('colourPresetModal');
  requestAnimationFrame(() => colourPresetWheelApi?.sync());
}

function openNewColourPresetEditor() {
  const entries = currentState?.colourPresetList || [];
  if (entries.length >= COLOUR_PRESET_MAX) return;
  openColourPresetEditor(entries.length);
}

function closeColourPresetEditor() {
  closeModal('colourPresetModal');
  editingColourSlot = -1;
}

function onColourPresetTypeChange() {
  setColourPresetEditorMode(document.querySelector('#colourPresetSeg button.active')?.dataset.m || 'white');
}

function setColourPresetCctValue(kelvin) {
  const slider = document.getElementById('colourPresetCct');
  const val = document.getElementById('colourPresetCctVal');
  if (!slider || !val) return;
  slider.value = kelvin;
  val.textContent = `${kelvin}K`;
}

function setColourPresetEditorMode(mode) {
  const normalized = mode === 'color' ? 'color' : 'white';
  setSegmentValue('colourPresetSeg', 'm', normalized);
  document.querySelectorAll('#colourPresetModal .preset-modepane').forEach(pane => {
    pane.classList.toggle('active', pane.dataset.m === normalized);
  });
  if (normalized === 'color') requestAnimationFrame(() => colourPresetWheelApi?.sync());
}

function initColourPresetEditorControls() {
  bindSegmentValue('colourPresetSeg', 'm', setColourPresetEditorMode);

  const cctSlider = document.getElementById('colourPresetCct');
  cctSlider?.addEventListener('input', () => setColourPresetCctValue(parseInt(cctSlider.value, 10)));

  colourPresetWheelApi = initColourPresetWheel();
  window.addEventListener('resize', () => requestAnimationFrame(() => colourPresetWheelApi?.sync()));
}

function initColourPresetWheel() {
  const wheel = document.getElementById('colourPresetWheel');
  const handle = document.getElementById('colourPresetHandle');
  const picker = document.getElementById('colourPresetRgb');
  const swatch = document.getElementById('colourPresetSwatch');
  const hexEl = document.getElementById('colourPresetHex');
  const rgbEl = document.getElementById('colourPresetRgbText');
  if (!wheel || !handle || !picker || !swatch || !hexEl || !rgbEl) return null;

  const ctx = wheel.getContext('2d');
  const W = wheel.width;
  const R = W / 2;

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

  function applyHex(hex) {
    const normalized = hex.toUpperCase();
    handle.style.background = normalized;
    swatch.style.background = normalized;
    picker.value = normalized.toLowerCase();
    hexEl.textContent = normalized;
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    rgbEl.textContent = `${r}, ${g}, ${b}`;
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
    const [r, g, b] = hsv2rgb(hue, sat, 1);
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    const sc = rect.width / W;
    const rad = Math.min(dist, R);
    return { ang, rad, sc, hex };
  }

  function pickAt(clientX, clientY) {
    const pick = selectionFromPointer(clientX, clientY);
    if (!pick) return;
    handle.style.left = `${(R + pick.rad * Math.cos(pick.ang)) * pick.sc}px`;
    handle.style.top = `${(R + pick.rad * Math.sin(pick.ang)) * pick.sc}px`;
    applyHex(pick.hex);
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
    const [h, s] = rgb2hsv(r, g, b);
    placeHandle(h, s);
    applyHex(hex);
  }

  drawWheel();
  requestAnimationFrame(sync);
  return { setHex, sync };
}

async function saveColourPreset() {
  if (editingColourSlot < 0 || !currentState?.colourPresetList) return;

  const type = document.querySelector('#colourPresetSeg button.active')?.dataset.m || 'white';
  let entry;

  if (type === 'color') {
    const hex = document.getElementById('colourPresetRgb').value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    entry = { type: 0x00, b1: r, b2: g, b3: b };
  } else {
    const k = parseInt(document.getElementById('colourPresetCct').value, 10);
    entry = { type: 0x01, b1: (k >> 8) & 0xff, b2: k & 0xff, b3: 0x00 };
  }

  const entries = [...currentState.colourPresetList];
  if (editingColourSlot >= entries.length) entries.push(entry);
  else entries[editingColourSlot] = entry;

  try {
    await persistColourPresetList(entries, 'Colour preset');
    closeColourPresetEditor();
  } catch (e) {
    log('err', `Colour preset: ${e.message}`);
  }
}

document.addEventListener('DOMContentLoaded', initColourPresetEditorControls);

// ── Scene preset editing ─────────────────────────────────────────────────────

let editingSceneSlot = -1;

function openScenePresetEditor(slot) {
  editingSceneSlot = slot;
  const preset = currentState?.scenePresetList?.[slot];
  const select = document.getElementById('scenePresetSelect');

  select.innerHTML = '';
  const allScenes = Object.entries(SCENE_NAMES)
    .filter(([k]) => !isNaN(parseInt(k)))
    .map(([code, name]) => ({ code: parseInt(code), name }))
    .sort((a, b) => a.code - b.code);

  for (const s of allScenes) {
    const opt = document.createElement('option');
    opt.value = s.code;
    opt.textContent = `${s.code}: ${s.name}`;
    if (preset && s.code === preset) opt.selected = true;
    select.appendChild(opt);
  }

  openModal('scenePresetModal');
}

function closeScenePresetEditor() {
  closeModal('scenePresetModal');
  editingSceneSlot = -1;
}

async function saveScenePreset() {
  if (editingSceneSlot < 0 || !currentState?.scenePresetList) return;

  const code = parseInt(document.getElementById('scenePresetSelect').value, 10);
  const codes = [...currentState.scenePresetList];
  codes[editingSceneSlot] = code;

  try {
    await runBleTransaction('Scene preset', async () => {
      await writeScenePresets(codes);
      currentState = mergeState(currentState, { scenePresetList: codes, scenePresets: codes.length });
      updateUI(currentState);
      await new Promise(r => setTimeout(r, 200));
      currentState = mergeState(currentState, await queryPresetState());
    });
    updateUI(currentState);
    closeScenePresetEditor();
  } catch (e) {
    log('err', `Scene preset: ${e.message}`);
  }
}

async function deleteScenePresetSlot(slot) {
  if (!currentState?.scenePresetList) return;
  const code = currentState.scenePresetList[slot];
  if (!code) return;

  try {
    await runBleTransaction('Delete scene preset', async () => {
      await deleteScenePreset(code);
      currentState = mergeState(currentState, {
        scenePresetList: currentState.scenePresetList.filter((_, i) => i !== slot),
      });
      updateUI(currentState);
      await new Promise(r => setTimeout(r, 200));
      currentState = mergeState(currentState, await queryPresetState());
    });
    updateUI(currentState);
  } catch (e) {
    log('err', `Delete scene preset: ${e.message}`);
  }
}

async function moveScenePreset(slot, dir) {
  if (!currentState?.scenePresetList) return;
  const codes = [...currentState.scenePresetList];
  const newSlot = slot + dir;
  if (newSlot < 0 || newSlot >= codes.length) return;

  [codes[slot], codes[newSlot]] = [codes[newSlot], codes[slot]];

  try {
    await runBleTransaction('Reorder scene preset', async () => {
      await reorderScenePresets(codes);
      currentState = mergeState(currentState, { scenePresetList: codes });
      updateUI(currentState);
      await new Promise(r => setTimeout(r, 200));
      currentState = mergeState(currentState, await queryPresetState());
    });
    updateUI(currentState);
  } catch (e) {
    log('err', `Reorder scene preset: ${e.message}`);
  }
}

// ── Scene favourite toggle ───────────────────────────────────────────────────

async function toggleSceneFavourite(code) {
  if (!isConnected()) return;
  const list = [...(currentState?.scenePresetList || [])];
  const idx = list.indexOf(code);

  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    if (list.length >= 6) {
      log('info', 'Scene presets full (max 6) — remove one first');
      return;
    }
    list.push(code);
  }

  try {
    await runBleTransaction('Favourite scene', async () => {
      if (idx >= 0) {
        await deleteScenePreset(code);
      } else {
        await writeScenePresets([code]);
      }
      currentState = mergeState(currentState, { scenePresetList: list, scenePresets: list.length });
      updateUI(currentState);
      await new Promise(r => setTimeout(r, 200));
      currentState = mergeState(currentState, await queryPresetState());
    });
    updateUI(currentState);
  } catch (e) {
    log('err', `Favourite scene: ${e.message}`);
  }
}

// ── Scene preset grid ────────────────────────────────────────────────────────

let _dragSrcSlot = null;
let _dragSceneOverSlot = null;

function clearScenePresetDragOver(container) {
  _dragSceneOverSlot = null;
  container.querySelectorAll('.preset-scene-badge').forEach(c => c.classList.remove('drag-over'));
}

function renderScenePresetGrid(s) {
  const container = document.getElementById('scenePresetRow');
  if (!s?.scenePresetList) return;

  container.innerHTML = '';

  if (!s.scenePresetList.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'color:var(--muted);font-size:.85rem';
    empty.textContent = '—';
    container.appendChild(empty);
    return;
  }

  s.scenePresetList.forEach((code, i) => {
    const name = SCENE_NAMES[code] ?? `Scene ${code}`;

    const badge = document.createElement('button');
    badge.className = 'scene-badge preset-scene-badge';
    badge.draggable = true;
    badge.dataset.sceneCode = code;
    badge.title = name;

    applySceneCardStyle(badge, code);

    const inner = document.createElement('div');
    inner.className = 'scene-badge__inner';

    const label = document.createElement('span');
    label.className = 'scene-name';
    label.textContent = name;

    const delBtn = document.createElement('button');
    delBtn.className = 'scene-preset-del-btn';
    delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M19.5 12.572l-.5 .428m-6 6l-1 1l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/><path d="M22 22l-5 -5"/><path d="M17 22l5 -5"/></svg>`;
    delBtn.title = 'Remove from presets';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteScenePresetSlot(i); };

    inner.append(label, delBtn);
    badge.append(inner);

    badge.onclick = async () => {
      if (!isConnected()) return;
      try {
        await runBleTransaction('Scene', async () => {
          if (typeof rememberActiveScene === 'function') {
            rememberActiveScene(String(code), code, name, scenePreviewGradient(code));
          } else if (typeof activeSceneKey !== 'undefined') {
            activeSceneKey = String(code);
          }
          await activateScene(code, SCENE_PARAMS[code]);
          assumeLightOn({ musicMode: false, sceneCode: code, modeDisplay: { kind: 'scene', label: name } });
          await new Promise(r => setTimeout(r, 200));
          currentState = mergeState(currentState, await queryModeState());
        });
        updateUI(currentState);
      } catch (e) {
        log('err', `Scene: ${e.message}`);
      }
    };

    badge.addEventListener('dragstart', e => {
      _dragSrcSlot = i;
      badge.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    badge.addEventListener('dragend', () => {
      badge.classList.remove('dragging');
      clearScenePresetDragOver(container);
    });
    badge.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (_dragSrcSlot === i || _dragSceneOverSlot === i) return;
      clearScenePresetDragOver(container);
      _dragSceneOverSlot = i;
      badge.classList.add('drag-over');
    });
    badge.addEventListener('drop', async e => {
      e.preventDefault();
      clearScenePresetDragOver(container);
      const from = _dragSrcSlot;
      _dragSrcSlot = null;
      if (from === null || from === i) return;

      const codes = [...currentState.scenePresetList];
      const [moved] = codes.splice(from, 1);
      codes.splice(i, 0, moved);

      try {
        await runBleTransaction('Reorder scene preset', async () => {
          await reorderScenePresets(codes);
          currentState = mergeState(currentState, { scenePresetList: codes });
          updateUI(currentState);
          await new Promise(r => setTimeout(r, 200));
          currentState = mergeState(currentState, await queryPresetState());
        });
        updateUI(currentState);
      } catch (err) {
        log('err', `Reorder scene preset: ${err.message}`);
      }
    });

    container.appendChild(badge);
  });
}

// ── UI injection ─────────────────────────────────────────────────────────────

function injectPresetUI() {
  const colourRow = document.getElementById('colourPresetRow');
  const editToggle = document.getElementById('colourPresetEditToggle');

  function clearColourPresetDragOver() {
    _dragColourOverSlot = null;
    colourRow.querySelectorAll('.swatch-item').forEach(c => c.classList.remove('drag-over'));
  }

  editToggle?.addEventListener('click', () => {
    colourPresetEditMode = !colourPresetEditMode;
    editToggle.classList.toggle('active', colourPresetEditMode);
    editToggle.setAttribute('aria-pressed', colourPresetEditMode ? 'true' : 'false');
    updateUI(currentState || {});
    const list = currentState?.colourPresetList || [];
    window.renderColourPresetWheelMarkers?.(list);
    window.renderCctPresetSliderMarkers?.(list);
  });

  const origRender = renderPresets;
  renderPresets = function(s) {
    origRender(s);
    if (!Array.isArray(s.colourPresetList)) return;
    const presets = s.colourPresetList || [];
    colourRow.classList.toggle('editing', colourPresetEditMode);
    editToggle?.classList.toggle('active', colourPresetEditMode);
    editToggle?.setAttribute('aria-pressed', colourPresetEditMode ? 'true' : 'false');
    colourRow.querySelectorAll('.colour-preset-add').forEach(item => item.remove());
    colourRow.querySelectorAll('.colour-swatch-del').forEach(btn => btn.remove());

    if (!presets.length) {
      colourRow.innerHTML = '';
      if (!colourPresetEditMode) {
        const empty = document.createElement('span');
        empty.style.cssText = 'color:var(--muted);font-size:.85rem';
        empty.textContent = '—';
        colourRow.appendChild(empty);
      }
    }

    colourRow.querySelectorAll('.swatch-item').forEach((item, i) => {
      item.classList.toggle('draggable', colourPresetEditMode);
      item.draggable = colourPresetEditMode;
      item.onclick = () => {
        if (colourPresetEditMode) openColourPresetEditor(i);
        else activateColourPresetSlot(i);
      };

      if (item.dataset.colourPresetWired !== 'true') {
        item.dataset.colourPresetWired = 'true';
        item.addEventListener('dragstart', e => {
          if (!colourPresetEditMode) {
            e.preventDefault();
            return;
          }
          _dragColourSlot = Number(item.dataset.presetIndex);
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          clearColourPresetDragOver();
          _dragColourSlot = null;
        });
        item.addEventListener('dragover', e => {
          if (!colourPresetEditMode) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const overSlot = Number(item.dataset.presetIndex);
          if (_dragColourSlot === null || _dragColourSlot === overSlot || _dragColourOverSlot === overSlot) return;
          clearColourPresetDragOver();
          _dragColourOverSlot = overSlot;
          item.classList.add('drag-over');
        });
        item.addEventListener('drop', e => {
          if (!colourPresetEditMode) return;
          e.preventDefault();
          clearColourPresetDragOver();
          const from = _dragColourSlot;
          const to = Number(item.dataset.presetIndex);
          _dragColourSlot = null;
          if (from === null || from === to) return;
          reorderColourPresetSlots(from, to);
        });
      }

      const dotWrap = item.querySelector('.swatch-dot-wrap') || item;
      const delBtn = document.createElement('button');
      delBtn.className = 'colour-swatch-del';
      delBtn.textContent = 'X';
      delBtn.title = 'Remove colour preset';
      delBtn.draggable = false;
      delBtn.onclick = e => {
        e.stopPropagation();
        if (!colourPresetEditMode) return;
        deleteColourPresetSlot(i);
      };
      dotWrap.appendChild(delBtn);
    });

    if (colourPresetEditMode && presets.length < COLOUR_PRESET_MAX) {
      const item = document.createElement('div');
      item.className = 'swatch-item colour-preset-add';
      const add = document.createElement('button');
      add.className = 'swatch-add';
      add.textContent = '+';
      add.title = 'New colour preset';
      add.onclick = openNewColourPresetEditor;
      const label = document.createElement('div');
      label.className = 'swatch-label';
      label.textContent = 'New…';
      item.append(add, label);
      colourRow.appendChild(item);
    }
  };
}

document.addEventListener('DOMContentLoaded', injectPresetUI);
window.updateColourPresetSlot = updateColourPresetSlot;
window.activateColourPresetSlot = activateColourPresetSlot;
window.openColourPresetEditor = openColourPresetEditor;
window.isColourPresetEditMode = () => colourPresetEditMode;
window.addSelectedColourPreset = addSelectedColourPreset;
window.deleteColourPresetSlot = deleteColourPresetSlot;
window.reorderColourPresetSlots = reorderColourPresetSlots;
