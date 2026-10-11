import { createHash } from 'node:crypto';
import type { Design } from '../shared/model.js';
import { generateUsdz } from './native-model.js';
import { compactUsdz } from './usdz-package.js';
import { generateMobileUsdz } from './mobile-model.js';

const pending = new Map<string, Promise<Buffer>>();
const cache = new Map<string, Buffer>();
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
let cacheBytes = 0;

/** An exact revision snapshot shared by web downloads, AR and messaging. */
export async function generateNativeFile(design: Design): Promise<Buffer> {
  return cachedFile(design, false);
}

/** Viewing derivative of the same revision; full geometry remains available separately. */
export async function generateMobileFile(design: Design): Promise<Buffer> {
  return cachedFile(design, true);
}

async function cachedFile(design: Design, mobile: boolean): Promise<Buffer> {
  const snapshot = structuredClone(design);
  const key = createHash('sha256').update(mobile ? 'mobile-v2-attribution:' : 'exact-v2-attribution:').update(JSON.stringify(snapshot)).digest('hex');
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key); cache.set(key, cached);
    return Buffer.from(cached);
  }
  let result = pending.get(key);
  if (!result) {
    result = (async () => {
      let bytes = mobile ? (await generateMobileUsdz(snapshot)).bytes : await generateUsdz(snapshot);
      if (!mobile && bytes.length > 1024 * 1024) {
        try { bytes = await compactUsdz(bytes); }
        catch { console.error('Binary USDZ preparation failed; keeping the exact portable model.'); }
      }
      // Bound memory, not design size. Large archives remain downloadable.
      if (bytes.length <= MAX_CACHE_BYTES) {
        while (cache.size >= 2 || cacheBytes + bytes.length > MAX_CACHE_BYTES) {
          const oldest = cache.keys().next().value!;
          cacheBytes -= cache.get(oldest)!.length; cache.delete(oldest);
        }
        cache.set(key, bytes); cacheBytes += bytes.length;
      }
      return bytes;
    })();
    pending.set(key, result);
    const forget = () => { pending.delete(key); };
    result.then(forget, forget);
  }
  // Callers cannot mutate the bytes retained for the next delivery.
  return Buffer.from(await result);
}
