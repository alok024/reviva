
import crypto from 'crypto';

export interface ImageStore {
  put(bytes: Buffer | string, contentType: string): Promise<string>;
  get(key: string): Promise<string | null>;
}

interface StoredImage {
  data: Buffer;
  contentType: string;
}

function toBuffer(bytes: Buffer | string): Buffer {
  if (Buffer.isBuffer(bytes)) return bytes;
  const comma = bytes.indexOf(',');
  const payload = bytes.startsWith('data:') && comma >= 0 ? bytes.slice(comma + 1) : bytes;
  return Buffer.from(payload, 'base64');
}

class InMemoryImageStore implements ImageStore {
  private files = new Map<string, StoredImage>();

  async put(bytes: Buffer | string, contentType: string): Promise<string> {
    const key = `mem://${crypto.randomUUID()}`;
    this.files.set(key, { data: toBuffer(bytes), contentType });
    return key;
  }

  async get(key: string): Promise<string | null> {
    const file = this.files.get(key);
    if (!file) return null;
    return `data:${file.contentType};base64,${file.data.toString('base64')}`;
  }
}

let instance: ImageStore | null = null;

export function getImageStore(): ImageStore {
  if (!instance) instance = new InMemoryImageStore();
  return instance;
}
