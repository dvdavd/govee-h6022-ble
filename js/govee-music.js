// govee-music.js — Music mode activation and UI

function musicModePackets(presetId, sensitivity) {
  presetId &= 0xFF;
  sensitivity = Math.max(0, Math.min(100, sensitivity));
  const sensitivityByte = Math.round(sensitivity * 0x63 / 100);

  let flag = 0x01;
  if (presetId === 0x33) flag = 0x19;
  else if (presetId === 0x65) flag = 0x00;

  const packets = [];
  packets.push(finish([
    0xA3, 0x00, 0x01, 0x02, 0x41, presetId, 0x07,
    0xFF, 0x00, 0x00, 0xFF, 0x7F, 0x00, 0xFF,
    0xFF, 0x00, 0x00, 0xFF, 0x00,
  ]));
  packets.push(finish([
    0xA3, 0xFF, 0x00, 0x00, 0xFF, 0x00, 0xFF,
    0xFF, 0x8B, 0x00, 0xFF, flag,
  ]));
  packets.push(finish([0xA3, 0x41, presetId]));
  packets.push(finish([0x33, 0x05, 0x13, presetId, sensitivityByte]));
  return packets;
}

async function activateMusic(presetId, sensitivity) {
  const packets = musicModePackets(presetId, sensitivity);
  await sendPackets(packets);
}

function phoneMicActivatePacket() {
  return makePacket([0x33, 0x05, 0x0d, 0x01]);
}

function phoneMicRgbPacket(r, g, b) {
  const data = new Uint8Array([
    0xA5, 0x02, 0x83,
    Math.max(0, Math.min(255, r)) & 0xff,
    Math.max(0, Math.min(255, g)) & 0xff,
    Math.max(0, Math.min(255, b)) & 0xff,
  ]);
  const out = new Uint8Array(7);
  out.set(data);
  out[6] = data.reduce((sum, v) => (sum + v) & 0xff, 0);
  return out;
}

async function sendPhoneMicRgb(r, g, b) {
  const plain = phoneMicRgbPacket(r, g, b);
  await wrtChar.writeValueWithoutResponse(await goveeEnc(plain, sessionKey));
}

const MUSIC_PRESETS = [
  { id: 0x33, name: 'Hopping' },
  { id: 0x38, name: 'Rhythm' },
  { id: 0x39, name: 'Energic' },
  { id: 0x54, name: 'Spectrum' },
  { id: 0x55, name: 'Color Painting' },
  { id: 0x63, name: 'Light Waves' },
  { id: 0x64, name: 'Dandelion' },
  { id: 0x65, name: 'Meteor Shower' },
];

const PHONE_MIC_COLORS = [
  [255, 0, 0],
  [200, 200, 0],
  [0, 255, 0],
  [0, 200, 200],
  [0, 0, 255],
  [139, 0, 255],
  [160, 160, 160],
];

const phoneMicState = {
  running: false,
  stream: null,
  audioContext: null,
  analyser: null,
  timer: null,
  brightness: 128,
  colorIdx: 0,
  beatCount: 0,
  framesSinceBeat: 0,
  prevRgb: [-1, -1, -1],
  smoothLevel: 0,
  hue: 195,
  sending: false,
  sentCount: 0,
  mode: 'party',
  fixedColor: '#00ace7',
};

