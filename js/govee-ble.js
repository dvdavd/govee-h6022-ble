// govee-ble.js — BLE connection lifecycle, send/recv, keepalive, shared utilities

const SVC   = '00010203-0405-0607-0809-0a0b0c0d1910';
const CWRT  = '00010203-0405-0607-0809-0a0b0c0d2b11';
const CNTFY = '00010203-0405-0607-0809-0a0b0c0d2b10';

let bleDevice    = null;
let ntfChar      = null;
let wrtChar      = null;
let sessionKey   = null;
let currentState = null;
let busy         = false;
let keepaliveTimer  = null;
let bleQueue        = Promise.resolve();
let bleQueueDepth   = 0;
let bleGeneration   = 0;

const nQueue = [];
const nWait  = [];

function onNotify(evt) {
  const data = new Uint8Array(evt.target.value.buffer);
  if (nWait.length) nWait.shift().resolve(data);
  else nQueue.push(data);
}

function waitNotify(ms = 5000) {
  return new Promise((resolve, reject) => {
    if (nQueue.length) { resolve(nQueue.shift()); return; }
    const t = setTimeout(() => {
      const i = nWait.indexOf(waiter);
      if (i >= 0) nWait.splice(i, 1);
      reject(new Error('Notify timeout'));
    }, ms);
    const waiter = {
      resolve: d => { clearTimeout(t); resolve(d); },
      reject:  e => { clearTimeout(t); reject(e); },
    };
    nWait.push(waiter);
  });
}

function hex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function log(type, msg) {
  const el   = document.getElementById('log');
  const span = document.createElement('span');
  span.className = type;
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
  span.textContent = `[${t}] ${msg}\n`;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

async function send(plain) {
  log('tx', hex(plain));
  await wrtChar.writeValueWithoutResponse(await goveeEnc(plain, sessionKey));
}

async function recv(ms = 5000) {
  const raw = await waitNotify(ms);
  const dec = await goveeDec(raw, sessionKey);
  log('rx', hex(dec));
  return dec;
}

function isConnected() {
  return !!(wrtChar && sessionKey && bleDevice?.gatt?.connected);
}

function hasWebBluetoothSupport() {
  return !!navigator.bluetooth;
}

function closeUnsupportedBle() {
  closeModal('unsupportedBleOverlay');
}

function closeUnsupportedBleOnOuter(e) {
  if (e.target === document.getElementById('unsupportedBleOverlay')) closeUnsupportedBle();
}

function showUnsupportedBleModal() {
  const btn = document.getElementById('connectBtn');
  if (btn) {
    btn.disabled = true;
    btn.title = 'Web Bluetooth unavailable';
  }
  openModal('unsupportedBleOverlay');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!hasWebBluetoothSupport()) showUnsupportedBleModal();
});

function clearBleQueues(reason = 'BLE disconnected') {
  nQueue.length = 0;
  while (nWait.length) nWait.shift().reject(new Error(reason));
}

function expectOpcode(a, b, extra = null) {
  return d => d[0] === a && d[1] === b && (extra == null || d[2] === extra);
}

function handleUnmatchedNotification(dec) {
  if (applyStateReport(dec)) return;
  log('info', `Unmatched notify: ${hex(dec.slice(0, 4))}`);
}

async function recvMatch(expect, ms = 5000) {
  const deadline = Date.now() + ms;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Notify timeout');
    const dec = await recv(remaining);
    if (!expect || expect(dec)) return dec;
    handleUnmatchedNotification(dec);
  }
}

async function requestPacket(payload, expect, ms = 5000) {
  await send(makePacket(payload));
  return recvMatch(expect, ms);
}

async function sendPackets(packets) {
  for (const pkt of packets) await send(makePacket(pkt));
}

function runBleTransaction(label, fn) {
  if (!isConnected()) return Promise.reject(new Error('BLE not connected'));
  const generation = bleGeneration;
  bleQueueDepth++;
  busy = true;
  const run = async () => {
    try {
      if (generation !== bleGeneration) throw new Error('BLE transaction cancelled');
      return await fn();
    } catch (e) {
      log('err', `${label}: ${e.message}`);
      throw e;
    } finally {
      if (generation === bleGeneration) bleQueueDepth = Math.max(0, bleQueueDepth - 1);
      busy = generation === bleGeneration && bleQueueDepth > 0;
    }
  };
  bleQueue = bleQueue.then(run, run);
  return bleQueue;
}

// ── Pairing (button-press confirmation) ──────────────────────────────────────

const PAIRED_KEY = 'govee-paired';

function loadPairedDevices() {
  try { return JSON.parse(localStorage.getItem(PAIRED_KEY)) || {}; } catch { return {}; }
}

function pairedDeviceKeys(device) {
  const keys = [];
  if (device?.id) keys.push(`id:${device.id}`);
  if (device?.name) keys.push(`name:${device.name.trim().toLowerCase()}`);
  return keys;
}

