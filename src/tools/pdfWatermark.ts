import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';
import { checkpoint } from './cancellation.ts';
import { timestampForFilename } from '../conversion/download.ts';

// See src/tools/cancellation.ts - checked every Nth stamped page (including
// the first) so a cancel is caught quickly without yielding on every page.
const CHECKPOINT_INTERVAL = 10;

export type WatermarkPlacement =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type WatermarkSource =
  | {
      type: 'text';
      text: string;
      fontSize: number;
      color: { r: number; g: number; b: number };
    }
  | {
      type: 'image';
      imageBytes: Uint8Array;
      scale: number;
    };

export interface PdfWatermarkOptions {
  source: WatermarkSource;
  opacity: number;
  rotationDegrees: number;
  /** Engine retains corner placements; UI/MCP/REST surface only center today. */
  placement?: WatermarkPlacement;
  /** 1-indexed pages. Omit (or pass empty) to watermark every page. */
  pageNums?: number[];
  /** When true, tile the watermark across each target page with internally-computed spacing. */
  repeat?: boolean;
}

/** Behavior-shaping defaults shared by UI, MCP wrapper, and REST route. */
export const WATERMARK_DEFAULTS = {
  fontSize: 80,
  colorHex: '#808080',
  opacity: 0.5,
  rotationDegrees: -45,
  repeat: false,
} as const;

export class WatermarkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatermarkValidationError';
  }
}

const PLACEMENT_MARGIN = 36;

/** Hex (#RGB or #RRGGBB) → 0-1 RGB triplet. Throws on malformed input. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (typeof hex !== 'string') throw new WatermarkValidationError(`Invalid color: ${hex}`);
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new WatermarkValidationError(`Invalid color: ${hex}`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/** Inspect leading bytes to determine image type. */
export function detectImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

/**
 * Bottom-left corner anchor for the watermark's axis-aligned bounding box.
 * Caller adds rotation offsets separately so the bbox center stays at the
 * placement target after rotation.
 */
export function placementCoords(args: {
  pageW: number;
  pageH: number;
  wmW: number;
  wmH: number;
  placement: WatermarkPlacement;
  margin?: number;
}): { x: number; y: number } {
  const { pageW, pageH, wmW, wmH, placement } = args;
  const m = args.margin ?? PLACEMENT_MARGIN;
  switch (placement) {
    case 'center':
      return { x: (pageW - wmW) / 2, y: (pageH - wmH) / 2 };
    case 'top-left':
      return { x: m, y: pageH - wmH - m };
    case 'top-right':
      return { x: pageW - wmW - m, y: pageH - wmH - m };
    case 'bottom-left':
      return { x: m, y: m };
    case 'bottom-right':
      return { x: pageW - wmW - m, y: m };
  }
}

/**
 * pdf-lib rotates around the draw origin, not the bbox center. This shifts
 * the origin so the bbox center stays put after rotation.
 */
export function rotatedOrigin(
  bboxX: number,
  bboxY: number,
  bboxW: number,
  bboxH: number,
  rotationDegrees: number
): { x: number; y: number } {
  const cx = bboxX + bboxW / 2;
  const cy = bboxY + bboxH / 2;
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Vector from center to draw origin (pre-rotation lower-left of glyph/image).
  const ox = -bboxW / 2;
  const oy = -bboxH / 2;
  return {
    x: cx + ox * cos - oy * sin,
    y: cy + ox * sin + oy * cos,
  };
}

/**
 * Tile centers (returned as bbox lower-left anchors) covering a page with a
 * watermark of the given pre-rotation dimensions. Distributes tile CENTERS
 * evenly across the page bounds so the visible tiles fill the page rather
 * than spilling off the edges. Spacing accounts for the rotated bounding box.
 */
