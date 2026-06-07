// govee-scenes.js — Scene encoding and selection UI

const HEART_FILLED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z"/></svg>`;
const HEART_OUTLINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/></svg>`;

function finish(data) {
  let checksum = 0;
  for (const b of data) checksum ^= b;
  const out = [...data];
  while (out.length < 19) out.push(0);
  out.push(checksum & 0xFF);
  return out;
}

function buildA3MultiPacket(rawBytes) {
  const data = [0xA3, 0x00, 0x01, 0x00];
  let numLines = 0;
  let lastLineMarker = 1;

  for (const b of rawBytes) {
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
  return packets;
}

function calibrateSceneRaw(raw, feature = 'builtInScenes') {
  if (!isCalibrationFeatureEnabled(feature)) return;

  if (raw[0] === 0x41) {
    // Matrix scene: background at [1..3], then blocks of groups
    [raw[1], raw[2], raw[3]] = applyCalibration(raw[1], raw[2], raw[3], feature);
    let pos = 7;
    const blocks = raw[6];
    for (let block = 0; block < blocks; block++) {
      if (pos + 5 >= raw.length) break;
      const groupBytes = raw[pos] - 15;
      const groupCount = raw[pos + 5];
      const groupStart = pos + 6;
      const groupEnd = groupStart + groupBytes;
      if (groupBytes < 0 || groupEnd > raw.length) break;
      pos = groupStart;
      for (let group = 0; group < groupCount; group++) {
        if (pos + 3 >= groupEnd) break;
        const ledCount = raw[pos++];
        [raw[pos], raw[pos + 1], raw[pos + 2]] = applyCalibration(raw[pos], raw[pos + 1], raw[pos + 2], feature);
        pos += 3 + ledCount;
      }
      pos = groupEnd + 11;
    }
  } else if (raw[0] === 0x00) {
    // Short preset scene: palette of RGB triplets starting at byte 5, length raw[4]
    const paletteLen = raw[4];
    const paletteEnd = 5 + paletteLen;
    if (paletteLen >= 6 && paletteLen % 3 === 0 && paletteEnd <= raw.length) {
      for (let pos = 5; pos < paletteEnd; pos += 3) {
        [raw[pos], raw[pos + 1], raw[pos + 2]] = applyCalibration(raw[pos], raw[pos + 1], raw[pos + 2], feature);
      }
    }
  }
  // Other formats (0x02 etc) are opaque firmware animations — no RGB to calibrate
}

function scenePackets(sceneCode, sceneParamBase64, calibrationFeature = 'builtInScenes') {
  const lo = sceneCode & 0xFF;
  const hi = (sceneCode >> 8) & 0xFF;

  if (!sceneParamBase64) {
    return [finish([0x33, 0x05, 0x04, lo, hi])];
  }

  const raw = Array.from(atob(sceneParamBase64), c => c.charCodeAt(0));
  calibrateSceneRaw(raw, calibrationFeature);

  let transformed;
  if (raw[0] === 0x41) {
    transformed = [0x58, 0x5A, ...raw.slice(1)];
  } else if (raw[0] === 0x00) {
    transformed = [0x04, ...raw.slice(1)];
  } else {
    transformed = [0x02, ...raw];
  }

  const a3Packets = buildA3MultiPacket(transformed);
  a3Packets.push(finish([0x33, 0x05, 0x04, lo, hi]));
  return a3Packets;
}

async function activateScene(sceneCode, sceneParamBase64, calibrationFeature = 'builtInScenes') {
  const packets = scenePackets(sceneCode, sceneParamBase64, calibrationFeature);
  await sendPackets(packets);
}

const SCENE_PARAMS = {
  8505: 'AA8OYBj/ZAD/ZAD/ZAD/ZAD/ZAD/ZAD/ZAD/ZAA=',
  'Fast Fire': 'AA8OYBj/ZAD/ZAD/ZAD/ZAD/ZAD/ZAD/ZAD/ZAA=',
  'Flash (Sound)': 'AAQIQBgAlhTd3wDj5Rb/qwD3eXbYg/+TNv06hv8=',
  'Spin (Sound)': 'AAQHQBgAlhTd3wDj5Rb/qwD3eXbYg/+TNv06hv8=',
  'Lightning (Sound)': 'AAQGQBgAlhTd3wDj5Rb/qwD3eXbYg/+TNv06hv8=',
  8478: 'QQEBAWQAAasAA50ABhI6hv8AAQIDBAUGBwgJCgsMDhASFBYY+K2dDQ8RExUXGBkaGxwdHh8gISIjJCYoKiwuMP++CyUnKSstLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1RWWFpcXgb/fwBVV1lbXV8S+1YHYGFiY2RlZmdoaWprbG5wcnR2Ev8AAG1vcXN1d3h5ent8fX5/gIGCg0tkAwAB//8AAAAA',
  8479: 'QQEBAWQAAa8AA6EABxj/AAAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcS9wAAGBkaGxwdHh8gISIjJCYoKiwuHvtWByUnKSstLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGRwz/fwBISUpLTE1OT1BRUlMY/5UFVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprDP++C2xtbm9wcXJzdHV2dwz/4BZ4eXp7fH1+f4CBgoMyZAMAAf//AAAAAA==',
  42: '',
  8480: 'QQEBAWQAA68AA6EABxj7VgcAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcP/38AGBkaYmNkZWZsbW50dXZ3EP+3ABscHR4fICEiIyQlJicoMDEn/588KSorLC0yMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTAv+VBS4vE/+GAFRVVldYWVpbXF1eX2BhZ2hpamsR/wAAb3BxcnN4eXp7fH1+f4CBgoMyZAQAAv//AAAAADsAAy0AAhj7VgdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8M/wAAYGFiY2RlZmdoaWprRmQBAAH//wAAAABHAAM5AAIY//8ADA0ODxAREhMUFRYXGBkaGxwdHh8gISIjGP9/ACQlJicoKSorLC0uLzAxMjM0NTY3ODk6O0ZkAgAB//8AAAAA',
  8481: 'QQD/AGQAAi0AAx8AARoAAP8LFRYgISorLDQ1Nj4/QElKS1VdYGdocnN8fVFkBgAB//8AAAAAIgADFAABD4sA/xchIiwtNjc4Qmhpc3R+f1lkBgAB//8AAAAA',
  44: '',
  43: '',
  46: '',
  41: '',
  8482: 'QQEBAWQAAqcAA5kABVsA/wAAAQIDBAYHCgsMDQ4PEhQVFhcYGRodHh8gISIjJCgpKissLzEyMzQ1Njc6Ozw9Pj9AREVGR0hJSktPUFFUVVpbXF9gZGVmZ2tub3BxcnV2d3h5ent8fX+AgYKDC///AAUQERwnUl1oaXN+E/8AAAgJExslJi0uMDg5QkNNTlhiY20GMf+TQUxWV2FsBf9/AFNZXmp0V10GAAL//wAAAAAqAAMcAAIKAP//CRQfKjVAS1ZhbAly/3IjLjlERU9QW2ZcZAYAAf//AAAAAA==',
  8483: 'QQZy/0EAA2kAA1sAAxgAAP8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhckAIj/SUtNT1FTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG5wcnR2Ev///21vcXN1d3h5ent8fX5/gIGCgx5kAwAC//8AAAAAHgADEAABC////01OT1BWV1hZc3R1VWQEAAH//wAAAAAkAAMWAAER////QkNETE1OT1BcXV5gYWJub3BVZAMAAf//AAAAAA==',
  8484: 'QQBbJAIAAxgAAwoAAQXj5RYOF05VdTxQAAAC//8AAAAAFwADCQABBL/SAA4iYWg3MgcAAf//AAAAABYAAwgAAQP/0gAfSV9LWgQAAf//AAAAAA==',
  40: '',
  8485: 'QQe+uDwAAzcAAykABAj/AKYHEhMUHh8gKwb/AAAlMDE8PUkC/0QHMj4IiwD/UVxdXmhpanVSZAIAAf//AAAAACcAAxkAAgj/fwAKFRYXISIjLgj//wBMV1hZY2RlcF9kAgAC//8AAAAAJQADFwADBv9/AA4yRFlhdwL/AAAqUAL//wA+a1ZkCAAD//8AAAAA',
  8486: 'QQEBAWQAAyYAAxgAARP/AG4ABRUaGyEiJzZCQ0leY2Rqa3B/VWQIAAH//wAAAACfAAORAAMU/wBuAAECAwQFBgcICQoLDA4QEhMUFx9k//CQDQ8RFRYYGRobHB0eICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2dwzphYd4eXp7fH1+f4CBgoMyRgMAA///AAAAABYAAwgAAQP/Q1IUXGFVZAcAAv//AAAAAA==',
  8487: 'QQDQjjAAAxwAAw4AAQn///8OITVBU1VhaHRkZAIAAf//AAAAACUAAxcAARL///9sb3B0dXZ4eXp7fH1+f4CBgoNGNgMAAv//AAAAACUAAxcAARL///9sb3B0dXZ4eXp7fH1+f4CBgoNGNgQAAv//AAAAAA==',
  8488: 'QcxYAwwAAjwAAy4AASn//wAJChUWQk1OT1hZWltcY2RlZmdoaW5vcHFyc3R1dnh5ent8fX5/gIGCgxFkBAAC//8AAAAAHQADDwABCv//AAIOFjQ/WmFpbHVPZAYAAf//AAAAAA==',
  8489: 'QQEBAWQAAjUAAycAAhKLAP8AAQIDBAUGBwgJCgsNDxETFRcMAAD/eHl6e3x9fn+AgYKDMhYDAAH//wAAAACBAANzAAkF//8AGSUxVWEF/38AGiYyVmIF+1YHGyczV2MK/wAAHB0oKTQ1WFlkZQX/AG4eKjZaZgeDOOwgLDc4W1xoCgD/ACEiLS45Ol1eaWoHAP//Iy8wO1RfaxgAAP88PT4/QEFCQ0RFRkdISUpLTE1OT1BRUlNQZAMAAf//AAAAAA==',
  8490: 'QQCs5yUAA0wAAz4AAy4A/wAzP0pLTFJVVlhZXV5fYGFiY2RlZmhqa2xub3BxcnN0dXZ3eHl6e3x9fn+AgYKDAv/wbFdtAf+fPGkwZAMAAf//AAAAAF4AA1AAAiAk8pweKSorNDU2Nzg/QEFCQ0RLTE1OT1BYWVpbXGVmZ3FycycA0I4kMDE7PD1GR0hJSlFSU1RVVlddXl9gYWJjZGhpamtsbW5vcHR1dndOUAMAAv//AAAAABcAAwkAAQT8/6YODyEiRGQDAAH//wAAAAA=',
  8491: 'QQEBAWQAAyIAAxQAAQ////8GDBkhJi41O0JPVGF2fYNOZAIAAf//AAAAABoAAwwAAQf///8JDRYaT1xpUFACAAL//wAAAACbAAONAAJ4AKAAAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3DP///3h5ent8fX5/gIGCgzIyAwAD//8AAAAA',
  8492: 'QQEBAUYAA30AA28ABQv/ANYlJiorLC8wNDU5Ohj/fwAxMjY3PD0+P0BBQkNERUZHSElNTlFSWl4M/wAAMzg7SktMT1BTVVldC///AFRWWFxfYGFiZmlqIAD/AFdbY2RlZ2hrbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDPGQEAAH//wAAAABTAANFAAIY//8AAAECAwQFBgcICQoLDA0ODxAREhMUFRYXJP//ZhgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6O0ZkAwAD//8AAAAAKwADHQABGP//AAABAgMEBQYHCAkKCwwNDg8QERITFBUWF1BkAgAB//8AAAAA',
  8493: 'QQEBAWQAAn8AA3EABB4x/5MAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcZGx0fISMY//BsGBocHiAiJCUmJygpKissLS4vSElKS0xNHv/wkDAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR05PUFFSUwz/zEFUVVZXWFlaW1xdXl8yZAQAAf//AAAAAGYAA1gAAyH/fwAuMDQ5Ojs8PT9AQURFRkdISUpLTE1OT1BRUlNUVlhaXF4a/18oVVdZW11fYGFiY2RlZmdoaWprbG1ub3BxcnMQ+1YHdHV2d3h5ent8fX5/gIGCg1FYAwAB//8AAAAA',
  8494: 'QQEBAS8AAxYAAwgAAQP/fwAcaGxWZAIAAv//AAAAACUAAxcAARL/fwAAAQIDBAUGBwgJCgsNDxETFRcyZAMAAf//AAAAABgAAwoAAQX/hgAKJkVlgkJEBwAB//8AAAAA',
  8495: 'QQEBAWQAAxsAAw0AAQj///8LEiY6TlRwdVpkAgAB//8AAAAAGAADCgABBf///xQZQWJ1S2QCAAH//wAAAACrAAOdAAYMGgD/AAECAwQFBgcICQoLNgAA/wwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Oz0/QUNFRyoGcv88PkBCREZISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl9gYWJjZGVmZ2hpamsE2+TubHBxcwY6hv9tbnJ1dncO////b3R4eXp7fH1+f4CBgoNGRgMAAv//AAAAAA==',
  8496: 'QQEBAUIAAz8AAzEAASwAAP9ET1BRVVpbXF1eYGFiZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5/gIGCg0tfBAAC//8AAAAAFwADCQABBP//AA8QGxxLZAMAAf//AAAAAGsAA10AAhgA0I4AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhc8JdtdGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTMmQDAAP//wAAAAA=',
  99: '',
  35: '',
  38: '',
  8497: 'QQEBAWQAApsAA40AAhj/xjQAAQIDBAUGBwgJCgsMDhASFBYZGx0fISNsMf+TDQ8RExUXGBocHiAiJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDTmQDAAL//wAAAAA7AAMtAAIGAP//VFZYWlxeHgCI/2FjZWdpa2xtbm9wcXJzdHV2d3h5ent8fX5/gIGCg0ZkBAAB//8AAAAA',
  8498: 'QQEBAWQAAp8AA5EAAxL/4m8AAQIDBAUGBwgJCgsNDxETFRcq/8xBDA4QEhQWGBkaGxwdHh8gISIjJCUmJygpKissLS4vMTM1Nzk7PD5AQkRGSP/wbDAyNDY4Oj0/QUNFR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5/gIGCgzJkBAAC//8AAAAAYgADVAACJ//GNC4wNDk6Ozw9P0BBREVGR0hJSktMTU5PUFFSU1VXWVtdX2BiZGZoaiT/twBUVlhaXF5hY2VnaWtsbW5vcHFyc3R1dnd4eXp7fH1+f4CBgoNAZAMAAf//AAAAAA==',
  8499: 'QQEBAWQAAp8AA5EAAyT/fwAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiM2/7cAJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFZYWlxeKv/MQVVXWVtdX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5/gIGCg0ZaBAAC//8AAAAAWQADSwACGP/MQTw+QEJERkhJSktMTU5PUFFSU1RWWFpcXir/twBVV1lbXV9gYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1+f4CBgoNAZAMAAf//AAAAAA==',
  8500: 'Qf///2QAAmMAA1UAAyRy/3IxMzU3OTs8PkBCREZISUpLTE1OT1BRUlNgYWJjZGVmZ2hpamsMMf+TVFVWV1hZWltcXV5fGAD/AGxtbm9wcXJzdHV2d3h5ent8fX5/gIGCg1NkBAAB//8AAAAAHwADEQABDAD//wABAgMEBQYHCAkKC1NRAwAB//8AAAAA',
  8501: 'QQD/AAQAAjcAAykAASQA/wAAAQIDBAUGBwgJCgtsbW5vcHFyc3R1dnd4eXp7fH1+f4CBgoMAFAAAAv//AAAAADcAAykABgOLAP8YGS4DAP//H1JTAv9/ACcoBP//AC09WFkC/wAAPmkCAAD/QkNGZAQAAf//AAAAAA==',
  8502: 'QQAA/0YAAiwAAx4AARkDqzZiY2hpamxtbm9yc3R1eHl6e3x9fn+AgYKDPGQDAAL//wAAAAArAAMdAAIQ/74LHikqNDU2P0BBQkxNTllaZgT7Vgc4Q0RQRmQDAAH//wAAAAA=',
  8503: 'QQBe/0EAAkQAAzYABAv/AABVVldhYmNub3l6ewwA/wBYWVpkZW5wcXJ8fX4M/38AW1xdZ2hpc3R1f4CBAv//AGxtWWQDAAH//wAAAAAfAAMRAAEM////AwsXHCEsNkBCVmJtTGQBAAL//wAAAAA=',
  8504: 'QQA8/zQAAjEAAyMAAR4A/wRWX2FiY2Rqa2xtbm9wcXR1dnd4eXp7fH1+f4CBgoNMZAMAAf//AAAAACwAAx4AARn///8ABwsMEhkdIyUpLjY8Q0dIT1VaYWVtcnh+VmQBAAL//wAAAAA=',
  'Breathe': 'AAUAIxgAlhTd3wDj5Rb/qwD3eXbYg/+TNv06hv8=',
  'Gradient': 'AAAACBhaAIRsAKVLGbcAjAAAlUwGcv8iI/YANKA=',
  'Fire': 'AA8AIwz/AAD/UAD/tAD//wA=',
  'Rainbow': 'AAkAIxX/AAD/fwD//wAA/wAAAP8A//+LAP8=',
  'Dream 1': 'AA4NIxX/AAD/fwD//wAA/wAAAP8A//+LAP8=',
  'Dream 2': 'AA4OVQ9S4+H/qwD3eXbYg/+TNv0=',
  'Graffiti 1': 'AFINIxX/AAD/fwD//wAA/wAAAP8A//+LAP8=',
  'Graffiti 2': 'AFIOIxX/AAD/fwD//wAA/wAAAP8A//+LAP8=',
  'Graffiti 3': 'AFI5SBj/vgv7Vgf/AACDOOwAOrcA/wAAAP8A//8=',
  45: '',
  8509: 'QQEBAWQAAZsAA40ABRj/AAAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY//8AGBkaGxwdHh8gISIjJCUmJygpKissLS4vGAD/ADAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGRxgAAP9ISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8YiwD/YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3VWQCAAH//wAAAAA=',
  8510: 'QQEBAWQAAaMAA5UABDn/AAAAAQIMDQ4YGRonKCktLi8zNDU5Ojs/QEFFRkdLTE1RUlNUVVZaW1xgYWJmZ2hsbW5yc3R4eXp+f4AS//8AAwQFCQoLDxARFRYXGxwdISIjIQAA/wYHCBITFB4fICQlJjAxMjw9PkhJSl1eX2lqa3V2d4GCgxgA/wAqKyw2NzhCQ0ROT1BXWFljZGVvcHF7fH1XZAQAAv//AAAAAA==',
  8511: 'QQAA/w0AAjEAAyMAAR7/AAAeHyQqKy8wNTY3ODs8PUBBREVGR0lKS0xRUlZXXV5QZAQAAv//AAAAAC8AAyEAARwA/wAbJicyMzQ5PT5AQURFRkhJTU5PUFJTVFpbX2ZnUGQEAAH//wAAAAA=',
  8512: 'QQEBAWQBAi4AAyAAARsAAP8kMDE8PT5ISUpLVVZXWGJjZGVmcHFyc3R/gIFQZAAAAfQBAAAAAC4AAyAAARsAAP8vOjtFRkdQUVJTW1xdXmVmZ2hpb3BxcnN6e3xQZAAAAfQBAAAAAA==',
  8513: 'Qf8AAC0AA3oAA2wABBv//wAFBgcQERMUGxwhJictLjEyO0lKUlNUVV9td3guAP8AEh0eHyAoKSorLDM0NTY3ODk6S0xQUVZXWFlaW1xdXm5vdXZ5ent8fX5/gIGCgwr/hwBAQUJDRGRlZmdoCACpAE1OT3BxcnN0UGQEAAL//wAAAAAYAAMKAAEF/74LDiI1PV5WZAAAAf//AAAAABgAAwoAAQX/fwAbIk9Vd1BkBgAB//8AAAAA',
  8514: 'QQEBATMBAi8AAyEAARz7VgcaGyAhJicsLUlSVldYW1xdY2RlZmdocHFyc31+VkEAAAFYAgAAAACLAAN9AAsGBQUFAAIEBggKJykAKQEDBQcJCwwNDg8QERITFBUWFxgaHB4gIiMkJigqLC4vMDQ2ODo7Qgr7VgcyZG1vcHFyc3V3AloAhDxAAYsA/0QB/38ARw5mAABOVnh5ent8fX5/gIGCgwTMWANibnR2ASwAb2gB/wBuagH//wBsUCgDAAFwFwAAAAA=',
  8515: 'QQD/ADAAATsAAy0ABAQA//8PEBMUEP//AB0eKSo0NTY3QEFCQ0xNTk8E/38AWFtkZwT/AABZWmVmVGQDAAL//wAAAAA=',
  8516: 'QQEBAWQAAZ8AA5EAA0T/AAAAAQIDBwgJDA0OEhMUGBkdHh8jJCgpKi4vMzQ1OTo7Pj9AREVGSUpLT1BRVFVWWltcX2BhZWZnamtscHFydXZ7fH2AgSkA/wAEBQoLDxAVFhobICElJissMDE2NzxBQkdMTVJXWF1iY2htbnN3eHl+ghf///8GERccIictMjg9Q0hOU1leZGlvdHp/g2RkBgAB//8AAAAA',
  8517: 'Qf+HrS0AAjMAAyUAASD/AAAMDRARGBkaGxwdJSYnKDIzWlteX2ZnaGlqa3N0dXaAgVJkAQAB//8AAAAAHgADEAABC/8AAAkUFSUxMkRPUGJ2WGQBAAL//wAAAAA=',
  8518: 'QQEBASwBAx8AAxEAAQz/AAAxMjs8P0ZMUVlcZmdfZAQAArgLAAAAADUAAycAASL/AAAmJygrLC0yMzQ1Njc4OT4/QEFCQ0RFS0xNTk9QWFlaW2VmWGQAAAHoAwAAAAA1AAMnAAEi/wAAJicoKywtMjM0NTY3ODk+P0BBQkNERUtMTU5PUFhZWltlZlRkAAAB6AMAAAAA',
  8519: 'Qf/Tb1oAAWwAA14AAVkA/wAAAgMEBQgJCgsNDg8QExQVFhgZGhseHyAhJCUmKSorLC8wMTQ1Njc6Ozw/QEFCRUZHSktMTVBRUlNVVldYW1xdXmBhYmNmZ2hpbG1ucXJzdHd4eXx9fn+Cg11kBgAC//8AAAAA',
  8520: 'QQEBAWQAAcMAA7UADA8A/wAAAQIDDA0ODxgZGhskJSYGgzjsBBARHB0eBYsA/wUGBxITEP//AAgJCgsUFRYXIiNub3h5ensL+1YHHyArLC0uLzg5OjsB/38AIQ8AAP8nKCkqNDU2N0BBQkNNTk8JAP//MDxIVFVgYWxtEv8AADEyMz0+P0lKS0xWV1hZYmNkZQz/vgtERUZHUFFSU1xdXl8Ma/F4WltmZ3BxcnN8fX5/DP8Abmhpamt0dXZ3gIGCg1ZkBgAB//8AAAAA',
  8521: 'QQEBAWQAAjEAAyMAAR4A/wAPEBscHScoKSoyMzQ1Njg5Oj9AQ0RFRk9QUVJTXl9cUAUAAv//AAAAADMAAyUAASAAAP8PEBscHScoKSoyMzQ1Njg5Oj9AQ0RFRkdPUFFSU15fajxZAAAC//8AAAAA',
  21780: 'Qf8AAD0AAVIAA0QAAiz//wAAAQIDBAUGBwgJCgsMDRAREhMWFx0eZWZsbXBxcnN2d3h5ent8fX5/gIGCgw////8xNTk8PT5AQUJERUZJTVFOZAMAAf//AAAAAA==',
  21781: 'QQAA/xgAA04AA0AAAxL///8yPT4/REhJS0xPUFFUWFlbXWUa/wAASlVXXGBkZ2lsbW9wc3V4eXp7fH1+f4CBgoMH//8AVmFiY2hudARkAwAB//8AAAAAGgADDAABB////xAgPUFTWoFUZAcAAv//AAAAACkAAxsAAg8A/wACDg8aGxwdHiYnKCkqKywD/wAABBARJmQEAAP//wAAAAA=',
  21782: 'QQD/AGQAAU8AA0EAAiT/AAACAwQICQ0ODxQVFxwdIiMlKClAQUZHTE1SU2RlcHF2d3x9goMU////ChARExYZHysuLzQ1OjtYWV5famsQZAQAAf//AAAAAA==',
  21783: 'Qf//AC0AAlgAA0oAAi3/AAASExQdHh8gISgpKi0uNDU2Oj9AQUJDS0xNTk9QVldYWVpbXGJjZGVmZ2hpbnUU////JC8wO0ZHb3BxcnN0ent8fX5/gIEQZAQAAf//AAAAACMAAxUAARAA/wAAAQIDBAUGBwgJCgsMDxIWMmQEAAL//wAAAAA=',
  21784: 'QQEBASUAAXUAA2cAAyr/AAAAAQMEBQcICw0ODxESExUWFxoeImBkaGxtb3Bxc3R1d3h5ent9fn+BgoMYAP8AGBwgJCUnKCkrLC0vMTIzNTY3OTo7PkJGGP//ADxAREhJS0xNT1BRU1VWV1laW11eX2JmajJkBAAB//8AAAAA',
  21785: 'Qf9/ABgAA0cAAzkAAiT/AAAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMMAP8ASElKS0xNTk9QUVJTMmQAAAH//wAAAABvAANhAAMk//8AGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7GAD/ADw9Pj9AQUJDREVGR3h5ent8fX5/gIGCgxj/AABgYWJjZGVmZ2hpamtsbW5vcHFyc3R1dndBZAAAAv//AAAAAFMAA0UAAiQA/wAYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5OjsY/38APD0+P0BBQkNERUZHSElKS0xNTk9QUVJTJWQAAAP//wAAAAA=',
  21786: 'Qf//AC0AAZ8AA5EAA0L/AAAAAQQHCAsMDRATFBcYGRwfICMkJSgrLC8wMTQ3ODs8PUBDREdISUxPUFNUVVhbXF9gYWRnaGtsbXBzdHd4eXx/gIM3AP8AAgMGCQoODxIVFhobHiEiJicqLS4yMzY5Oj4/QkVGSktOUVJWV1pdXmJjZmlqbm9ydXZ6e36Bggv//wAFER0pNUFNWWVxfTJkAwAB//8AAAAA',
  21787: 'Qf8AAGQAAWcAA1kAAywA/wABBAcKDRATFhkcHyIlKCsuMTQ3Oj1AQ0ZJTE9SVVhbXmFkZ2ptcHN2eXx/gh8AjAAYGhsdHiAhIyQnKSosLS9UVldZWlxdX2BiY2VmaGlrAQCpACYyZAQAAf//AAAAAA==',
  21788: 'Qf8AAB4AAVwAA04ABA///wAwMTM0PT9KVmBhYmNkbnoGiwD/QkZOT1FSEAD/AEhJS0xUVVdYbG1vcHh5e3wY/38AWltcXV5fZmdoaWprcnN0dXZ3fn+AgYKDMmQEAAH//wAAAAA=',
  21789: 'Qf8AACUAAVAAA0IAAwz//wADBAUHCBIgOj1RY3InAP8AEBETGhscHR4fISUnLC0uMTI5PkVGSUpSVVZXXF5iZGVmZ2hpcHFzAv8AACZdMmQEAAH//wAAAAA=',
  21790: 'QQAA/xgAAhsAAw0AAQj///8OEzY6SVZYdDJkBwAB//8AAAAAdAADZgAEFP///xESExQmJygpMTIzNDU2PD1CQ0hPJ/8AAB4fKis3Pj9AQUlKS0xNTlRVVldYWVpbYGNkZ2xvcHN4eXp7fH1+fxIA/wAtODk6REVGR1FcXV5oaWprdYEI//8AYWJlZm1ucXIQZAQAAv//AAAAAA==',
  21791: 'Qf8AADIAAhoAAwwAAQf///8LGiBAUlR/Q2QCAAH//wAAAABjAANVAAM0AP8ABA8RGhscHR4oKTIzNDU2Oj0+P0BBQ0ZLTVJTVldYWVpeYWJjZGVmZ2lrbG1vcXJzdHV2dwj//wAQJ0JMUWpucAz///94eXp7fH1+f4CBgoMyZAQAAv//AAAAAA==',
  21792: 'QQD/KigAA0kAAzsAAwb/AAAFBhAREhME////HB0eHyT/fwAoKSorNDU2N0FCSktMTU5PUFFWV1hZWltcXWVmcHFyc3t8f4A0ZAQAAf//AAAAABsAAw0AAgL/fwAhZgL//wAygTJkAgAC//8AAAAAHAADDgACA///AABlggL/fwAebEpkAgAD//8AAAAA',
  21793: 'QQD/ADIAATgAAyoAAhn/AAADBBMUHyAqKyw9PklKTU5UVVZdXmlqdHV2CP///wcIMTJCUVJ8Q2QHAAH//wAAAAA=',
  21794: 'QQAA/xkAAkgAAzoABA7/AAAREhMUHB0eHygpKitNThL///8hMzQ1Njc4S1BXWFtkZWZncXII/45CQEFCQ0xPWVoByMjIXDBkBAAB//8AAAAAIwADFQADBP8AAAAITm8CAP8AHXUC//8ALj1RZAIAAv//AAAAAA==',
  21795: 'Qf8AAAX/AzoAAywAAgT/AAAUFSAhH4sA/z5JSktOT1ZaW2JmZ2prbnJzdnd4eXp7fH1+f4CBgoMxZAQAAf//AAAAACwAAx4AARn///8FERIcHyAnLS4xMjQ1OzxCTk9aXGVocHSBYmQAAQH0AQAAAAAPAAMBAAAyZAABAeQRAAAAAA==',
  21796: 'QQAA/woAAj8AAzEAAwyLAP9gYWJjZGVmZ2hpamsWAP9hbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgQIA/1uCgwBkAAAB//8AAAAALQADHwABGgD/AAIGDRkcIictNDo9QENGS09TX2VqbXN5fH+DUGQBAAL//wAAAAA=',
  21797: 'QQAA/xn/Ay0AAx8AARqLAP8ICRQeHyAmJyoyPD0+SFFSXWNkZ2hpbm9zelxkBQAB//8AAAAAMAADIgABHcjIyAMLDxccIigpKi0zNzg6Pj9DR0lLUFRXXWRpcXZ9YmQAAQIUBQAAAAAPAAMBAAAyZAABATwZAAAAAA==',
  21798: 'QS0Aiw8AAjcAAykABA2LAP8dHiorTk9ZWltkZWZnBP+RdjY3QkMF/38AVWBhYm0C/7I2Y2hTZAQAAf//AAAAAE8AA0EABAzRtAAAAQIDBAUGBwgJCgsMgngADA0ODxAREhMUFRYXDFBQABgZGhscHR4fICEiIwwyMgAkJSYnKCkqKywtLi8AZAEAAv//AAAAAA==',
  21799: 'QQAA/xQAAlgAA0oACAH//wBECf9/AExNV1hZWmNkZQP/UwBOT1sB////UwP/AABfa3cI/0ACYmZnaG9xc3QIAIwAbnJ1eXt9gIIIAP8AcHh6fH5/gYMAZAQAAf//AAAAAB0AAw8AAQrIyMgEEic0QEtOV1p8SmQBAAL//wAAAAA=',
  23040: 'Qf9oXyMAAcMAA7UADAj/sz8ADA0YGRolJgH/nAABBvq1AAIDBA4PGwr/oEsFBhARHB0nKDM0Hv93NgcIEhMUHh8gKSorLC01Njc4OTpAQUJDREVGTVBRUgr/sDUJCgsVFhchIiMuB/9iViQwMTI8SFQR/2Q/LztHTk9TXF1eX2hpamt2d4MC/zs6PWAl/0ACPj9JSktVVldYWVpbYWJjZGVmZ2xtb3BxcnN0dXh5fH1+f4CBggH/aUpMA/9TAG56ez9kAwAB//8AAAAA',
  8522: 'QQEBAWQAAn8AA3EABAz/2DEAAQIDBAUGBwgJCgsY/8xBDA0ODxAREhMUFRYXVFVWV1hZWltcXV5fHv/wbBgZGhscHR4fICEiIyQlJicoKSorLC0uL0hJSktMTR7/8JAwMTIzNDU2Nzg5Ojs8PT4/QEFCQ0RFRkdOT1BRUlMyZAQAAf//AAAAAGYAA1gAAzv/XyguMDQ5Ojs8PT9AQURFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl9gYWJjZGVmZ2hpamtsbW5vcHFycwT7Vgd0dXZ3DP8AAHh5ent8fX5/gIGCg1FYAwAB//8AAAAA',
  47: '',
  8523: 'QQOrNjQAA5MAA4UAAxIAvtsAAQIDBAUGBwgJCgsNDxETFRdUHP9aDA4QEhQWGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PT9BQ0VHSEpMTlBSVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG5wcnR2Eo3/G21vcXN1d3h5ent8fX5/gIGCg1VkAwAC//8AAAAAPwADMQADCf//ACQlJicoKSorLBL/fwBISUpLTE1OT1BgYWJjZGVmZ2gJ/74LeHl6e3x9fn+APEYEAAH//wAAAAA/AAMxAAMJ//8AGxwdHh8gISIjEv9/ADM0NTY3ODk6O1dYWVpbXF1eXwn/vgt7fH1+f4CBgoM8RgMAAf//AAAAAA==',
  8524: 'QQEBAWQAAbMAA6UACCQAAP8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhd4eXp7fH1+f4CBgoMMiwD/GBkaGxwdHh8gISIjDP8AbiQlJicoKSorLC0uLwz/AAAwMTIzNDU2Nzg5OjsY/38APD0+P0BBQkNERUZHSElKS0xNTk9QUVJTDOmFh1RVVldYWVpbXF1eXwwA//9gYWJjZGVmZ2hpamsMBlHBbG1ub3BxcnN0dXZ3XWQBAAH//wAAAAA=',
  8525: 'QWwApRcAAm8AA2EAAwwAAP8AAQIDBAUGBwgJCgseSxm3DA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJScpKy0vKmwApSQmKCosLjAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSUzIGAwAC//8AAAAAPwADMQADEuZhFWBiZGZoamxtbm9wcXJzdHV2dwa0FBRhY2VnaWsM/8Y0eHl6e3x9fn+AgYKDSzwDAAH//wAAAAA=',
  8526: 'QQEBATIAAVUAA0cAAiqLAP8LDBYXGBkhIiMkJSYsLS4xMjM3ODk/QEFCQ0pLT1BVVlxdYGFpamx2d4MUAAD/LzA6Ozw9PkRFRkdISVFSU1ReX2tWZAQAAv//AAAAAA==',
  8527: 'QQEBAVYAA3UAA2cAAzAA/wAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGhweICIlJykrLS8wMjQ2ODo9P0FDRUcpxP8AGRsdHyEjJCYoKiwuMTM1Nzk8PkBCREZISUpLTE1OT1BRUlNUVlhaXF4B1/8AO05fBAAB//8AAAAAdQADZwADJP/wkCUnKSstLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hKTE5QUhL/8GxJS01PUVNUVVZXWFlaW1xdXl8k/9gxYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDC2QDAAL//wAAAABLAAM9AAMYcv9yDQ8RExUXGBkaGxwdHh8gISIjPD5AQkRGDAD/ACQlJicoKSorLC0uLwz/8JAwMTIzNDU2Nzg5Ojs8ZAEAAf//AAAAAA==',
  8528: 'QQEBAWQAA2gAA1oAAyMWgCUYGRwdHiEiIyQlJiwtLi8yMzQ1Nzg5Ojs8P0BGR0xNTk9TWR4AlhRISUpLUFFSVFVWV1haW1xdXl9gYWJjZGVmZ2hpamsMAAD/bG1ub3BxcnN0dXZ3UmQEAAH//wAAAACLAAN9AAQM//8AAAECAwQFBgcICQoLFP//ZQwNDg8QERITFBUWFxkdICIpKjA6PP/wkBgaGxweHyEjJTEyMzw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqaxD/8GwkJicoKywtLi80NTY3ODk7MWQDAAP//wAAAAB7AANtAAMhFoAlGBkcHR4hIiMkJSYtLi8yMzQ1ODk6Ozw/QEZHTE1OT1NZIQAA/xobHyAnKCkqKywwMTY3PT5BQkNERWxtbm9wcXJzdHV2dx4AlhRISUpLUFFSVFVWV1haW1xdXl9gYWJjZGVmZ2hpamtSUAMAAv//AAAAAA==',
  8529: 'QQEBAWQAA18AA1EAAiT7Vgc8PT4/QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8k/wAAYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDUFABAAL//wAAAAC3AAOpAAkU+1YHAAIkMDQ1NjxISVVaYGhpbG5ydXYp/6sFAQoLDA0ODxYXGB4iIyUnKSorLC4vPT4/QEJFRkdSU1RWWFldXl9mamsF/74LAwRXb3AM8XMABQYQEhkcHSYoQURzFv+VBQcICRMUFR8gIS03ODlDTU5PW2FiZXEF/wAAERobUG0M/38AMTIzOjtKS0xjZGd3A8xYA1FcdAz/hgB4eXp7fH1+f4CBgoNOZAMAA///AAAAACsAAx0AARj/vgtISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl9aZAIAAf//AAAAAA==',
  8530: 'QQEBAWQAA1MAA0UAAh7/fwAAAQIDBAUGBwgJCgtKS0xPUFFsbW5vcHFyc3R1dnce/xYAGBkaGxwdHh8gISIjJCUmJygpKissLS4vSElNTlJTUkYDAAH//wAAAABYAANKAAFF/38AAAECAwQFBgcICQoLGBkaGxwdHh8gISIjJygpKissLS4vSElKS0xNTk9QVFVWV1hZWltccnN0dXZ3eHl6e3x9fn+AgYKDWmQDAAL//wAAAACjAAOVAAQM/38AAAECAwQFBgcICQoLJ65AKAwNDg8QERITFBUWFzw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1dYWSb/2DEYGRobHB0eHyAhIiMmJygpKissLS4vXHV2d3h5ent8fX5/gIGCgyv/zEEkJTAxMjM0NTY3ODk6O1RVVlpbXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0WmQEAAL//wAAAAA=',
  8531: 'QQEBAWQAAnsAA20AAz8AAP8MDQ4PEBESExQVFhc8PT4/QEFCQ0RFRkdISUpLTE1OT1BRUlNXXF1ebG1ub3BxcnN0dXZ3eXp7fH1+f4CBgoMgAP//MDEyMzQ1Njc4OTo7VFVWWFlaW19gYWJjZGVmZ2hpamsBBlHBeDJkBAAB//8AAAAAcQADYwAGGAAA/wABAgMEBQYHCAkKCwwNDg8QERITFBUWFww+z+QYGRobHB0eHyAhIiMM////JCUmJygpKissLS4vCoM47Dw9PkFCQ0RFRkcE//CQWltcXQwhLb5sbW5vcHFyc3R1dndTWwMAAv//AAAAAA==',
  8532: 'QQEBAUMAA4AAA3IABQz/fwAAAQIDBAUGBwgJCgsff0IAJCUmJyorLC0uL1RVVldYWVpbXF1eX21ub3BzdHV2dxr/zEEoKTAxMjM0NTY3ODk6O0hJSktMTU5PUFFSUxf/hgBgYWJjZGVmZ2hpamt4eXp7fH1+f4CBggH/nzyDVloDAAH//wAAAAB/AANxAAQMrkAoAAECAwQFBgcICQoLJP+fPAwNDg8QERITFBUWFyQlJicoKSorLC0uLzAxMjM0NTY3ODk6OxgA//8YGRobHB0eHyAhIiM8PT4/QEFCQ0RFRkcY+sGGYGFiY2RlZmdoaWpreHl6e3x9fn+AgYKDT1oDAAL//wAAAAAbAAMNAAEI/wAAQkNERU5PUFFaVAMAAf//AAAAAA==',
  8533: 'QQAA/xUAAj0AAy8ACAH//wAiAQD//ykBxQA/LAL/fwAxSQP/8Gw8PT4EAAD/Tk9aWwEA/wBjATH/k3hVXwcAAf//AAAAAFEAA0MAAxH//wAKCxUWICssNjdBQkxNV2JteBj/4BYXISIjLS44OUNETk9YWVpjZGVub3B5ensNby29U11eX2hpanN0dX5/gChkBwAB//8AAAAA',
  20901: 'AFI6ZAwAAP8A//+lvv4XWv4=',
  'Gleam': 'AFMAIxX/AAD/fwD//wAA/wAAAP8A//+LAP8=',
  20902: 'QSYA/yMAA0wAAz4AAx60tMgECBETHR8pKzU3QEFCQ0RLTE1OT1BRV1hcXWNpcHQI+wBFEBQcICgsNDgL////WVpbZGVmZ2hxcnM0ZAQAAf//AAAAABcAAwkAAQT7AEUWHElpMmQAAAL//wAAAAAXAAMJAAEE+wBFAUJudEVkAAAD//8AAAAA',
  20903: 'Qf87gx4AA1oAA0wABAb/AAAOFhobISIG/0ACHCYnKTM0B/89ASAoKywtLjko/38AKjU2Nzg/QEFCQ0RFSktMTU5PUFFSVldYWVpbXF1eY2RlZmdoaXFyczRkBAAB//8AAAAAGQADCwABBv//AA4XNV1hgzJkAAAC//8AAAAAGQADCwABBv//ABcZH01udkRkAAAD//8AAAAA',
  20904: 'QQEBAWQAAjYAAygAASMAAP8BAgcIDA0SExgdHigpMzQ7Pj9GR0lKUVJUVVxdYGdocnN9flFkBwAB//8AAAAANgADKAABI/9TAAQFDxAXGhsiIyUmLS4wMTg5PENETk9ZWmRla29wdnd6e4GCU2QGAAL//wAAAAA=',
  20905: 'QQEBAWQAAyMAAxUAARAAAP8HCBITHR4oKTM0Pj9JSlRVYmQGAAH//wAAAAAwAAMiAAMKiwD/BRARGxwmJzEyPQb/AGFERU9QWlsF/2hJZWZwcXxeZAYAAv//AAAAALMAA6UACBj/aUoAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcM7TSlGBkaGxwdHh8gISIjDGwApSQlJicoKSorLC0uLxgAAP8wMTIzNDU2Nzg5Ojs8PT4/QEFCQ0RFRkcMQE7KSElKS0xNTk9QUVJTDJk6w1RVVldYWVpbXF1eXxj/O4NgYWJjZGVmZ2hpamtsbW5vcHFyc3R1dncM/0ACeHl6e3x9fn+AgYKDPmQHAAP//wAAAAA='
};

const SCENE_CATEGORIES = {
  'Custom': ['Fast Fire'],
  'Natural': [8478, 8479, 42, 8480, 8481, 44, 43, 46, 41, 8482, 8483, 8484, 40, 8485, 8486, 8487, 8488, 8489, 8490, 8491, 8492, 8493, 8494, 8495, 8496],
  'Life': [99, 35, 38, 8497, 8498, 8499, 8500, 8501, 8502, 8503, 8504, 'Breathe', 'Gradient', 'Fire', 'Rainbow', 'Dream 1', 'Dream 2', 'Graffiti 1', 'Graffiti 2', 'Graffiti 3', 20901, 45, 8509, 8510, 8511, 8512, 'Gleam'],
  'Festival': [8513, 8514, 8515, 8516, 8517, 8518, 8519, 8520, 8521, 21780, 21781, 21782, 21783, 21784, 21785, 21786, 21787, 21788, 21789, 21790, 21791, 21792, 21793, 21794, 21795, 21796, 21797, 21798, 21799, 23040],
  'Sleep': [8522, 47, 8523, 8524, 8525, 8526, 8527],
  'Starry Sky': [8528, 8529, 8530, 8531, 8532, 8533],
  'Sound': ['Flash (Sound)', 'Spin (Sound)', 'Lightning (Sound)'],
  'Other': [20902, 20903, 20904, 20905]
};

let activeSceneCategory = 'Natural';
let activeSceneKey = null;
const SCENE_LED_COUNT = 132;

const MANUAL_SCENE_PREVIEWS = {
  35: '#ffe8b8',
  38: '#e99a45',
  40: 'linear-gradient(135deg,#5a160d 0%,#b73319 60%,#ff6a21 100%)',
  41: 'linear-gradient(135deg,#10265a 0%,#183d78 80%,#a7b9ff 100%)',
  42: 'linear-gradient(135deg,#e76f7a 0%,#e9a955 18%,#e3d76a 34%,#77c86e 50%,#61bfd0 66%,#6b86d6 82%,#a276c7 100%)',
  43: 'linear-gradient(135deg,#353d91 0%,#4a3aa1 70%,#e077bb 78%,#64d28b 86%,#64cfe3 94%,#e3cf65 100%)',
  44: 'linear-gradient(135deg,#1f8a4f 0%,#1f8a4f 50%,#d1c84d 100%)',
  45: 'linear-gradient(135deg,#ff3f5f 0%,#ff8a24 17%,#ffe047 34%,#35d65f 50%,#26c8ff 66%,#4f6cff 83%,#b64cff 100%)',
  46: 'linear-gradient(135deg,#244f86 0%,#244f86 60%,#2f96e8 100%)',
  47: 'linear-gradient(135deg,#332a9a 0%,#332a9a 70%,#d58adf 100%)',
  99: '#dceaff',
};

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let rgb = [0, 0, 0];

  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return rgb.map(v => Math.round((v + m) * 255));
}

function fallbackScenePreviewGradient(key) {
  const label = SCENE_NAMES[key] || String(key || 'scene');
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) >>> 0;
  }

  const h1 = hash % 360;
  const h2 = (h1 + 42 + (hash % 48)) % 360;
  const h3 = (h1 + 196 + (hash % 72)) % 360;
  const c1 = rgbToHex(hslToRgb(h1, 0.78, 0.58));
  const c2 = rgbToHex(hslToRgb(h2, 0.70, 0.50));
  const c3 = rgbToHex(hslToRgb(h3, 0.76, 0.60));

  return `linear-gradient(135deg,${c1} 0%,${c2} 52%,${c3} 100%)`;
}

function gradientWithOpacity(gradient, opacity) {
  const alpha = Math.max(0, Math.min(1, opacity));
  return gradient
    .replace(/#([0-9a-f]{6})/gi, (_, h) =>
      `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`)
    .replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/gi, `rgba($1,$2,$3,${alpha})`)
    .replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/gi, `rgba($1,$2,$3,${alpha})`);
}

function asCssImage(value) {
  return String(value).startsWith('linear-gradient')
    ? value
    : `linear-gradient(${value},${value})`;
}

function firstGradientRgb(gradient) {
  const hex = gradient.match(/#([0-9a-f]{6})/i);
  if (hex) return [
    parseInt(hex[1].slice(0,2), 16),
    parseInt(hex[1].slice(2,4), 16),
    parseInt(hex[1].slice(4,6), 16),
  ];

  const rgb = gradient.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function colorDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function addSceneColorCluster(clusters, rgb, weight, first) {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const saturation = max - min;
  const brightness = (rgb[0] + rgb[1] + rgb[2]) / 3;

  if (max < 75 || saturation < 34 || brightness < 24) return;
  if (rgb.every(v => v > 235) || rgb.every(v => v < 18)) return;

  const cluster = clusters.find(c => colorDistance(c.rgb, rgb) < 82);

  if (cluster) {
    const previousWeight = cluster.weight;
    cluster.weight += weight;
    cluster.rgb = cluster.rgb.map((v, idx) => Math.round((v * previousWeight + rgb[idx] * weight) / cluster.weight));
  } else {
    clusters.push({ rgb, weight, first });
  }
}

function parseMatrixSceneColors(raw) {
  const clusters = [];
  let pos = 7;
  const blocks = raw[6];
  const parsedBlocks = [];

  for (let block = 0; block < blocks; block++) {
    if (pos + 5 >= raw.length) return [];

    const groupBytes = raw[pos] - 15;
    const groupCount = raw[pos + 5];
    const groupStart = pos + 6;
    const groupEnd = groupStart + groupBytes;
    if (groupBytes < 0 || groupEnd > raw.length) return [];

    pos = groupStart;
    const groups = [];
    for (let group = 0; group < groupCount; group++) {
      if (pos + 3 >= groupEnd) return [];

      const ledCount = raw[pos++];
      const rgb = [raw[pos++], raw[pos++], raw[pos++]];
      if (pos + ledCount > groupEnd) return [];

      groups.push({ rgb, indices: raw.slice(pos, pos + ledCount), first: pos });
      pos += ledCount;
    }

    const tail = raw.slice(groupEnd, groupEnd + 11);
    parsedBlocks.push({ groups, zOrder: tail[4] || block + 1 });
    pos = groupEnd + tail.length;
  }

  const bgBrightness = raw[4];
  const pixels = Array(SCENE_LED_COUNT).fill(null);
  if (bgBrightness > 0) {
    const bg = raw.slice(1, 4).map(v => Math.round(v * bgBrightness / 100));
    pixels.fill({ rgb: bg, first: 1 });
  }

  parsedBlocks
    .sort((a, b) => b.zOrder - a.zOrder)
    .forEach(block => {
      block.groups.forEach(group => {
        group.indices.forEach(index => {
          if (index >= 0 && index < SCENE_LED_COUNT) {
            pixels[index] = { rgb: group.rgb, first: group.first };
          }
        });
      });
    });

  const visible = new Map();
  pixels.forEach(pixel => {
    if (!pixel) return;
    const key = pixel.rgb.join(',');
    if (!visible.has(key)) {
      visible.set(key, { rgb: pixel.rgb, weight: 0, first: pixel.first });
    }
    const color = visible.get(key);
    color.weight += 1;
    color.first = Math.min(color.first, pixel.first);
  });

  visible.forEach(color => addSceneColorCluster(clusters, color.rgb, color.weight, color.first));
  return clusters;
}

function parseShortPresetSceneColors(raw) {
  if (raw.length < 5) return [];

  const clusters = [];
  const paletteLen = raw[4];
  const paletteStart = 5;
  const paletteEnd = paletteStart + paletteLen;
  if (paletteLen < 6 || paletteLen % 3 !== 0 || paletteEnd > raw.length) return [];

  for (let pos = paletteStart; pos < paletteEnd; pos += 3) {
    addSceneColorCluster(clusters, [raw[pos], raw[pos + 1], raw[pos + 2]], 1, pos);
  }

  return clusters;
}

function extractSceneColorWeights(sceneParamBase64) {
  if (!sceneParamBase64) return [];

  let raw;
  try {
    raw = Array.from(atob(sceneParamBase64), c => c.charCodeAt(0));
  } catch {
    return [];
  }

  const clusters = raw[0] === 0x41
    ? parseMatrixSceneColors(raw)
    : raw[0] === 0x00
      ? parseShortPresetSceneColors(raw)
      : [];

  return clusters
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .sort((a, b) => a.first - b.first);
}

function weightedSceneGradient(colors, opacity = 1) {
  const total = colors.reduce((sum, c) => sum + c.weight, 0);
  let acc = 0;
  const stops = [];

  colors.forEach((color, idx) => {
    const span = (color.weight / total) * 100;
    const pos = idx === 0 ? 0 : idx === colors.length - 1 ? 100 : acc + span / 2;
    const [r, g, b] = color.rgb;
    const c = opacity === 1 ? rgbToHex(color.rgb) : `rgba(${r},${g},${b},${opacity})`;
    stops.push(`${c} ${pos.toFixed(1)}%`);
    acc += span;
  });

  return `linear-gradient(135deg,${stops.join(',')})`;
}

function scenePreviewGradient(key) {
  const colors = extractSceneColorWeights(SCENE_PARAMS[key]);
  if (colors.length === 1) {
    return rgbToHex(colors[0].rgb);
  }

  if (colors.length >= 2) {
    return weightedSceneGradient(colors);
  }

  return MANUAL_SCENE_PREVIEWS[key] || fallbackScenePreviewGradient(key);
}

function edgeGlowShadow(colors) {
  // corners matching the 135deg gradient direction (top-left → bottom-right)
  const corners = [[7, 7], [-7, -7], [-7, 7], [7, -7]];
  const n = Math.min(colors.length, 4);
  const picks = n === 1 ? [colors[0]]
    : Array.from({ length: n }, (_, i) => colors[Math.round(i * (colors.length - 1) / (n - 1))]);

  return picks.map((c, i) => {
    const [r, g, b] = c.rgb;
    const [ox, oy] = corners[i];
    return `inset ${ox}px ${oy}px 4px rgba(${r},${g},${b},0.14)`;
  }).join(', ');
}

function applySceneCardStyle(badge, key) {
  const colors = extractSceneColorWeights(SCENE_PARAMS[key]);
  let gradient, gradientDim;

  if (colors.length >= 1) {
    gradient = colors.length === 1 ? rgbToHex(colors[0].rgb) : weightedSceneGradient(colors);
    gradientDim = colors.length === 1
      ? `rgba(${colors[0].rgb.join(',')},0.4)`
      : weightedSceneGradient(colors, 0.4);
    badge._sceneDominant = colors.reduce((m, c) => c.weight > m.weight ? c : m).rgb;
  } else {
    gradient = MANUAL_SCENE_PREVIEWS[key] || fallbackScenePreviewGradient(key);
    gradientDim = gradientWithOpacity(gradient, 0.4);
    badge._sceneDominant = firstGradientRgb(gradient);
  }

  badge._sceneGradient = gradient;
  badge._sceneColors = colors.length >= 1 ? colors : null;
  badge.style.setProperty('--sg', asCssImage(gradient));
  badge.style.setProperty('--sg-dim', asCssImage(gradientDim));
}

function sgPresetPreviewGradient(presetData) {
  if (!Array.isArray(presetData?.palette) || !presetData.palette.length) return fallbackScenePreviewGradient('custom-simple');
  const colors = presetData.palette
    .map(hex => ({ rgb: hexToRgb(hex), weight: 1 }))
    .filter(c => c.rgb.some(v => v > 0));
  if (!colors.length) return '#333';
  if (colors.length === 1) return rgbToHex(colors[0].rgb);
  return weightedSceneGradient(colors);
}

async function activateSgPresetByData(presetData, displayName = null) {
  const scene = typeof resolveSgSceneConfig === 'function'
    ? resolveSgSceneConfig(presetData)
    : SIMPLE_SCENE_TYPES[presetData.selectedType ?? 0];
  if (!scene) throw new Error('Invalid scene type');
  const colors = (presetData.palette ?? []).map(hexToRgb);
  await activateSimpleScene(scene.type, scene.subtype, presetData.speed ?? 50, colors);
  const label = displayName || `${scene.name} (Custom)`;
  if (typeof rememberActiveScene === 'function') {
    rememberActiveScene(displayName ? `sg:${displayName}` : 'sg:', 15626, label, sgPresetPreviewGradient(presetData));
  }
  assumeLightOn({ musicMode: false, sceneCode: 15626, modeDisplay: { kind: 'scene', label } });
  if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
}

function matrixPresetPreviewGradient(presetData) {
  if (!presetData) return '#333';

  const colorMap = new Map();
  if (Array.isArray(presetData.background) && Number(presetData.bg_brightness) > 0) {
    const bg = presetData.background
      .slice(0, 3)
      .map(c => Math.round(Math.max(0, Math.min(255, Number(c) || 0)) * Math.max(0, Math.min(100, presetData.bg_brightness)) / 100));
    colorMap.set(bg.join(','), SCENE_LED_COUNT);
  }

  const sourceLayers = Array.isArray(presetData.layers)
    ? presetData.layers
    : [{ groups: presetData.groups }];

  sourceLayers.forEach(layer => {
    if (!Array.isArray(layer?.groups)) return;
    layer.groups.forEach(group => {
      if (!Array.isArray(group.color) || group.color.length !== 3) return;
      const r = Math.max(0, Math.min(255, Number(group.color[0]) || 0));
      const g = Math.max(0, Math.min(255, Number(group.color[1]) || 0));
      const b = Math.max(0, Math.min(255, Number(group.color[2]) || 0));
      const weight = Array.isArray(group.leds) ? group.leds.length : 1;
      const key = `${r},${g},${b}`;
      colorMap.set(key, (colorMap.get(key) || 0) + weight);
    });
  });

  if (!colorMap.size) return fallbackScenePreviewGradient('custom-matrix');

  const colors = Array.from(colorMap.entries())
    .map(([key, weight]) => ({ rgb: key.split(',').map(Number), weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  if (colors.length === 1) return rgbToHex(colors[0].rgb);
  return weightedSceneGradient(colors);
}

function applyCustomPresetCardStyle(badge, gradient) {
  badge._sceneGradient = gradient;
  badge._sceneDominant = firstGradientRgb(gradient);
  const gradientDim = gradientWithOpacity(gradient, 0.4);
  badge.style.setProperty('--sg', asCssImage(gradient));
  badge.style.setProperty('--sg-dim', asCssImage(gradientDim));
}

function simpleSceneDisplayNameFromPreset(presetData) {
  const scene = typeof resolveSgSceneConfig === 'function'
    ? resolveSgSceneConfig(presetData)
    : SIMPLE_SCENE_TYPES[presetData?.selectedType ?? 0];
  return scene ? scene.name : 'Custom Scene';
}

async function activateMatrixPresetByData(presetData, displayName = null) {
  const state = matrixEditorStateFromPreset(presetData);
  if (!state) throw new Error('Invalid matrix preset data');
  let param = buildMatrixSceneParam(state.layers, state.bgColor, state.bgBrightness);
  if (param[0] === 0x41) param = [0x58, 0x5A, ...param.slice(1)];
  const packets = buildA3MultiPacket(param);
  packets.push(finish([0x33, 0x05, 0x04, 0x4c, 0x21]));
  await sendPackets(packets);
  const label = displayName || 'Custom Matrix';
  if (typeof rememberActiveScene === 'function') {
    rememberActiveScene(displayName ? `matrix:${displayName}` : 'matrix:', 8524, label, matrixPresetPreviewGradient(presetData));
  }
  assumeLightOn({ musicMode: false, sceneCode: 8524, modeDisplay: { kind: 'scene', label } });
  if (typeof refreshCustomSceneGrid === 'function') refreshCustomSceneGrid();
}

function renderSceneGrid() {
  const grid = document.getElementById('sceneGrid');
  const search = document.getElementById('sceneSearch').value.toLowerCase();
  grid.innerHTML = '';

  const scenes = SCENE_CATEGORIES[activeSceneCategory] || [];
  for (const key of scenes) {
    const rawName = typeof key === 'string' ? key : SCENE_NAMES[key];
    if (!rawName) continue;
    const name = rawName.replace(/ \(Sound\)$/, '');
    if (search && !name.toLowerCase().includes(search)) continue;

    const badge = document.createElement('button');
    badge.className = 'scene-badge';
    badge.title = typeof key === 'string' ? key : `Code ${key}`;
    badge.dataset.sceneCode = typeof key === 'number' ? key
      : key === 'Gradient' ? 8506
      : (key === 'Dream 1' || key === 'Dream 2') ? 8508
      : (key === 'Graffiti 1' || key === 'Graffiti 2' || key === 'Graffiti 3') ? 8507
      : 8505;
    badge.dataset.sceneKey = String(key);

    applySceneCardStyle(badge, key);

    const inner = document.createElement('div');
    inner.className = 'scene-badge__inner';

    const label = document.createElement('span');
    label.className = 'scene-name';
    label.textContent = name;

    const numCode = parseInt(badge.dataset.sceneCode);
    const isFav = (currentState?.scenePresetList || []).includes(numCode);
    const favBtn = document.createElement('button');
    favBtn.className = 'scene-fav-btn' + (isFav ? ' active' : '');
    favBtn.innerHTML = isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG;
    favBtn.title = isFav ? 'Remove from presets' : 'Add to presets';
    favBtn.setAttribute('aria-label', isFav ? 'Remove from presets' : 'Add to presets');
    favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    favBtn.dataset.sceneCode = numCode;
    favBtn.onclick = (e) => { e.stopPropagation(); toggleSceneFavourite(numCode); };

    inner.append(label, favBtn);
    badge.append(inner);
    badge.onclick = async () => {
      if (!isConnected()) return;
      try {
        const param = SCENE_PARAMS[key];
        const code = typeof key === 'string'
          ? (key === 'Breathe' || key === 'Fire' || key === 'Rainbow' || key === 'Gleam' || key === 'Fast Fire' || key === 'Flash (Sound)' || key === 'Spin (Sound)' || key === 'Lightning (Sound)' ? 8505
            : key === 'Gradient' ? 8506
            : key === 'Dream 1' || key === 'Dream 2' ? 8508
            : key === 'Graffiti 1' || key === 'Graffiti 2' || key === 'Graffiti 3' ? 8507
            : 8505)
          : key;
        const sceneLabel = typeof key === 'string' ? name : (SCENE_NAMES[code] || `#${code}`);
        if (typeof rememberActiveScene === 'function') {
          rememberActiveScene(String(key), code, sceneLabel, scenePreviewGradient(key));
        } else {
          activeSceneKey = String(key);
        }
        await runBleTransaction('Scene', async () => {
          await activateScene(code, param);
          assumeLightOn({ musicMode: false, sceneCode: code, modeDisplay: { kind: 'scene', label: sceneLabel } });
          await new Promise(r => setTimeout(r, 200));
          currentState = mergeState(currentState, await queryModeState());
        });
        updateUI(currentState);
      } catch (e) {
        log('err', `Scene: ${e.message}`);
      }
    };
    grid.appendChild(badge);
  }

  if (activeSceneCategory === 'Custom') {
    const sgPresets = loadSgPresets();
    for (const [name, presetData] of Object.entries(sgPresets).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (search && !name.toLowerCase().includes(search)) continue;

      const badge = document.createElement('button');
      badge.className = 'scene-badge';
      badge.title = name;
      badge.dataset.sceneCode = 15626;
      badge.dataset.sceneKey = `sg:${name}`;

      applyCustomPresetCardStyle(badge, sgPresetPreviewGradient(presetData));

      const inner = document.createElement('div');
      inner.className = 'scene-badge__inner';
      const label = document.createElement('span');
      label.className = 'scene-name';
      label.textContent = name;
      inner.appendChild(label);
      badge.appendChild(inner);

      badge.onclick = async () => {
        if (!isConnected()) return;
        try {
          if (typeof rememberActiveScene === 'function') {
            rememberActiveScene(`sg:${name}`, 15626, name, sgPresetPreviewGradient(presetData));
          } else {
            activeSceneKey = `sg:${name}`;
          }
          await runBleTransaction('Scene', async () => {
            await activateSgPresetByData(presetData, name);
            assumeLightOn({ musicMode: false, sceneCode: 15626, modeDisplay: { kind: 'scene', label: name } });
            await new Promise(r => setTimeout(r, 200));
            currentState = mergeState(currentState, await queryModeState());
          });
          updateUI(currentState);
        } catch (e) {
          log('err', `Custom scene: ${e.message}`);
        }
      };

      grid.appendChild(badge);
    }

    const presets = loadMatrixPresets();
    const presetNames = Object.keys(presets).sort((a, b) => a.localeCompare(b));
    for (const name of presetNames) {
      if (search && !name.toLowerCase().includes(search)) continue;

      const presetData = presets[name];
      const badge = document.createElement('button');
      badge.className = 'scene-badge';
      badge.title = name;
      badge.dataset.sceneCode = 8524;
      badge.dataset.sceneKey = `matrix:${name}`;

      applyCustomPresetCardStyle(badge, matrixPresetPreviewGradient(presetData));

      const inner = document.createElement('div');
      inner.className = 'scene-badge__inner';
      const label = document.createElement('span');
      label.className = 'scene-name';
      label.textContent = name;
      inner.appendChild(label);
      badge.appendChild(inner);

      badge.onclick = async () => {
        if (!isConnected()) return;
        try {
          if (typeof rememberActiveScene === 'function') {
            rememberActiveScene(`matrix:${name}`, 8524, name, matrixPresetPreviewGradient(presetData));
          } else {
            activeSceneKey = `matrix:${name}`;
          }
          await runBleTransaction('Scene', async () => {
            await activateMatrixPresetByData(presetData, name);
            assumeLightOn({ musicMode: false, sceneCode: 8524, modeDisplay: { kind: 'scene', label: name } });
            await new Promise(r => setTimeout(r, 200));
            currentState = mergeState(currentState, await queryModeState());
          });
          updateUI(currentState);
        } catch (e) {
          log('err', `Matrix preset: ${e.message}`);
        }
      };

      grid.appendChild(badge);
    }
  }

  if (typeof highlightActiveScene === 'function' && currentState) {
    highlightActiveScene(currentState.musicMode ? null : currentState.sceneCode);
  }
}

