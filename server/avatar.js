// Checking an uploaded profile photo. The browser crops and re-encodes it to a small square JPEG before sending (so
// metadata such as GPS never leaves the device), but the server never trusts that: it accepts only a plain JPEG of a
// sensible size and shape, and serves it back as an image that cannot be anything else (see GET /api/avatar in app.js).

import { LIMITS } from './config.js';
import { bad } from './util.js';

const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]); // markers with no length

/** Width and height from the first start-of-frame marker, or null. */
function frameSize(buf) {
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (STANDALONE.has(marker)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) return i + 9 <= buf.length ? { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) } : null;
    if (marker === 0xda) return null; // image data began with no frame header
    i += 2 + len;
  }
  return null;
}

/**
 * @param {unknown} image base64 of the JPEG (a data: URL prefix is tolerated)
 * @returns {Buffer} the bytes, once they check out
 */
export function readAvatar(image) {
  if (typeof image !== 'string' || !image) throw bad('Send the photo as base64.');
  const b64 = image.replace(/^data:image\/jpeg;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw bad('That is not a valid photo.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > LIMITS.avatarBytes) throw bad(`Photos can be up to ${Math.round(LIMITS.avatarBytes / 1024)} KB after resizing.`, 'too_large');
  const jpeg = buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  if (!jpeg) throw bad('The photo must be a JPEG.', 'bad_image');
  const size = frameSize(buf);
  if (!size || size.width < 32 || size.height < 32 || size.width > LIMITS.avatarMaxPx || size.height > LIMITS.avatarMaxPx) {
    throw bad(`The photo must be between 32 and ${LIMITS.avatarMaxPx} pixels across.`, 'bad_image');
  }
  return buf;
}