export function tilePositions(args: {
  pageW: number;
  pageH: number;
  wmW: number;
  wmH: number;
  rotationDegrees: number;
  gap?: number;  // multiplier on AABB; 0 = touching, 0.5 = half a tile of breathing room
}): { x: number; y: number }[] {
  const gap = args.gap ?? 0.4;
  const rad = (args.rotationDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const aabbW = args.wmW * cos + args.wmH * sin;
  const aabbH = args.wmW * sin + args.wmH * cos;
  const stepX = Math.max(aabbW * (1 + gap), 1);
  const stepY = Math.max(aabbH * (1 + gap), 1);
  // How many tile centers fit on the page. We want at least one even when the
  // tile is bigger than the page; otherwise enough to span pageW / pageH.
  const cols = Math.max(1, Math.ceil(args.pageW / stepX));
  const rows = Math.max(1, Math.ceil(args.pageH / stepY));
  // Distribute tile CENTERS so the outer-most tile centers sit symmetrically
  // inside the page. With cols=2 and stepX=515, centers land at e.g. 48 and 564
  // on a 612-wide page, both visible.
  const usedW = (cols - 1) * stepX;
  const usedH = (rows - 1) * stepY;
  const firstCenterX = (args.pageW - usedW) / 2;
  const firstCenterY = (args.pageH - usedH) / 2;
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = firstCenterX + c * stepX;
      const cy = firstCenterY + r * stepY;
      // Convert center → bbox lower-left anchor (caller adds rotation offsets)
      out.push({ x: cx - args.wmW / 2, y: cy - args.wmH / 2 });
    }
  }
  return out;
}

function drawTextAt(
  page: PDFPage,
  font: PDFFont,
  source: Extract<WatermarkSource, { type: 'text' }>,
  anchor: { x: number; y: number },
  wmW: number,
  wmH: number,
  opacity: number,
  rotationDegrees: number
): void {
  const origin = rotatedOrigin(anchor.x, anchor.y, wmW, wmH, rotationDegrees);
  page.drawText(source.text, {
    x: origin.x,
    y: origin.y,
    size: source.fontSize,
    font,
    color: rgb(source.color.r, source.color.g, source.color.b),
    opacity,
    rotate: degrees(rotationDegrees),
  });
}

function drawImageAt(
  page: PDFPage,
  image: PDFImage,
  anchor: { x: number; y: number },
  wmW: number,
  wmH: number,
  opacity: number,
  rotationDegrees: number
): void {
  const origin = rotatedOrigin(anchor.x, anchor.y, wmW, wmH, rotationDegrees);
  page.drawImage(image, {
    x: origin.x,
    y: origin.y,
    width: wmW,
    height: wmH,
    opacity,
    rotate: degrees(rotationDegrees),
  });
}

function applyTextWatermark(
  page: PDFPage,
  font: PDFFont,
  source: Extract<WatermarkSource, { type: 'text' }>,
  opacity: number,
  rotationDegrees: number,
  placement: WatermarkPlacement,
  repeat: boolean
): void {
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const wmW = font.widthOfTextAtSize(source.text, source.fontSize);
  const wmH = font.heightAtSize(source.fontSize);
  const anchors = repeat
    ? tilePositions({ pageW, pageH, wmW, wmH, rotationDegrees })
    : [placementCoords({ pageW, pageH, wmW, wmH, placement })];
  for (const a of anchors) {
    drawTextAt(page, font, source, a, wmW, wmH, opacity, rotationDegrees);
  }
}

function applyImageWatermark(
  page: PDFPage,
  image: PDFImage,
  source: Extract<WatermarkSource, { type: 'image' }>,
  opacity: number,
  rotationDegrees: number,
  placement: WatermarkPlacement,
  repeat: boolean
): void {
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const targetW = pageW * source.scale;
  const aspect = image.height / image.width;
  const wmW = targetW;
  const wmH = targetW * aspect;
  const anchors = repeat
    ? tilePositions({ pageW, pageH, wmW, wmH, rotationDegrees })
    : [placementCoords({ pageW, pageH, wmW, wmH, placement })];
  for (const a of anchors) {
    drawImageAt(page, image, a, wmW, wmH, opacity, rotationDegrees);
  }
}

function stripExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** Shape checks that don't need the document, run before the parse. */
function validateOptionsShape(opts: PdfWatermarkOptions): void {
  if (opts.opacity < 0 || opts.opacity > 1 || !Number.isFinite(opts.opacity)) {
    throw new WatermarkValidationError(`opacity must be between 0 and 1 (got ${opts.opacity})`);
  }
  if (!Number.isFinite(opts.rotationDegrees)) {
    throw new WatermarkValidationError(`rotationDegrees must be a finite number`);
  }
  if (opts.repeat !== undefined && typeof opts.repeat !== 'boolean') {
    throw new WatermarkValidationError(`repeat must be a boolean if provided`);
  }
  if (opts.source.type === 'text') {
    if (typeof opts.source.text !== 'string' || opts.source.text.length === 0) {
      throw new WatermarkValidationError('Text watermark requires non-empty text');
    }
    if (!Number.isFinite(opts.source.fontSize) || opts.source.fontSize <= 0) {
      throw new WatermarkValidationError(`fontSize must be positive (got ${opts.source.fontSize})`);
    }
  } else if (opts.source.type === 'image') {
    if (!(opts.source.imageBytes instanceof Uint8Array) || opts.source.imageBytes.length === 0) {
      throw new WatermarkValidationError('Image watermark requires non-empty imageBytes');
    }
    if (detectImageMime(opts.source.imageBytes) === null) {
      throw new WatermarkValidationError('Image bytes are not a valid PNG or JPEG');
    }
    if (!Number.isFinite(opts.source.scale) || opts.source.scale <= 0 || opts.source.scale > 1) {
      throw new WatermarkValidationError(`scale must be in (0, 1] (got ${opts.source.scale})`);
    }
  }
}

