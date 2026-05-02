const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'svg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'a', 'lib',
  'wasm', 'bin', 'dat', 'db', 'sqlite', 'sqlite3',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'xcassets', 'car', 'nib', 'storyboard', 'xib',
  'o', 'obj', 'pyc', 'class',
]);

export function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

export async function isBinaryFile(filePath: string): Promise<boolean> {
  if (hasBinaryExtension(filePath)) return true;

  try {
    const { createReadStream } = await import('fs');
    const stream = createReadStream(filePath, { start: 0, end: 511 });
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });

    let nonPrintable = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b !== 0x09 && b !== 0x0a && b !== 0x0d && (b < 0x20 || b > 0x7e)) {
        nonPrintable++;
      }
    }

    return bytes.length > 0 && nonPrintable / bytes.length > 0.30;
  } catch {
    return false;
  }
}
