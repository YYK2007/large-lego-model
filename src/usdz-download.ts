import type { Design, InventoryItem } from '../shared/model.js';

export type UsdzDownload = { url: string; file: Blob; filename: string; title: string };
export type UsdzRequestOptions = { fetch?: typeof globalThis.fetch; signal?: AbortSignal };

const MIME_TYPE = 'model/vnd.usdz+zip';

async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const detail = await response.json().catch(() => null);
  throw new Error(typeof detail?.error === 'string' ? detail.error : 'The 3D model could not be downloaded. Please try again.');
}

async function checkArchive(file: Blob): Promise<void> {
  const invalid = () => new Error('The server returned an invalid or incomplete USDZ file. Please try again.');
  if (file.size < 52) throw invalid();
  const header = new DataView(await file.slice(0, 30).arrayBuffer());
  if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== 0 || (header.getUint16(6, true) & 1)) throw invalid();
  const nameLength = header.getUint16(26, true);
  const dataStart = 30 + nameLength + header.getUint16(28, true);
  const rootSize = header.getUint32(18, true);
  if (!nameLength || dataStart % 64 || !rootSize || header.getUint32(22, true) !== rootSize || dataStart + rootSize > file.size) throw invalid();
  const rootName = await file.slice(30, 30 + nameLength).text();
  if (!/\.(usda|usdc)$/.test(rootName)) throw invalid();

  // Read only the bounded ZIP trailer and a central-directory signature,
  // rather than making another in-memory copy of a potentially large model.
  const tailStart = Math.max(0, file.size - (22 + 65_535));
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (tail.getUint32(offset, true) === 0x06054b50 && offset + 22 + tail.getUint16(offset + 20, true) === tail.byteLength) { end = offset; break; }
  }
  if (end < 0) throw invalid();
  const entries = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryStart = tail.getUint32(end + 16, true);
  if (tail.getUint16(end + 4, true) !== 0 || tail.getUint16(end + 6, true) !== 0 || !entries ||
      tail.getUint16(end + 8, true) !== entries || directorySize < entries * 46 ||
      directoryStart < dataStart + rootSize || directoryStart + directorySize !== tailStart + end) throw invalid();
  const directory = new DataView(await file.slice(directoryStart, directoryStart + 4).arrayBuffer());
  if (directory.getUint32(0, true) !== 0x02014b50) throw invalid();
}

export async function prepareUsdzDownload(design: Design, inventory: InventoryItem[], options: UsdzRequestOptions = {}): Promise<UsdzDownload> {
  const captured = structuredClone({ design, inventory });
  const request = options.fetch ?? globalThis.fetch;
  const deadline = AbortSignal.timeout(120_000);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  const saved = await request('/api/designs', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(captured),
  });
  await checkResponse(saved);
  const snapshot = await saved.json();
  if (typeof snapshot?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(snapshot.id)) throw new Error('The 3D model snapshot could not be saved. Please try again.');
  const url = `/api/designs/${encodeURIComponent(snapshot.id)}/model.usdz`;
  const response = await request(url, { signal });
  await checkResponse(response);
  const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== MIME_TYPE && contentType !== 'application/octet-stream') {
    await response.body?.cancel();
    throw new Error('The server did not return a USDZ model. Please try again.');
  }
  const file = await response.blob();
  await checkArchive(file);
  signal.throwIfAborted();
  const name = captured.design.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70).replace(/^-+|-+$/g, '') || 'build';
  return { url, file: file.slice(0, file.size, MIME_TYPE), filename: `${name}.usdz`, title: captured.design.title };
}