function refreshCustomSceneGrid() {
  if (activeSceneCategory === 'Custom') renderSceneGrid();
}

function updateFavButtons() {
  const list = currentState?.scenePresetList || [];
  document.querySelectorAll('.scene-fav-btn').forEach(btn => {
    const code = parseInt(btn.dataset.sceneCode);
    const isFav = list.includes(code);
    btn.classList.toggle('active', isFav);
    btn.innerHTML = isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG;
    btn.title = isFav ? 'Remove from presets' : 'Add to presets';
    btn.setAttribute('aria-label', isFav ? 'Remove from presets' : 'Add to presets');
    btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
  });
}

function switchSceneCategory(cat) {
  activeSceneCategory = cat;
  setSegmentValue('sceneTabs', 'cat', cat);
  document.querySelectorAll('#sceneTabs .scene-tab').forEach(b => {
    b.setAttribute('aria-selected', b.dataset.cat === cat ? 'true' : 'false');
  });
  renderSceneGrid();
}

function initSceneTabs() {
  const tabs = document.getElementById('sceneTabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Scene categories');
  for (const cat of Object.keys(SCENE_CATEGORIES)) {
    const btn = document.createElement('button');
    btn.className = 'scene-tab';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', cat === activeSceneCategory ? 'true' : 'false');
    btn.onclick = () => switchSceneCategory(cat);
    tabs.appendChild(btn);
  }
  setSegmentValue(tabs, 'cat', activeSceneCategory);
  document.getElementById('sceneSearch').oninput = renderSceneGrid;
  renderSceneGrid();
}

document.addEventListener('DOMContentLoaded', initSceneTabs);