function findPairedDevice(device) {
  const all = loadPairedDevices();
  for (const key of pairedDeviceKeys(device)) {
    if (all[key]) return all[key];
  }

  // Compatibility with older saves that used the raw Web Bluetooth device id.
  if (device?.id && all[device.id]) return all[device.id];

  // Some browsers mint a new opaque id after a new browser session. The
  // advertised BLE name is the most stable browser-visible identity we have.
  if (device?.name) {
    const name = device.name.trim().toLowerCase();
    for (const entry of Object.values(all)) {
      if (entry?.name?.trim().toLowerCase() === name) return entry;
    }
  }

  return null;
}

function savePairedDevice(device, entry) {
  const all = loadPairedDevices();
  for (const key of pairedDeviceKeys(device)) all[key] = entry;
  localStorage.setItem(PAIRED_KEY, JSON.stringify(all));
}

function forgetPairedDevice(device) {
  const all = loadPairedDevices();
  for (const key of pairedDeviceKeys(device)) delete all[key];
  if (device?.id) delete all[device.id];
  if (device?.name) {
    const name = device.name.trim().toLowerCase();
    for (const [key, entry] of Object.entries(all)) {
      if (entry?.name?.trim().toLowerCase() === name) delete all[key];
    }
  }
  localStorage.setItem(PAIRED_KEY, JSON.stringify(all));
}

function isPaired(device) {
  return !!findPairedDevice(device);
}

function openPairModal() {
  document.getElementById('pairStatus').textContent = '';
  document.getElementById('pairStatus').className = 'modal-status';
  document.getElementById('pairCancelBtn').disabled = false;
  document.getElementById('pairOverlay').classList.remove('hidden');
}

function closePairModal() {
  document.getElementById('pairOverlay').classList.add('hidden');
}

function setPairStatus(text, cls = '') {
  const el = document.getElementById('pairStatus');
  el.textContent = text;
  el.className = 'modal-status' + (cls ? ' ' + cls : '');
}

// Polls aa b1 until button pressed, acks with 33 b2, saves token.
// Rejects if cancelled or timed out.
async function requireButtonConfirmation(device) {
  if (isPaired(device)) {
    log('info', `Device already paired (${device.name})`);
    return;
  }

  return new Promise((resolve, reject) => {
    let cancelled = false;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutHandle);
      closePairModal();
      document.getElementById('pairCancelBtn').onclick = null;
      if (err) reject(err); else resolve();
    };

    const timeoutHandle = setTimeout(() => {
      finish(new Error('Pairing timed out: button not pressed within 5 minutes'));
    }, 5 * 60 * 1000);

    document.getElementById('pairCancelBtn').onclick = () => {
      cancelled = true;
      finish(new Error('Pairing cancelled'));
    };

    openPairModal();

    (async () => {
      while (!done && !cancelled) {
        try {
          const resp = await requestPacket([0xaa, 0xb1], d => d[0] === 0xaa && d[1] === 0xb1, 2000);
          if (resp[2] === 0x01) {
            // Button pressed — token is bytes 3–10
            const token = Array.from(resp.slice(3, 11));
            log('info', `Button confirmed, token: ${hex(new Uint8Array(token))}`);
            setPairStatus('Button pressed - pairing complete');
            // Ack with 33 b2 + token
            await send(makePacket([0x33, 0xb2, ...token]));
            await recvMatch(d => d[0] === 0x33 && d[1] === 0xb2, 3000);
            // Persist
            savePairedDevice(device, {
              name: device.name,
              token: hex(new Uint8Array(token)),
              pairedAt: Date.now(),
            });
            log('info', 'Pairing complete');
            finish(null);
            return;
          }
          // resp[2] === 0x00: not yet pressed, loop
        } catch (e) {
          if (done || cancelled) return;
          // timeout on this poll cycle is fine, just retry
        }
        await new Promise(r => setTimeout(r, 250));
      }
    })();
  });
}

async function keyExchange() {
  log('info', 'Key exchange…');
  const pkt1 = await keyExPkt(0x01, STATIC_KEY);
  log('tx', hex(await goveeDec(pkt1, STATIC_KEY)));
  await wrtChar.writeValueWithoutResponse(pkt1);

  const raw1 = await waitNotify();
  const dec1 = await goveeDec(raw1, STATIC_KEY);
  log('rx', hex(dec1));
  if (dec1[0] !== 0xe7 || dec1[1] !== 0x01)
    throw new Error(`Unexpected handshake response: ${hex(dec1)}`);
  sessionKey = dec1.slice(2, 18);
  log('info', `Proto ready: ${hex(sessionKey)}`);

  const pkt2 = await keyExPkt(0x02, STATIC_KEY);
  await wrtChar.writeValueWithoutResponse(pkt2);
  await waitNotify();
  log('info', 'Key exchange done');
}

