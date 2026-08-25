
/**
 * Definition of file format. Contains format defined constants like mime type and names
 */
export interface IFormatDefinition {
  /** Format description (long name) for displaying to the user. */
  name: string;
  /** Short, "formal" name for displaying to the user, and for
   * differentiating between files of identical MIME types.
   * If your file is different from others of the same MIME type,
   * then this string should be used to differentiate it. */
  format: string;
  /** File extension. */
  extension: string;
  /** MIME type. */
  mime: string;
  /** Category for grouping formats. */
  category?: Array<string> | string
}

export interface FileFormat extends IFormatDefinition {
  /** Whether conversion **from** this format is supported. */
  from: boolean;
  /** Whether conversion **to** this format is supported. */
  to: boolean;
  /** Format identifier for the handler's internal reference. */
  internal: string;
  /** (Optional) Whether the format is lossless in this context. Defaults to `false`. */
  lossless?: boolean;
}

/**
 * Class containing format definition and method used to produce FileFormat
 * that can be supported by handlers.
 */
export class FormatDefinition implements IFormatDefinition {
  public readonly name: string;
  public readonly format: string;
  public readonly extension: string;
  public readonly mime: string;
  public readonly category?: string[] | string;

  constructor(
    name: string,
    format: string,
    extension: string,
    mime: string,
    category?: string[] | string
  ) {
    this.name = name
    this.format = format
    this.extension = extension
    this.mime = mime
    this.category = category
  }

  /**
   * Returns `FileFormat` object that uses this format definition
   * and specified options
   * @param ref Format identifier for the handler's internal reference.
   * @param from Whether conversion **from** this format is supported.
   * @param to Whether conversion **to** this format is supported.
   * @param lossless (Optional) Whether the format is lossless in this context. Defaults to `false`.
   * @param override Format definition values to override
   * @returns
   */
  supported(ref: string, from: boolean, to: boolean, lossless?: boolean, override: Partial<IFormatDefinition> = {}): FileFormat {
    return {
      ...this,
      ...override,
      internal: ref,
      from: from,
      to: to,
      lossless: lossless ?? false
    }
  }

  /**
   * Returns a builder to fluently create FileFormat.
   * Builder can be used to create FileFormat based on this format definition
   */
  builder(ref: string) {
    const def = this;

    class FormatBuilder {
      name: string = def.name;
      format: string = def.format;
      extension: string = def.extension;
      mime: string = def.mime;
      category: string[] | string | undefined = def.category;
      internal: string = ref;
      from: boolean = false;
      to: boolean = false;
      lossless: boolean = false;

      allowFrom(value: boolean = true) { this.from = value; return this; }
      allowTo(value: boolean = true) { this.to = value; return this; }
      markLossless(value: boolean = true) { this.lossless = value; return this; }
      named(name: string) { this.name = name; return this; }
      withFormat(format: string) { this.format = format; return this; }
      withExt(ext: string) { this.extension = ext; return this; }
      withMime(mimetype: string) { this.mime = mimetype; return this; }
      /** Replaces format category */
      withCategory(category: string[] | string | undefined) { this.category = category; return this; }
      override(values: Partial<IFormatDefinition>) { Object.assign(this, values); return this; }
    }

    return new FormatBuilder() as FileFormat & FormatBuilder;
  }
}


/**
 * Structured post-conversion notice. Rendered in the web UI via the
 * `.convert-notice` pattern (title + body + optional action link).
 * Used whenever the handler auto-adapted to avoid dead-ending the user
 * (e.g. PDF shrunk to fit memory, video frames sampled, GIF trimmed).
 */
export type Notice = {
  /** Short title line. Concrete, no em dashes. */
  title: string;
  /** One or two sentences. Include the specific numbers, name the escape route. */
  body: string;
  /** Optional inline link (usually to MCP/API docs for the real escape hatch). */
  action?: { label: string; href: string };
};

export interface FileData {
  /** File name with extension. */
  name: string;
  /**
   * File contents in bytes.
   *
   * **Please note:** _handlers_ are responsible for ensuring the lifetime
   * and consistency of this buffer. If you're not sure that your handler
   * won't modify it, wrap it in `new Uint8Array()`.
   */
  readonly bytes: Uint8Array;
  /**
   * Legacy plain-string warnings. Consumed by MCP/API surfaces that emit
   * JSON. New handler code should push a structured {@link Notice} into
   * `notices` instead; for back-compat, the notice's `body` should also be
   * pushed into `warnings` so programmatic consumers still see it.
   */
  warnings?: string[];
  /**
   * Structured notices rendered by the web UI. Each notice becomes one
   * `.convert-notice` card in the post-conversion result area.
   */
  notices?: Notice[];
}

