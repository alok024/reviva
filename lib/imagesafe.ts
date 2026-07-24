// Pure Node byte-level image safety pass — no image codec dependency. Strips JPEG EXIF/APPn
// metadata (GPS lives in APP1/Exif) and enforces a max pixel dimension. This is deliberately
// NOT a resize: true resampling needs a codec (sharp, etc.) that this repo does not depend
// on, so an oversized image is rejected outright rather than silently downscaled.

export const MAX_IMAGE_DIMENSION = 6000; // px, either side

export interface ImageDimensions {
  width: number;
  height: number;
}

const isJpeg = (buf: Buffer) => buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
const isPng = (buf: Buffer) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;

// Walks JPEG markers from just after SOI. Copies every segment through unchanged except
// APPn (0xE0-0xEF), which is dropped, and reads width/height off the first SOFn marker seen.
// Stops rewriting at SOS/EOI — everything from there on is scan data, copied verbatim.
function processJpeg(buf: Buffer): { bytes: Buffer; dims: ImageDimensions | null } {
  const chunks: Buffer[] = [buf.subarray(0, 2)];
  let dims: ImageDimensions | null = null;
  let offset = 2;

  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break; // not a marker - stop rewriting, keep the rest as-is
    const marker = buf[offset + 1];

    if (marker === 0xff) {
      offset += 1; // fill byte before the real marker code - re-read at the next position
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // TEM / RSTn - no payload
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS - rest copied verbatim below

    const len = buf.readUInt16BE(offset + 2);
    const segEnd = offset + 2 + len;
    if (len < 2 || segEnd > buf.length) break; // malformed length - stop rewriting, keep the rest

    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && !dims && offset + 9 <= buf.length) {
      dims = { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }

    const isAppn = marker >= 0xe0 && marker <= 0xef;
    if (!isAppn) chunks.push(buf.subarray(offset, segEnd));
    offset = segEnd;
  }

  chunks.push(buf.subarray(offset)); // SOS onward (or whatever's left), unchanged
  return { bytes: Buffer.concat(chunks), dims };
}

// IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte type, then
// width/height as 4-byte big-endian ints.
function readPngDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Strips risky metadata (JPEG only) and enforces the size cap (JPEG + PNG). Other formats
// pass through unparsed - no stripping, no dimension check, since we carry no codec for them.
// Throws on an oversized image; callers should turn that into a normal 4xx, not a crash.
export function sanitizeImage(bytes: Buffer, contentType: string): Buffer {
  let out = bytes;
  let dims: ImageDimensions | null = null;

  if (isJpeg(bytes) || /jpe?g/i.test(contentType)) {
    const processed = processJpeg(bytes);
    out = processed.bytes;
    dims = processed.dims;
  } else if (isPng(bytes) || /png/i.test(contentType)) {
    dims = readPngDimensions(bytes);
  }

  if (dims && (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION)) {
    throw new Error(`image is ${dims.width}x${dims.height}, above the ${MAX_IMAGE_DIMENSION}px max dimension`);
  }

  return out;
}
