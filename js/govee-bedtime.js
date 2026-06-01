// govee-bedtime.js — Bedtime Switch protocol and UI

async function queryBedtime() {
  return (await queryBedtimeState()).bedtime ?? null;
}

async function setBedtime(enabled, startH, startM, endH, endM, sensitivity, brightness) {
  if (enabled) {
    await send(makePacket([
      0x33, 0x30, 0x01,
      startH & 0xff, startM & 0xff,
      endH & 0xff, endM & 0xff,
      sensitivity & 0xff, brightness & 0xff,
    ]));
  } else {
    await send(makePacket([0x33, 0x30, 0x00]));
  }
}

function pad2(n) { return String(n).padStart(2, '0'); }

function bedtimeTimeStr(h, m) { return `${pad2(h)}:${pad2(m)}`; }

function openBedtime() {
  const bt = currentState?.bedtime;
  document.getElementById('bedtimeEnabled').checked = bt?.enabled ?? false;
  document.getElementById('bedtimeStart').value = bt ? bedtimeTimeStr(bt.startHour, bt.startMinute) : '23:00';
  document.getElementById('bedtimeEnd').value   = bt ? bedtimeTimeStr(bt.endHour, bt.endMinute) : '07:00';
  document.getElementById('bedtimeSensitivity').value = bt?.sensitivity ?? 70;
  document.getElementById('bedtimeBrightness').value  = bt?.brightness ?? 20;
  document.getElementById('bedtimeSensVal').textContent = document.getElementById('bedtimeSensitivity').value;
  document.getElementById('bedtimeBriVal').textContent  = document.getElementById('bedtimeBrightness').value;
  document.getElementById('bedtimeStatus').textContent = '';
  document.getElementById('bedtimeStatus').className = 'modal-status';
  document.getElementById('bedtimeSaveBtn').disabled = false;
  openModal('bedtimeOverlay');
  requestAnimationFrame(() => document.getElementById('bedtimeStart')?.focus());
}

function closeBedtime() {
  closeModal('bedtimeOverlay');
}

function closeBedtimeOnOuter(e) {
  if (e.target === document.getElementById('bedtimeOverlay')) closeBedtime();
}

async function saveBedtime() {
  const statusEl = document.getElementById('bedtimeStatus');
  const saveBtn  = document.getElementById('bedtimeSaveBtn');
  const enabled   = document.getElementById('bedtimeEnabled').checked;
  const startStr  = document.getElementById('bedtimeStart').value;
  const endStr    = document.getElementById('bedtimeEnd').value;
  const sensitivity = parseInt(document.getElementById('bedtimeSensitivity').value, 10);
  const brightness  = parseInt(document.getElementById('bedtimeBrightness').value, 10);

  const parseTime = (s) => {
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10)];
  };

  const start = parseTime(startStr);
  const end   = parseTime(endStr);
  if (saveBtn.disabled) return;
  if (!start || !end) {
    statusEl.textContent = 'Invalid time format (use HH:MM)';
    statusEl.className = 'modal-status err';
    return;
  }

  saveBtn.disabled = true;
  statusEl.textContent = 'Sending…';
  statusEl.className = 'modal-status';

  try {
    await runBleTransaction('Bedtime', async () => {
      await setBedtime(enabled, start[0], start[1], end[0], end[1], sensitivity, brightness);
      currentState = mergeState(currentState, {
        bedtime: { enabled, startHour: start[0], startMinute: start[1], endHour: end[0], endMinute: end[1], sensitivity, brightness },
      });
      updateUI(currentState);
      await new Promise(r => setTimeout(r, 200));
      currentState = mergeState(currentState, await queryBedtimeState());
    });
    updateUI(currentState);
    statusEl.textContent = enabled
      ? `Bedtime enabled: ${bedtimeTimeStr(start[0], start[1])}–${bedtimeTimeStr(end[0], end[1])}`
      : 'Bedtime disabled';
    statusEl.className = 'modal-status ok';
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.className = 'modal-status err';
    log('err', `Bedtime: ${e.message}`);
  }
  saveBtn.disabled = false;
}
