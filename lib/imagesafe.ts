
export const MAX_IMAGE_DIMENSION = 6000;

export interface ImageDimensions {
  width: number;
  height: number;
}

const isJpeg = (buf: Buffer) => buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
const isPng = (buf: Buffer) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;

function processJpeg(buf: Buffer): { bytes: Buffer; dims: ImageDimensions | null } {
  const chunks: Buffer[] = [buf.subarray(0, 2)];
  let dims: ImageDimensions | null = null;
  let offset = 2;

  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];

    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;

    const len = buf.readUInt16BE(offset + 2);
    const segEnd = offset + 2 + len;
    if (len < 2 || segEnd > buf.length) break;

    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && !dims && offset + 9 <= buf.length) {
      dims = { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }

    const isAppn = marker >= 0xe0 && marker <= 0xef;
    if (!isAppn) chunks.push(buf.subarray(offset, segEnd));
    offset = segEnd;
  }

  chunks.push(buf.subarray(offset));
  return { bytes: Buffer.concat(chunks), dims };
}

function readPngDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

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