function setStatus(cls, text) {
  const dot = document.getElementById('connDot');
  const btn = document.getElementById('connectBtn');
  const errBanner = document.getElementById('connError');
  const errMsg = document.getElementById('connErrorMsg');

  dot.classList.toggle('visible', cls === 'connected');
  btn.classList.toggle('reload-mode', cls === 'connected');
  btn.title = cls === 'connected' ? 'Reload state' : 'Connect';

  if (cls === 'connecting') {
    btn.classList.add('spinning');
    btn.disabled = true;
  } else {
    btn.classList.remove('spinning');
  }

  if (cls === 'error') {
    errMsg.textContent = text || 'Connection failed';
    errBanner.classList.remove('hidden');
    requestAnimationFrame(() => errBanner.classList.add('visible'));
  } else if (cls === 'connected' || cls === '') {
    errBanner.classList.remove('visible');
    setTimeout(() => errBanner.classList.add('hidden'), 250);
  }
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(async () => {
    if (busy || !wrtChar || !sessionKey) return;
    try {
      await runBleTransaction('Live poll', async () => {
        currentState = mergeState(currentState, await queryLiveState());
        updateUI(currentState);
      });
    } catch (_) {}
  }, 7000);
}

function stopKeepalive() {
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

function resetBleState(reason = 'BLE disconnected') {
  if (window.stopPhoneMic) window.stopPhoneMic();
  bleGeneration++;
  stopKeepalive();
  clearBleQueues(reason);
  bleQueue     = Promise.resolve();
  bleQueueDepth = 0;
  busy         = false;
  wrtChar      = null;
  sessionKey   = null;
  ntfChar      = null;
}

// ── Shared post-GATT setup ───────────────────────────────────────────────────

async function connectToDevice(device) {
  if (bleDevice !== device) throw new Error('Connection superseded');

  const server   = await device.gatt.connect();
  const svc      = await server.getPrimaryService(SVC);
  wrtChar        = await svc.getCharacteristic(CWRT);
  const newNtf   = await svc.getCharacteristic(CNTFY);

  if (ntfChar) ntfChar.removeEventListener('characteristicvaluechanged', onNotify);
  ntfChar = newNtf;
  await ntfChar.startNotifications();
  ntfChar.addEventListener('characteristicvaluechanged', onNotify);
  log('info', 'GATT ready');

  await keyExchange();

  setStatus('connecting', 'Waiting for button confirmation…');
  await requireButtonConfirmation(device);

  setStatus('connecting', 'Querying state…');
  currentState = await runBleTransaction('Initial state', queryState);
  updateUI(currentState);

  document.getElementById('toggleBtn').disabled = false;
  document.getElementById('toggleBtnBrand').disabled = false;
  const _bEnable = id => { const el = document.getElementById(id); if (el) el.disabled = false; };
  _bEnable('bedtimeBtn'); _bEnable('setupBtn'); _bEnable('fwBtn');
  document.getElementById('connectBtn').disabled = false;
  document.body.classList.add('ble-connected');
  setStatus('connected', `Connected · ${device.name}`);
  log('info', 'Connected');
  startKeepalive();
}

// ── Manual connect ───────────────────────────────────────────────────────────

async function reloadDeviceState() {
  if (!isConnected()) return;
  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  try {
    await runBleTransaction('Reload state', async () => {
      currentState = mergeState(currentState, await queryState());
      updateUI(currentState);
    });
  } catch (e) {
    log('err', `Reload state: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

function connectButtonAction() {
  if (isConnected()) {
    reloadDeviceState();
    return;
  }
  connect();
}

async function connect() {
  if (!hasWebBluetoothSupport()) {
    showUnsupportedBleModal();
    return;
  }

  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  setStatus('connecting', 'Scanning…');
  bleDevice = null;
  resetBleState('New connection');

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'ihoment' },
        { namePrefix: 'Govee' },
        { namePrefix: 'GBK' },
      ],
      optionalServices: [SVC],
    });

    bleDevice = device;
    setStatus('connecting', `Connecting to ${device.name}…`);
    log('info', `Device: ${device.name}`);
    await connectToDevice(device);

    device.addEventListener('gattserverdisconnected', () => {
      resetBleState('BLE disconnected');
      log('err', 'Disconnected');
      document.getElementById('toggleBtn').disabled = true;
      document.getElementById('toggleBtnBrand').disabled = true;
      const _bDisable = id => { const el = document.getElementById(id); if (el) el.disabled = true; };
      _bDisable('bedtimeBtn'); _bDisable('setupBtn'); _bDisable('fwBtn');
      btn.disabled = false;
      document.body.classList.remove('ble-connected');
      setStatus('', 'Disconnected');
    });

  } catch (e) {
    log('err', e.message);
    setStatus('error', e.message || 'Connection failed');
    btn.disabled = false;
  }
}

// ── Other device actions ─────────────────────────────────────────────────────

async function togglePower() {
  if (!isConnected()) return;
  const btn = document.getElementById('toggleBtn');
  btn.disabled = true;
  const on = currentState?.on ?? false;
  try {
    await runBleTransaction('Toggle', async () => {
      await send(makePacket([0x33, 0x01, on ? 0x00 : 0x01]));
      currentState = mergeState(currentState, { on: !on });
      updateUI(currentState);
      await new Promise(r => setTimeout(r, 200));
      currentState = mergeState(currentState, await queryPowerState());
    });
    updateUI(currentState);
  } catch (e) {
    log('err', `Toggle: ${e.message}`);
  }
  btn.disabled = false;
}
