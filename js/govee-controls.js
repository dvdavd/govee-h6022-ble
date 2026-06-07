// govee-controls.js — Brightness, RGB colour, and CCT controls

async function setBrightness(value) {
  value = Math.max(0, Math.min(100, Math.round(value)));
  await send(makePacket([0x33, 0x04, value]));
}

function kelvinToRgb(kelvin) {
  const table = {
    2700: [0xff, 0xae, 0x54],
    3100: [0xff, 0xbd, 0x6f],
    3700: [0xff, 0xce, 0x92],
    5400: [0xff, 0xed, 0xda],
    6500: [0xff, 0xff, 0xff],
  };
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (kelvin <= keys[0]) return table[keys[0]];
  if (kelvin >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  
  for (let i = 0; i < keys.length - 1; i++) {
    if (kelvin >= keys[i] && kelvin <= keys[i + 1]) {
      const t = (kelvin - keys[i]) / (keys[i + 1] - keys[i]);
      const c1 = table[keys[i]];
      const c2 = table[keys[i + 1]];
      return [
        Math.round(c1[0] + t * (c2[0] - c1[0])),
        Math.round(c1[1] + t * (c2[1] - c1[1])),
        Math.round(c1[2] + t * (c2[2] - c1[2])),
      ];
    }
  }
  return [0xff, 0xff, 0xff];
}

async function setColour(r, g, b) {
  [r, g, b] = applyCalibration(r, g, b, 'solidColours');
  await send(makePacket([0x33, 0x05, 0x0d, r, g, b, 0x00, 0x00, 0x00, 0x00, 0x00]));
}

async function setCCT(kelvin) {
  kelvin = Math.max(2700, Math.min(6500, Math.round(kelvin)));
  const [r, g, b] = kelvinToRgb(kelvin);
  const kMsb = (kelvin >> 8) & 0xff;
  const kLsb = kelvin & 0xff;
  await send(makePacket([0x33, 0x05, 0x0d, r, g, b, kMsb, kLsb, r, g, b]));
}

function initControls() {
  const briSlider = document.getElementById('brightnessSlider');
  const briVal = document.getElementById('brightnessSliderVal');
  briSlider.oninput = function() {
    const value = parseInt(this.value, 10);
    briVal.textContent = value;
    if (currentState) updateBulbCard({ ...currentState, on: true, brightness: value });
  };
  briSlider.onchange = async function() {
    if (!isConnected()) return;
    try {
      const value = parseInt(this.value, 10);
      await runBleTransaction('Brightness', async () => {
        await setBrightness(value);
        currentState = mergeState(currentState, { on: true, brightness: value });
        updateUI(currentState);
        await new Promise(r => setTimeout(r, 150));
        currentState = mergeState(currentState, await queryBrightnessState());
      });
      updateUI(currentState);
    } catch (e) {
      log('err', `Brightness: ${e.message}`);
    }
  };

  const colorPicker = document.getElementById('colorPicker');
  colorPicker.oninput = function() {
    const hex = this.value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    document.getElementById('colorHex').textContent = hex.toUpperCase();
    document.getElementById('colorRgb').textContent = `${r}, ${g}, ${b}`;
  };
  colorPicker.onchange = async function() {
    if (!isConnected()) return;
    try {
      const hex = this.value;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      await runBleTransaction('Colour', async () => {
        await setColour(r, g, b);
        currentCustomColor = { type: 'rgb', r, g, b };
        assumeLightOn({
          musicMode: false,
          sceneCode: 0,
          colorHex: rgbToDisplayHex(r, g, b),
          modeDisplay: { kind: 'rgb', label: rgbToDisplayHex(r, g, b) },
        });
        await new Promise(resolve => setTimeout(resolve, 150));
        currentState = mergeState(currentState, await queryModeState());
      });
      updateUI(currentState);
    } catch (e) {
      log('err', `Colour: ${e.message}`);
    }
  };

  const cctSlider = document.getElementById('cctSlider');
  const cctVal = document.getElementById('cctSliderVal');
  cctSlider.oninput = function() {
    cctVal.textContent = this.value + 'K';
  };
  cctSlider.onchange = async function() {
    if (!isConnected()) return;
    try {
      await runBleTransaction('CCT', async () => {
        await setCCT(parseInt(this.value, 10));
        const kelvin = parseInt(this.value, 10);
        currentCustomColor = { type: 'cct', kelvin };
        assumeLightOn({
          musicMode: false,
          sceneCode: 0,
          cctKelvin: kelvin,
          modeDisplay: { kind: 'cct', label: `${kelvin}K` },
        });
        await new Promise(r => setTimeout(r, 150));
        currentState = mergeState(currentState, await queryModeState());
      });
      updateUI(currentState);
    } catch (e) {
      log('err', `CCT: ${e.message}`);
    }
  };
}

document.addEventListener('DOMContentLoaded', initControls);
