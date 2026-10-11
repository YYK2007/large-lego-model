import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function validateBinaryPackage(bytes: Buffer): void {
  let offset = 0, entries = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    if (bytes.readUInt16LE(offset + 8) !== 0 || bytes.readUInt16LE(offset + 6) & 9
      || size !== bytes.readUInt32LE(offset + 22) || start % 64 || start + size > bytes.length) {
      throw new Error('Compact USDZ has an invalid stored/aligned ZIP entry.');
    }
    if (!entries && (bytes.subarray(offset + 30, offset + 30 + nameLength).toString() !== 'model.usdc'
      || bytes.subarray(start, start + 8).toString() !== 'PXR-USDC')) {
      throw new Error('Compact USDZ is missing its binary USD root layer.');
    }
    entries++; offset = start + size;
  }
  const end = bytes.length - 22;
  if (!entries || offset + 4 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50
    || end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0
    || bytes.readUInt16LE(end + 10) !== entries || bytes.readUInt32LE(end + 16) !== offset) {
    throw new Error('Compact USDZ has an invalid ZIP directory.');
  }
}

/** Lossless layer encoding only: no mesh, material, transform or precision edits.
 * OpenUSD CLI tools are optional; platforms without them keep the native export.
 */
export async function compactUsdz(bytes: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'large-lego-model-usdz-'));
  const deadline = Date.now() + 30_000;
  const execute = async (file: string, args: string[]) => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error('USDZ binary packaging exceeded its 30-second budget.');
    await run(file, args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true });
  };
  try {
    const source = join(directory, 'source.usdz'), binary = join(directory, 'model.usdc');
    const output = join(directory, 'compact.usdz');
    await writeFile(source, bytes);
    // Flatten resolves the exporter's internal mesh references without altering
    // authored geometry. Binary crate encoding avoids huge decimal text arrays.
    await execute('usdcat', ['-f', '--skipSourceFileComment', source, '-o', binary]);
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