/**
 * Progress update emitted by a handler during a conversion.
 * `ratio` drives anything bar-like; `detail` is an optional plain-text fact
 * the slow-conversion notice renders verbatim so silent handlers stay silent
 * and chatty ones can surface useful counters.
 */
export type ProgressEvent = {
  /** 0..1 when known. Omit for indeterminate, caller falls back to spinner. */
  ratio?: number;
  /**
   * Optional short human-readable fact for the UI to surface verbatim
   * (e.g. "Page 12 of 50", "Encoded 3.2s of 8.7s", "Image 4 of 18").
   * Keep under ~40 chars. Handlers that have nothing meaningful to say
   * simply omit this.
   */
  detail?: string;
};

/**
 * User-facing quality preset. Threaded through `doConvert` as the args flag
 * `--quality <preset>`. Each handler interprets it in its own native units,
 * FFmpeg maps to CRF / bitrate, ImageMagick to `-quality` / lossless WebP,
 * pdftoimg to DPI. Handlers that don't care simply ignore the flag.
 */
export type QualityPreset = "low" | "medium" | "high" | "lossless";

/** Parse `--quality <preset>` from a handler's args array. */
export function extractQualityPreset(args?: string[]): QualityPreset | undefined {
  if (!args) return undefined;
  const idx = args.indexOf("--quality");
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  const val = args[idx + 1];
  if (val === "low" || val === "medium" || val === "high" || val === "lossless") return val;
  return undefined;
}

/** Rebuild an args array with the given `--quality` preset, appending if absent. */
export function withQualityArg(args: string[], quality: QualityPreset): string[] {
  const idx = args.indexOf("--quality");
  if (idx < 0 || idx + 1 >= args.length) return [...args, "--quality", quality];
  const next = [...args];
  next[idx + 1] = quality;
  return next;
}

/**
 * Establishes a common interface for converting between file formats.
 * Often a "wrapper" for existing tools.
 */
export interface FormatHandler {
  /** Name of the tool being wrapped (e.g. "FFmpeg"). */
  name: string;
  /** List of supported input/output {@link FileFormat}s. */
  supportedFormats?: FileFormat[];

  /** Whether the handler supports input of any type.
   * Conversion using this handler will be performed only if no other direct conversion is found.
   */
  supportAnyInput?: boolean;

  /**
   * With {@link supportAnyInput}, the `internal` names of the outputs actually
   * reachable from an arbitrary input. Defaults to every `to` format, which is
   * wrong for a handler whose other outputs are only reachable from its own
   * inputs: lzh writes `zip` and `json` only when reading an `lzh`, so the
   * default gave the graph `pdf → json` and `svg → zip` edges that
   * {@link doConvert} rejects at run time.
   */
  anyInputFormats?: string[];

  /**
   * Whether the handler is ready for use. Should be set in {@link init}.
   * If true, {@link doConvert} is expected to work.
   */
  ready: boolean;
  /**
   * Whether the handler requires DOM APIs and thus needs to run on the main thread.
   * If false or undefined, it can be run in a Web Worker to avoid blocking the UI.
   */
  requiresMainThread?: boolean;
  /**
   * Whether this handler actually reads the `--quality` argument.
   *
   * Every hop is handed `--quality`, but only the media and PDF engines do
   * anything with it; the other ~35 handlers ignore it entirely. Without a way
   * to tell the two apart the Converter announced "Compressed at Smallest file"
   * after zipping a JPEG - a claim about work that never happened, on a file
   * that came back *larger* than it went in, because ZIP only adds container
   * overhead to already-compressed data.
   *
   * Opt-in, and absence means "no": a handler that forgets to declare it stays
   * quiet rather than claiming a compression it did not perform. Silence is the
   * safe direction to fail in.
   */
  usesQuality?: boolean;
  /**
   * Initializes the handler if necessary.
   * Should set {@link ready} to true.
   */
  init: () => Promise<void>;
  /**
   * Performs the actual file conversion.
   * @param inputFiles Array of {@link FileData} entries, one per input file.
   * @param inputFormat Input {@link FileFormat}, the same for all inputs.
   * @param outputFormat Output {@link FileFormat}, the same for all outputs.
   * @param args Optional arguments as a string array.
   * Can be used to perform recursion with different settings.
   * @param onProgress Optional progress callback. Handlers that can't report
   * progress simply ignore it; the UI falls back to the indeterminate spinner.
   * @returns Array of {@link FileData} entries, one per generated output file.
   */
  doConvert: (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[],
    onProgress?: (p: ProgressEvent) => void
  ) => Promise<FileData[]>;
}

export class ConvertPathNode {
  public handler: FormatHandler;
  public format: FileFormat;
  constructor(handler: FormatHandler, format: FileFormat) {
    this.handler = handler;
    this.format = format;
  }
}