function phoneMicStatus(text, on = false) {
  const el = document.getElementById('phoneMicStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('on', on);
}

function setPhoneMicMeter(level) {
  const fill = document.getElementById('phoneMicMeter');
  if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`;
}

function readPhoneMicLevel() {
  const { analyser } = phoneMicState;
  if (!analyser) return 0;

  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const sample of data) {
    const v = (sample - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function phoneMicRgbForLevel(level) {
  const mode = phoneMicState.mode || 'party';
  const autoColor = document.getElementById('phoneMicAutoColor')?.checked ?? true;
  const fixedColor = hexToRgb(phoneMicState.fixedColor || '#00ace7');

  phoneMicState.smoothLevel = phoneMicState.smoothLevel * 0.7 + level * 0.3;
  const meterLevel = Math.min(1, phoneMicState.smoothLevel * 12);
  setPhoneMicMeter(meterLevel);

  if (!autoColor) {
    const brightness = Math.max(8, Math.min(255, Math.round(35 + meterLevel * 220)));
    return fixedColor.map(c => Math.round(c * brightness / 255));
  }

  if (mode === 'party') {
    if (level > 0.04) {
      phoneMicState.brightness = Math.min(254, phoneMicState.brightness + 80);
      phoneMicState.beatCount++;
      phoneMicState.framesSinceBeat = 0;
    } else {
      phoneMicState.framesSinceBeat++;
      if (phoneMicState.brightness > 200) phoneMicState.brightness -= 50;
      else if (phoneMicState.brightness > 160) phoneMicState.brightness -= 60;
      else phoneMicState.brightness -= 70;
      phoneMicState.brightness = Math.max(20, phoneMicState.brightness);
      if (phoneMicState.beatCount > 1 && phoneMicState.framesSinceBeat > 5) {
        phoneMicState.beatCount = 0;
        phoneMicState.framesSinceBeat = 0;
        phoneMicState.colorIdx = (phoneMicState.colorIdx + 1) % PHONE_MIC_COLORS.length;
      }
    }
    const color = PHONE_MIC_COLORS[phoneMicState.colorIdx];
    return color.map(c => Math.floor(c * phoneMicState.brightness / 255));
  }

  if (mode === 'dynamic') {
    phoneMicState.hue = (phoneMicState.hue + 7 + meterLevel * 18) % 360;
    const brightness = Math.max(15, Math.round(25 + meterLevel * 230));
    return hsv2rgb(phoneMicState.hue, 0.92, brightness / 255);
  }

  phoneMicState.hue = (phoneMicState.hue + 1.6 + meterLevel * 4) % 360;
  const brightness = Math.max(10, Math.round(18 + meterLevel * 150));
  return hsv2rgb(phoneMicState.hue, 0.45, brightness / 255);
}

async function phoneMicTick() {
  if (phoneMicState.sending) return;
  if (!phoneMicState.running || !isConnected()) {
    await stopPhoneMic();
    return;
  }

  const level = readPhoneMicLevel();
  const [r, g, b] = phoneMicRgbForLevel(level);
  const prev = phoneMicState.prevRgb;
  if (r === prev[0] && g === prev[1] && b === prev[2]) return;
  phoneMicState.prevRgb = [r, g, b];

  try {
    phoneMicState.sending = true;
    await sendPhoneMicRgb(r, g, b);
    phoneMicState.sentCount++;
    if (phoneMicState.sentCount % 10 === 1) {
      phoneMicStatus(`Streaming browser mic · rgb(${r}, ${g}, ${b})`, true);
    }
  } catch (e) {
    log('err', `Browser mic: ${e.message}`);
    await stopPhoneMic();
  } finally {
    phoneMicState.sending = false;
  }
}

async function startPhoneMic() {
  if (phoneMicState.running) return;
  if (!isConnected()) {
    phoneMicStatus('BLE not connected');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    phoneMicStatus('Browser microphone capture is unavailable');
    return;
  }

  const btn = document.getElementById('phoneMicToggle');
  if (btn) btn.disabled = true;

  try {
    phoneMicStatus('Requesting microphone…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    phoneMicStatus('Preparing audio…');
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    phoneMicState.stream = stream;
    phoneMicState.audioContext = audioContext;
    phoneMicState.analyser = analyser;

    phoneMicStatus('Activating browser mic…');
    await runBleTransaction('Browser mic', async () => {
      await send(phoneMicActivatePacket());
      assumeLightOn({ musicMode: true, musicPreset: null, sceneCode: null, modeDisplay: { kind: 'music', label: 'Browser Mic' } });
    });

    phoneMicState.running = true;
    phoneMicState.prevRgb = [-1, -1, -1];
    phoneMicState.brightness = 128;
    phoneMicState.colorIdx = 0;
    phoneMicState.beatCount = 0;
    phoneMicState.framesSinceBeat = 0;
    phoneMicState.sentCount = 0;
    phoneMicState.timer = setInterval(phoneMicTick, 100);
    busy = true;
    stopKeepalive();
    await phoneMicTick();

    phoneMicStatus('Streaming browser mic', true);
    log('info', 'Browser mic streaming started');
    if (btn) {
      btn.textContent = 'Stop Browser Mic';
      btn.disabled = false;
    }
  } catch (e) {
    log('err', `Browser mic: ${e.message}`);
    phoneMicStatus(e.message);
    await stopPhoneMic();
    if (btn) btn.disabled = false;
  }
}

async function stopPhoneMic() {
  if (phoneMicState.timer) {
    clearInterval(phoneMicState.timer);
    phoneMicState.timer = null;
  }
  if (phoneMicState.stream) {
    phoneMicState.stream.getTracks().forEach(track => track.stop());
    phoneMicState.stream = null;
  }
  if (phoneMicState.audioContext) {
    try { await phoneMicState.audioContext.close(); } catch (_) {}
    phoneMicState.audioContext = null;
  }
  phoneMicState.analyser = null;
  phoneMicState.running = false;
  setPhoneMicMeter(0);
  phoneMicStatus('Idle');
  const btn = document.getElementById('phoneMicToggle');
  if (btn) {
    btn.textContent = 'Start Browser Mic';
    btn.disabled = false;
  }
  busy = bleQueueDepth > 0;
  if (isConnected()) startKeepalive();
}

function togglePhoneMic() {
  if (phoneMicState.running) stopPhoneMic();
  else startPhoneMic();
}

function renderMusicGrid() {
  const grid = document.getElementById('musicGrid');
  const activePreset = currentState?.musicPreset;
  grid.innerHTML = '';

  for (const p of MUSIC_PRESETS) {
    const card = document.createElement('button');
    card.className = 'music-card' + (activePreset === p.id ? ' active' : '');
    card.innerHTML = `<span class="music-name">${p.name}</span>`;
    card.onclick = async () => {
      if (!isConnected()) return;
      try {
        if (phoneMicState.running) await stopPhoneMic();
        const sens = parseInt(document.getElementById('musicSensitivity').value, 10);
        await runBleTransaction('Music', async () => {
          await activateMusic(p.id, sens);
          assumeLightOn({
            musicMode: true,
            sceneCode: null,
            musicPreset: p.id,
            musicSensitivity: Math.round(sens * 0x63 / 100),
            modeDisplay: { kind: 'music', label: p.name },
          });
          await new Promise(r => setTimeout(r, 200));
          currentState = mergeState(currentState, await queryModeState());
        });
        updateUI(currentState);
        renderMusicGrid();
      } catch (e) {
        log('err', `Music: ${e.message}`);
      }
    };
    grid.appendChild(card);
  }
}

function initMusicSeg() {
  bindSegmentValue('musicSeg', 'panel', panelId => {
    document.querySelectorAll('.music-panel').forEach(p => p.classList.remove('visible'));
    document.getElementById(panelId).classList.add('visible');
  });
}

function initMusic() {
  initMusicSeg();
  const colorBtn = document.getElementById('phoneMicColor');
  const syncPhoneMicColor = () => {
    if (colorBtn) colorBtn.style.setProperty('--phone-mic-color', phoneMicState.fixedColor);
  };
  bindSegmentValue('phoneMicModeSeg', 'mode', mode => {
    phoneMicState.mode = mode || 'party';
  });
  document.getElementById('musicSensitivity').addEventListener('input', function() {
    document.getElementById('musicSensVal').textContent = this.value;
  });
  document.getElementById('phoneMicToggle').addEventListener('click', togglePhoneMic);
  document.getElementById('phoneMicAutoColor').addEventListener('change', function() {
    colorBtn.disabled = this.checked;
  });
  colorBtn.addEventListener('click', () => {
    if (colorBtn.disabled) return;
    window.openAppColorEditor?.({
      title: 'Browser Mic Colour',
      value: phoneMicState.fixedColor,
      onSave: (hex) => {
        phoneMicState.fixedColor = hex;
        syncPhoneMicColor();
      },
    });
  });
  colorBtn.disabled = document.getElementById('phoneMicAutoColor').checked;
  syncPhoneMicColor();
  renderMusicGrid();
}

document.addEventListener('DOMContentLoaded', initMusic);
