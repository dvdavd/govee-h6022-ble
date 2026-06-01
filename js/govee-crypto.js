// govee-crypto.js — AES-128-ECB + RC4 hybrid cipher, packet construction

const STATIC_KEY = new Uint8Array([0x4d, 0x61, 0x6b, 0x69, 0x6e, 0x67, 0x4c, 0x69, 0x66, 0x65, 0x53, 0x6d, 0x61, 0x72, 0x74, 0x65]);

async function aesEcbEncBlock(block, keyBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
  const result = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, block);
  return new Uint8Array(result, 0, 16);
}

async function aesEcbDecBlock(block, keyBytes) {
  const padTarget = block.map(b => b ^ 0x10);
  const ct2 = await aesEcbEncBlock(padTarget, keyBytes);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const two = new Uint8Array(32);
  two.set(block, 0); two.set(ct2, 16);
  const result = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, two);
  return new Uint8Array(result);
}

function rc4Xor(data, key) {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xFF;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let a = 0, b = 0;
  for (let n = 0; n < data.length; n++) {
    a = (a + 1) & 0xFF;
    b = (b + s[a]) & 0xFF;
    [s[a], s[b]] = [s[b], s[a]];
    out[n] = data[n] ^ s[(s[a] + s[b]) & 0xFF];
  }
  return out;
}

async function goveeCrypt(data, key, encrypt) {
  const nBlocks = Math.floor(data.length / 16);
  const tailLen  = data.length % 16;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < nBlocks; i++) {
    const block = data.slice(i * 16, (i + 1) * 16);
    out.set(encrypt ? await aesEcbEncBlock(block, key) : await aesEcbDecBlock(block, key), i * 16);
  }
  if (tailLen) out.set(rc4Xor(data.slice(nBlocks * 16), key), nBlocks * 16);
  return out;
}

const goveeEnc = (d, k) => goveeCrypt(d, k, true);
const goveeDec = (d, k) => goveeCrypt(d, k, false);

function xorCk(b) { return b.reduce((a, v) => a ^ v, 0); }

function makePacket(payload) {
  const p = new Uint8Array(20);
  payload.forEach((b, i) => { if (i < 19) p[i] = b; });
  p[19] = xorCk(p.slice(0, 19));
  return p;
}

async function keyExPkt(cmd, key) {
  const rand = crypto.getRandomValues(new Uint8Array(17));
  const plain = new Uint8Array(20);
  plain[0] = 0xe7; plain[1] = cmd;
  plain.set(rand, 2);
  plain[19] = xorCk(plain.slice(0, 19));
  return goveeEnc(plain, key);
}
