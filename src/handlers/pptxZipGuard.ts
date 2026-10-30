/**
 * Envelope's ZIP extractor allocates output buffers using sizes from ZIP
 * headers. Bound those declarations before handing untrusted PPTX bytes to it.
 * This is a preflight, not a replacement for real parsing/decompression checks.
 */
export function assertPptxSafeForEnvelope(bytes: Uint8Array): void {
  const refuse = () => { throw new Error("This PowerPoint is too large or complex for HTML conversion."); };
  if (bytes.byteLength < 22 || bytes.byteLength > 32 * 1024 * 1024) refuse();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (off: number) => view.getUint16(off, true);
  const u32 = (off: number) => view.getUint32(off, true);
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (u32(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0) refuse();
  const count = u16(end + 10);
  const directoryStart = u32(end + 16);
  const directorySize = u32(end + 12);
  if (!count || count > 2000 || count !== u16(end + 8)
      || directoryStart + directorySize > end) refuse();
  let pos = directoryStart;
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) refuse();
    const flags = u16(pos + 8);
    const method = u16(pos + 10);
    const compressed = u32(pos + 20);
    const uncompressed = u32(pos + 24);
    const next = pos + 46 + u16(pos + 28) + u16(pos + 30) + u16(pos + 32);
    if ((flags & 1) || (method !== 0 && method !== 8)
        || next > end || compressed === 0xffffffff || uncompressed === 0xffffffff
        || compressed > bytes.byteLength || uncompressed > 40 * 1024 * 1024
        || u32(pos + 42) >= directoryStart) refuse();
    expanded += uncompressed;
    if (expanded > 160 * 1024 * 1024) refuse();
    pos = next;
  }
  if (pos !== directoryStart + directorySize) refuse();
}
