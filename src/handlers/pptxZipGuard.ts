/**
 * Envelope's ZIP extractor trusts central-directory sizes and offsets when
 * allocating buffers. Reject unsupported/malformed packages before it runs.
 * This limits allocations, but does not make Envelope's parser a ZIP sandbox.
 */
export function assertPptxSafeForEnvelope(bytes: Uint8Array): void {
  const refuse = (): never => { throw new Error("This PowerPoint is too large or complex for HTML conversion."); };
  if (bytes.byteLength < 22 || bytes.byteLength > 32 * 1024 * 1024) refuse();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (off: number) => view.getUint16(off, true);
  const u32 = (off: number) => view.getUint32(off, true);
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.byteLength) {
      end = i;
      break;
    }
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0) refuse();
  const count = u16(end + 10);
  const directoryStart = u32(end + 16);
  const directorySize = u32(end + 12);
  // Multi-disk and ZIP64 are unsupported by Envelope's 32-bit extractor.
  if (!count || count > 2000 || count !== u16(end + 8)
      || directoryStart === 0xffffffff || directorySize === 0xffffffff
      || directoryStart + directorySize !== end) refuse();

  let pos = directoryStart;
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) refuse();
    const flags = u16(pos + 8);
    const method = u16(pos + 10);
    const compressed = u32(pos + 20);
    const uncompressed = u32(pos + 24);
    const nameLength = u16(pos + 28);
    const next = pos + 46 + nameLength + u16(pos + 30) + u16(pos + 32);
    const local = u32(pos + 42);
    if ((flags & 1) || (method !== 0 && method !== 8) || next > end
        || !nameLength || compressed === 0xffffffff || uncompressed === 0xffffffff
        || compressed > bytes.byteLength || uncompressed > 24 * 1024 * 1024
        || local + 30 > directoryStart || u32(local) !== 0x04034b50) refuse();

    // Every central-directory record must point to a matching local header.
    const localNameLength = u16(local + 26);
    const dataStart = local + 30 + localNameLength + u16(local + 28);
    if (u16(local + 8) !== method || localNameLength !== nameLength
        || (u16(local + 6) & 9) !== (flags & 9)
        || dataStart > directoryStart || dataStart + compressed > directoryStart) refuse();
    for (let j = 0; j < nameLength; j++) {
      if (bytes[pos + 46 + j] !== bytes[local + 30 + j]) refuse();
    }
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) refuse();
    // With data-descriptor mode the local sizes are intentionally zero.
    if (!(flags & 8) && (u32(local + 18) !== compressed || u32(local + 22) !== uncompressed)) refuse();
    expanded += uncompressed;
    if (expanded > 96 * 1024 * 1024) refuse();
    pos = next;
  }
  if (pos !== end) refuse();
}
