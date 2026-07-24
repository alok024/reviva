// Durable image storage interface. The real (non-mock) restore chain needs somewhere to put
// the source photo and each intermediate result so only a small URL/key — never a multi-MB
// base64 blob — has to move between restore steps and out to Replicate.

export interface ImageStore {
  put(bytes: Buffer | string, contentType: string): Promise<string>; // returns a durable URL/key
  get(key: string): Promise<string | null>;
}

interface StoredImage {
  data: Buffer;
  contentType: string;
}

// Accepts raw bytes directly, or a string that's a "data:...;base64,..." URL or bare base64.
function toBuffer(bytes: Buffer | string): Buffer {
  if (Buffer.isBuffer(bytes)) return bytes;
  const comma = bytes.indexOf(',');
  const payload = bytes.startsWith('data:') && comma >= 0 ? bytes.slice(comma + 1) : bytes;
  return Buffer.from(payload, 'base64');
}

// Process-local store — durable only for the life of this server process. That's fine for
// local dev and the keyless mock, but it can't be fetched by an external service like
// Replicate and won't survive a restart or a second instance. Swap in r2-adapter.ts (or any
// other ImageStore) via getImageStore() once real object storage credentials exist.
class InMemoryImageStore implements ImageStore {
  private files = new Map<string, StoredImage>();
  private seq = 0;

  async put(bytes: Buffer | string, contentType: string): Promise<string> {
    this.seq += 1;
    const key = `mem://${Date.now().toString(36)}-${this.seq}`;
    this.files.set(key, { data: toBuffer(bytes), contentType });
    return key;
  }

  async get(key: string): Promise<string | null> {
    const file = this.files.get(key);
    if (!file) return null;
    // Rebuild a self-contained data: URL — the only "durable" form a process-local store can
    // hand back, since there is no server route exposing this map over HTTP.
    return `data:${file.contentType};base64,${file.data.toString('base64')}`;
  }
}

let instance: ImageStore | null = null;

// In-memory local default. Zero dependencies, safe with no credentials at all.
export function getImageStore(): ImageStore {
  if (!instance) instance = new InMemoryImageStore();
  return instance;
}