/** pageNums bounds checking, needs document page count. */
function validatePageNums(pageNums: number[], totalPages: number): void {
  for (const n of pageNums) {
    if (!Number.isInteger(n) || n < 1 || n > totalPages) {
      throw new WatermarkValidationError(
        `pageNums contains invalid page ${n} (document has ${totalPages} pages)`
      );
    }
  }
}

async function embedImageFromBytes(doc: PDFDocument, imageBytes: Uint8Array): Promise<PDFImage> {
  const detected = detectImageMime(imageBytes);
  if (detected === null) {
    throw new WatermarkValidationError('Image bytes are not a valid PNG or JPEG');
  }
  try {
    return detected === 'image/png'
      ? await doc.embedPng(imageBytes)
      : await doc.embedJpg(imageBytes);
  } catch (e: any) {
    throw new WatermarkValidationError(
      `Image could not be embedded (unsupported variant, e.g. CMYK JPEG): ${e?.message ?? e}`
    );
  }
}

/**
 * Apply a watermark in place to a single PDFPage. Shared by full-document
 * export and the single-page preview pipeline.
 */
export async function applyWatermarkToPage(
  doc: PDFDocument,
  page: PDFPage,
  opts: Omit<PdfWatermarkOptions, 'pageNums'>
): Promise<void> {
  const repeat = !!opts.repeat;
  const placement = opts.placement ?? 'center';
  if (opts.source.type === 'text') {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    applyTextWatermark(page, font, opts.source, opts.opacity, opts.rotationDegrees, placement, repeat);
    return;
  }
  const image = await embedImageFromBytes(doc, opts.source.imageBytes);
  applyImageWatermark(page, image, opts.source, opts.opacity, opts.rotationDegrees, placement, repeat);
}

/**
 * Apply a watermark across the selected pages of a PDF.
 * @param bytes Source PDF bytes.
 * @param baseName Base name for the output (e.g. "report.pdf"); ".pdf" stripped automatically.
 * @param opts Watermark configuration. `pageNums` defaults to every page.
 */
export async function watermark(
  bytes: Uint8Array,
  baseName: string,
  opts: PdfWatermarkOptions,
  signal?: AbortSignal
): Promise<FileData> {
  validateOptionsShape(opts);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = doc.getPageCount();

  const pageNums = opts.pageNums && opts.pageNums.length > 0
    ? opts.pageNums
    : Array.from({ length: total }, (_, i) => i + 1);
  validatePageNums(pageNums, total);

  const placement = opts.placement ?? 'center';
  const repeat = !!opts.repeat;

  // Embed the resource once and reuse across pages.
  let font: PDFFont | null = null;
  let image: PDFImage | null = null;
  if (opts.source.type === 'text') {
    font = await doc.embedFont(StandardFonts.Helvetica);
  } else {
    image = await embedImageFromBytes(doc, opts.source.imageBytes);
  }

  const targets = new Set(pageNums.map(n => n - 1));
  const pages = doc.getPages();
  let processed = 0;
  for (let i = 0; i < pages.length; i++) {
    if (!targets.has(i)) continue;
    if (processed % CHECKPOINT_INTERVAL === 0) await checkpoint(signal);
    processed++;
    if (font) {
      applyTextWatermark(
        pages[i], font, opts.source as Extract<WatermarkSource, { type: 'text' }>,
        opts.opacity, opts.rotationDegrees, placement, repeat
      );
    } else if (image) {
      applyImageWatermark(
        pages[i], image, opts.source as Extract<WatermarkSource, { type: 'image' }>,
        opts.opacity, opts.rotationDegrees, placement, repeat
      );
    }
  }

  const out = await doc.save();
  return {
    // Timestamped: watermarking the same document twice used to produce
    // two files with one name.
    name: `${stripExt(baseName)}_watermarked-${timestampForFilename()}.pdf`,
    bytes: new Uint8Array(out),
  };
}
