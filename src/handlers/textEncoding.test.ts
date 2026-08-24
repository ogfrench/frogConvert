import { describe, it, expect } from "vitest";
import TextEncodingHandler from "./textEncoding.ts";

const handler = new TextEncodingHandler();
const fmt = (internal: string) =>
  handler.supportedFormats.find(f => f.internal === internal)!;

const file = (bytes: Uint8Array) => [{ name: "sample.txt", bytes }];
const SAMPLE = "frog \u{1F438} café\n";

describe("TextEncoding", () => {
  it("rejects non-UTF-32 bytes with a message naming the encoding", async () => {
    // Plain ASCII. Read as UTF-32 LE, "frog" is one word: 0x676F7266.
    const ascii = new TextEncoder().encode("frogConvert sample text.\n");
    await expect(
      handler.doConvert(file(ascii), fmt("utf32le"), fmt("utf8NB"))
    ).rejects.toThrow(/not valid utf-32 le/i);
  });

  it("writes the UTF-32 LE BOM in little-endian byte order", async () => {
    const [out] = await handler.doConvert(
      file(new TextEncoder().encode("a")), fmt("txt"), fmt("utf32le")
    );
    expect([...out.bytes.slice(0, 4)]).toEqual([0xff, 0xfe, 0x00, 0x00]);
  });

  it("writes the UTF-32 BE BOM in big-endian byte order", async () => {
    const [out] = await handler.doConvert(
      file(new TextEncoder().encode("a")), fmt("txt"), fmt("utf32be")
    );
    expect([...out.bytes.slice(0, 4)]).toEqual([0x00, 0x00, 0xfe, 0xff]);
  });

  it("rejects a UTF-32 file whose length is not a multiple of four", async () => {
    await expect(
      handler.doConvert(file(new Uint8Array([0x61, 0x00, 0x00])), fmt("utf32be"), fmt("utf8NB"))
    ).rejects.toThrow(/whole number of 4-byte characters/);
  });

  it("rejects a UTF-16 file with an odd byte count", async () => {
    await expect(
      handler.doConvert(file(new Uint8Array([0x61, 0x00, 0x62])), fmt("utf16le"), fmt("utf8NB"))
    ).rejects.toThrow(/odd number/);
  });

  for (const enc of ["utf16le", "utf16be", "utf32le", "utf32be"]) {
    it(`round-trips through ${enc} without leaving a BOM in the text`, async () => {
      const [encoded] = await handler.doConvert(
        file(new TextEncoder().encode(SAMPLE)), fmt("txt"), fmt(enc)
      );
      const [decoded] = await handler.doConvert(
        file(encoded.bytes), fmt(enc), fmt("utf8NB")
      );
      expect(new TextDecoder().decode(decoded.bytes)).toBe(SAMPLE);
    });
  }
});
