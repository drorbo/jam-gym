// Turning a photo from the device into a profile picture: crop the middle square, shrink it, and re-encode it as a small
// JPEG. Doing it here means a 12-megapixel camera photo never goes over the network, and re-encoding drops everything
// the file carried besides the picture (GPS position, camera, date). The server checks the result again (server/avatar.js).

const SIZE = 256;
const MAX_BYTES = 40 * 1024; // the server allows 48 KB

/** Decode an image file into something drawable, honouring the camera's rotation. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * @param {File} file an image the person picked or took
 * @returns {Promise<string>} base64 of a square JPEG, SIZE pixels across
 * @throws {Error} with a message fit to show, when the file can't be used
 */
export async function photoToAvatar(file) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('Pick a picture (a JPEG or PNG works everywhere).');
  let source;
  try { source = await decode(file); } catch { throw new Error("This browser can't open that picture. Try a JPEG or PNG."); }
  const w = source.width ?? source.naturalWidth;
  const h = source.height ?? source.naturalHeight;
  if (!w || !h) throw new Error("That picture couldn't be read.");

  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // a transparent PNG becomes white, not black
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  source.close?.();

  for (const quality of [0.86, 0.75, 0.62, 0.5]) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= MAX_BYTES) return toBase64(blob);
  }
  throw new Error('That picture is too detailed to shrink enough. Try another.');
}
