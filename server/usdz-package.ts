import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function storedLayers(bytes: Buffer): Map<string, Buffer> {
  let offset = 0;
  const layers = new Map<string, Buffer>();
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    if (bytes.readUInt16LE(offset + 8) !== 0 || bytes.readUInt16LE(offset + 6) & 9
      || size !== bytes.readUInt32LE(offset + 22) || start % 64 || start + size > bytes.length) {
      throw new Error('Compact USDZ has an invalid stored/aligned ZIP entry.');
    }
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    if (layers.has(name)) throw new Error('USDZ contains a duplicate layer.');
    layers.set(name, bytes.subarray(start, start + size));
    offset = start + size;
  }
  const end = bytes.length - 22;
  if (!layers.size || offset + 4 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50
    || end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0
    || bytes.readUInt16LE(end + 10) !== layers.size || bytes.readUInt32LE(end + 16) !== offset) {
    throw new Error('Compact USDZ has an invalid ZIP directory.');
  }
  return layers;
}

function validateBinaryPackage(bytes: Buffer): void {
  const layers = storedLayers(bytes);
  if (layers.keys().next().value !== 'model.usdc'
    || [...layers.values()].some(layer => layer.subarray(0, 8).toString() !== 'PXR-USDC')) {
    throw new Error('Compact USDZ is missing its binary USD layers.');
  }
}

/** Lossless layer encoding only: no mesh, material, transform or precision edits.
 * OpenUSD CLI tools are optional; platforms without them keep the native export.
 */
export async function compactUsdz(bytes: Buffer): Promise<Buffer> {
  let layers: Map<string, Buffer>;
  try {
    layers = storedLayers(bytes);
    // API output may already be compact when Photon receives it. Do not spawn
    // tools or create temporary files for an already valid binary package.
    if (layers.keys().next().value === 'model.usdc') { validateBinaryPackage(bytes); return bytes; }
  } catch (cause) {
    throw new Error('Could not package the 3D model as binary USDZ.', { cause });
  }
  const directory = await mkdtemp(join(tmpdir(), 'large-lego-model-usdz-'));
  const deadline = Date.now() + 30_000;
  const execute = async (file: string, args: string[]) => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error('USDZ binary packaging exceeded its 30-second budget.');
    await run(file, args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true });
  };
  try {
    // Tools remain optional on platforms serving the portable native archive.
    await execute('usdcat', ['--version']);
    if (layers.keys().next().value !== 'model.usda') throw new Error('Expected the native USD root layer.');
    for (const name of layers.keys()) {
      if (!/^(?:model|geometries\/Geometry_\d+)\.usda$/.test(name)) throw new Error('Unexpected native USD layer path.');
    }
    for (const [name, contents] of layers) {
      const source = join(directory, name);
      const text = contents.toString();
      if (!text.startsWith('#usda 1.0')) throw new Error('Expected a native text USD layer.');
      // Only rewrite resolved, package-internal asset paths. No external files
      // or parent traversal are passed to the USD asset resolver.
      const rewritten = text.replace(/@([^@]+)@/g, (_, reference: string) => {
        const target = posix.normalize(posix.join(posix.dirname(name), reference));
        if (!layers.has(target)) throw new Error('USD geometry reference is outside the package.');
        return `@${posix.relative(posix.dirname(name), target).replace(/\.usda$/, '.usdc')}@`;
      });
      await mkdir(dirname(source), { recursive: true });
      await writeFile(source, rewritten);
      // Convert the layer itself. Flattening would expand shared shapes into
      // thousands of copies and undo the native exporter's geometry reuse.
      await execute('usdcat', [source, '-o', source.replace(/\.usda$/, '.usdc')]);
    }
    const binary = join(directory, 'model.usdc');
    const output = join(directory, 'compact.usdz');
    await execute('usdzip', ['--asset', binary, output]);
    const compact = await readFile(output);
    validateBinaryPackage(compact);
    await execute('usdcat', ['-l', output]);
    return compact.length < bytes.length ? compact : bytes;
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === 'ENOENT' && cause.syscall?.startsWith('spawn ')) return bytes;
    throw new Error('Could not package the 3D model as binary USDZ.', { cause: error });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
