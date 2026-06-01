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
