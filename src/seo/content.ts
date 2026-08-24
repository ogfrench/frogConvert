// ---------------------------------------------------------------------------
// Hand-written page copy
// ---------------------------------------------------------------------------
// Everything a landing page says that is not derivable from the route graph
// lives here, written by hand.
//
// Two reasons it is not generated:
//
// 1. The display names in cache.json come from the engines' own enumerations
//    and are frequently wrong or unhelpful for a reader - ImageMagick calls
//    JPEG "Joint Photographic Experts Group JFIF", pandoc calls Markdown
//    "original unextended Markdown", FFmpeg files MP4 under "QuickTime / MOV
//    / mp4". Publishing those verbatim would read as machine spew.
//
// 2. Pages that differ only by a swapped noun are thin content and get
//    filtered. The per-pair copy below is the thing that makes each page
//    worth having.
//
// The jokey lines in FrogsworthWidget's PAIR_QUIPS were the seed for which
// pairs are covered, and several contain real facts, but they are written in
// a deliberately flippant lowercase voice and are not reused verbatim.
//
// NOTE ON CLAIMS: do not add a lossy/lossless claim here from a format
// record's `lossless` flag. That flag means "lossless in this handler's
// context" and is hardcoded to ["png","bmp","tiff"] by FFmpeg and
// ImageMagick. It is a routing hint, not a fact about the format.

export interface FormatContent {
  /** Reader-facing name. Deliberately not the engine's label. */
  title: string;
  /** What the format is and its honest tradeoff. Two or three sentences. */
  blurb: string;
}

export interface PairContent {
  /** What this specific conversion does. */
  summary: string;
  /** The honest limitation. Omitted only where there genuinely isn't one. */
  caveat?: string;
}

/** Formats that are aliases of another. Prevents two URLs for one thing. */
export const FORMAT_ALIASES: Record<string, string> = {
  jpeg: "jpg",
  midi: "mid",
  tif: "tiff",
  htm: "html",
  markdown: "md",
  yml: "yaml",
};

export const FORMAT_CONTENT: Record<string, FormatContent> = {
  // --- documents ---
  pdf: {
    title: "PDF",
    blurb: "Portable Document Format fixes text, fonts and images to an exact page layout, so a PDF looks the same everywhere it opens. That fidelity is also why it resists editing: a PDF stores positioned glyphs, not paragraphs.",
  },
  docx: {
    title: "DOCX",
    blurb: "Microsoft Word's format since 2007, a ZIP archive of XML parts. It carries styles, tracked changes and comments, which is why converting it to anything flatter loses structure rather than just formatting.",
  },
  odt: {
    title: "ODT",
    blurb: "OpenDocument Text, the ISO-standard word processor format used by LibreOffice and OpenOffice. Structurally close enough to DOCX that conversion between the two preserves most formatting.",
  },
  txt: {
    title: "Plain text",
    blurb: "Unstructured UTF-8 characters with no styling, no images and no layout. Nothing about a .txt file can break, which is exactly why anything converted into it arrives stripped.",
  },
  md: {
    title: "Markdown",
    blurb: "Plain text with a light convention for headings, links, emphasis and code. It stays readable unrendered, which is why documentation and READMEs live in it.",
  },
  html: {
    title: "HTML",
    blurb: "The markup language of the web: structured, styleable and reflowable to any screen. Unlike PDF it has no fixed page, so converting to a paged format has to invent page breaks.",
  },
  rtf: {
    title: "RTF",
    blurb: "Rich Text Format, Microsoft's 1987 interchange format for styled text. Almost every word processor still reads it, which makes it a useful lowest common denominator and a poor choice for anything modern.",
  },
  epub: {
    title: "EPUB",
    blurb: "An e-book format that is essentially zipped HTML and CSS. Its text reflows to the reader's screen and font size, so it has no fixed pages to preserve.",
  },
  pptx: {
    title: "PPTX",
    blurb: "Microsoft PowerPoint's format, a ZIP of XML parts describing slides, layouts, and speaker notes. Its positioned shapes and embedded fonts are what make faithful conversion hard.",
  },
  xlsx: {
    title: "XLSX",
    blurb: "Microsoft Excel's format: multiple sheets, formulas, cell formatting and charts in a ZIP of XML. Only the cell values survive a conversion to a flat tabular format.",
  },
  csv: {
    title: "CSV",
    blurb: "Comma-separated values: one table, one type, no formatting and no formulas. Its simplicity is the reason it is universal and the reason it loses everything a spreadsheet adds.",
  },

  // --- images ---
  jpg: {
    title: "JPEG",
    blurb: "The dominant photographic format, using discrete cosine transform compression that discards detail the eye is least likely to notice. It has no transparency, and every re-save loses a little more.",
  },
  png: {
    title: "PNG",
    blurb: "Lossless compression with full alpha transparency, ideal for screenshots, logos and line art. Photographs stored as PNG are typically several times larger than the equivalent JPEG.",
  },
  gif: {
    title: "GIF",
    blurb: "Limited to a 256-colour palette per frame, with simple animation and one-bit transparency. Its compression is far behind anything modern, so an animated GIF is usually much larger than the same clip as video.",
  },
  webp: {
    title: "WebP",
    blurb: "Google's image format, with both a lossy mode derived from VP8 and a true lossless mode, plus alpha and animation. It generally beats JPEG and PNG on size at matched quality.",
  },
  svg: {
    title: "SVG",
    blurb: "Vector graphics described as XML, so shapes scale to any size without softening. It stores drawing instructions rather than pixels, which is why photographs do not belong in it.",
  },
  bmp: {
    title: "BMP",
    blurb: "Windows bitmap: pixel data written out with essentially no compression. Useful as an uncompressed intermediate, wasteful as anything you keep.",
  },
  tiff: {
    title: "TIFF",
    blurb: "A flexible container used in scanning, print and archival work, supporting multiple pages, high bit depths and both lossless and lossy compression. That flexibility means two TIFFs can have very little in common.",
  },
  ico: {
    title: "ICO",
    blurb: "The Windows icon container, holding several sizes of the same image so the system can pick one. Favicons still use it for backwards compatibility.",
  },
  heic: {
    title: "HEIC",
    blurb: "Apple's default photo format since iOS 11, storing still images with HEVC video compression at roughly half the size of a comparable JPEG. Patent licensing is why support outside Apple's ecosystem stayed thin.",
  },
  avif: {
    title: "AVIF",
    blurb: "Still images encoded with AV1, giving noticeably smaller files than JPEG or WebP at matched quality, with alpha and high dynamic range. Encoding is slow compared to older formats.",
  },
  psd: {
    title: "PSD",
    blurb: "Adobe Photoshop's working format, holding layers, masks, adjustment layers and text as editable objects. Converting to any flat image format composites all of that down permanently.",
  },

  // --- audio ---
  mp3: {
    title: "MP3",
    blurb: "The format that made digital music portable, using perceptual coding to throw away sound judged inaudible. Universally supported and comfortably outperformed by every codec designed since.",
  },
  wav: {
    title: "WAV",
    blurb: "Uncompressed PCM audio exactly as sampled, which is why it is the standard working format for recording and editing. A stereo CD-quality minute is about 10 MB.",
  },
  flac: {
    title: "FLAC",
    blurb: "Free Lossless Audio Codec compresses audio to roughly half its uncompressed size and decodes back bit-for-bit identical. The obvious choice for archiving a collection you may re-encode later.",
  },
  ogg: {
    title: "OGG",
    blurb: "An open container, usually carrying Vorbis audio, created specifically to avoid MP3's patent licensing. Quality is better than MP3 at the same bitrate; support is narrower.",
  },
  aac: {
    title: "AAC",
    blurb: "Advanced Audio Coding, MP3's designated successor and the default for Apple Music, YouTube and broadcast. At a given bitrate it is audibly better than MP3.",
  },
  m4a: {
    title: "M4A",
    blurb: "An MPEG-4 container holding audio only, normally AAC and sometimes Apple Lossless. The extension describes the box, not the codec inside it.",
  },
  opus: {
    title: "Opus",
    blurb: "A modern codec that outperforms both MP3 and AAC across nearly the whole bitrate range, and handles speech and music equally well. It is what most voice and video calls use.",
  },
  aiff: {
    title: "AIFF",
    blurb: "Apple's uncompressed audio format, the Macintosh counterpart to WAV, storing raw PCM samples. Same fidelity, same large files, better metadata support.",
  },
  mid: {
    title: "MIDI",
    blurb: "Not audio at all: a sequence of note, timing and instrument instructions, so a file is kilobytes rather than megabytes. What it sounds like depends entirely on the synthesizer that plays it.",
  },

  // --- video ---
  mp4: {
    title: "MP4",
    blurb: "The default video container almost everywhere, normally holding H.264 video and AAC audio. Its ubiquity, not its technical merit, is the reason to choose it.",
  },
  mkv: {
    title: "MKV",
    blurb: "Matroska, an open container that will hold essentially any codec plus unlimited subtitle and audio tracks. Excellent for archiving, less reliably supported by hardware players and browsers.",
  },
  mov: {
    title: "MOV",
    blurb: "Apple's QuickTime container, and the ancestor of MP4: the two share a structure, which is why converting between them is often just a rewrap. Standard output from Apple cameras and editing tools.",
  },
  avi: {
    title: "AVI",
    blurb: "Microsoft's 1992 container, predating modern streaming and subtitle conventions. Still readable everywhere, but a poor home for anything encoded recently.",
  },
  webm: {
    title: "WebM",
    blurb: "A trimmed-down Matroska carrying VP8/VP9 or AV1 video with Vorbis or Opus audio, designed as a royalty-free web format. Browsers play it natively; hardware players often do not.",
  },
  flv: {
    title: "FLV",
    blurb: "Flash Video, the format that carried web video until Flash was retired in 2020. Effectively legacy, and converting out of it is the normal reason to encounter one.",
  },

  // --- data ---
  json: {
    title: "JSON",
    blurb: "The default interchange format for structured data on the web: objects, arrays, strings, numbers, booleans and null. No comments, no date type, no schema.",
  },
  xml: {
    title: "XML",
    blurb: "A verbose, strict markup format with attributes, namespaces and schema validation. Heavier than JSON and still standard across enterprise, publishing and document formats.",
  },
  yaml: {
    title: "YAML",
    blurb: "A whitespace-significant superset of JSON built to be written by hand, which is why configuration files use it. Indentation errors are the price of the readability.",
  },

  // --- archives ---
  zip: {
    title: "ZIP",
    blurb: "The archive format every operating system opens without extra software, compressing each file separately so single entries can be read without unpacking the rest.",
  },
  tar: {
    title: "TAR",
    blurb: "A Unix archive that concatenates files and preserves permissions and symlinks, with no compression of its own. It is nearly always paired with a compressor, as .tar.gz.",
  },
  gz: {
    title: "GZIP",
    blurb: "A single-stream compressor, most often wrapped around a TAR archive. Because it compresses the whole stream, extracting one file means reading everything before it.",
  },
  rar: {
    title: "RAR",
    blurb: "A proprietary archive format with strong compression and recovery records. The compressor is licensed software, which is why most tools can extract RAR but not create it.",
  },
  "7z": {
    title: "7z",
    blurb: "The 7-Zip format, using LZMA2 to reach noticeably smaller archives than ZIP, with strong AES-256 encryption. Slower to compress, and needs software the OS does not ship.",
  },
};

/**
 * Per-pair copy, keyed "from→to".
 *
 * Only pairs listed here get a page. The set is deliberately small: the route
 * graph has 55,448 single-hop pairs and 222,117 reachable ones, and generating
 * anywhere near that on a domain with no authority produces pages nobody
 * crawls and a site that reads as machine-made. These are the conversions
 * people actually search for, and each one is described specifically enough
 * that the page earns its place.
 *
 * Every entry is checked against the live registry at build time (see
 * src/seo/graph.ts) and empirically converted by scripts/verify-conversions.ts,
 * so a route that stops working stops being advertised.
 */
export const PAIR_CONTENT: Record<string, PairContent> = {
  // --- documents ---
  "pdf→docx": {
    summary: "Extracts the text and layout from a fixed-page PDF and rebuilds it as an editable Word document.",
    caveat: "A PDF stores positioned glyphs, not paragraphs, so the structure is inferred rather than recovered. Expect to fix up columns, tables and headings. PDFs of scanned pages contain no text at all and will come through empty.",
  },
  "docx→pdf": {
    summary: "Renders a Word document to fixed pages so it looks identical wherever it opens, and can no longer be casually edited.",
    caveat: "Faithful output needs LibreOffice installed locally; frogConvert calls it and never uploads the file. Without it, slide layouts, images and formatting are lost.",
  },
  "docx→txt": {
    summary: "Pulls the raw text out of a Word document and discards everything else.",
    caveat: "Styling, images, tables, headers and comments are all dropped. This is the right conversion when you want the words and nothing else.",
  },
  "docx→odt": {
    summary: "Converts Microsoft Word's format to the OpenDocument equivalent used by LibreOffice.",
    caveat: "The two are structurally close, so most formatting survives. Tracked changes and Word-specific field codes are the usual casualties.",
  },
  "odt→docx": {
    summary: "Converts an OpenDocument text file to Microsoft Word's format.",
    caveat: "Close enough that most documents round-trip cleanly. Complex frames and OpenOffice-specific styles can shift.",
  },
  "html→pdf": {
    summary: "Renders a web page to fixed pages, turning reflowable markup into a paginated document.",
    caveat: "HTML has no page concept, so page breaks are invented. Anything that depends on scrolling, hover or scripting does not survive.",
  },
  "html→md": {
    summary: "Converts HTML back to Markdown, keeping headings, links, lists and emphasis as plain-text conventions.",
    caveat: "Markdown has no equivalent for most HTML, so styling, layout, tables with merged cells and embedded media are simplified or dropped.",
  },
  "md→html": {
    summary: "Renders Markdown to HTML, turning its conventions into real heading, link and list elements.",
    caveat: "The output is an unstyled fragment. It carries no CSS, so it inherits whatever styling the page it lands in provides.",
  },
  "md→pdf": {
    summary: "Renders Markdown to a paginated PDF, applying default typography for headings, code blocks and lists.",
    caveat: "Page breaks are chosen automatically and can land awkwardly inside long code blocks or tables.",
  },
  "md→txt": {
    summary: "Strips Markdown's syntax to leave the underlying prose.",
    caveat: "Link targets are dropped and only the link text is kept, so any URL in the source is lost.",
  },
  "txt→md": {
    summary: "Treats plain text as Markdown, which mostly means preserving it while making it ready for Markdown tooling.",
    caveat: "No structure is inferred. Headings do not appear just because a line looks like one.",
  },
  "txt→pdf": {
    summary: "Lays plain text out on fixed pages with default typography.",
    caveat: "Line wrapping and page breaks are chosen for you. Text with meaningful alignment, such as ASCII tables, may not survive the wrap.",
  },
  "pdf→txt": {
    summary: "Extracts the text layer from a PDF and discards all layout.",
    caveat: "Reading order is inferred from position, so multi-column pages often interleave. A scanned PDF has no text layer and returns nothing.",
  },
  "pptx→pdf": {
    summary: "Renders each PowerPoint slide to a PDF page, which is the usual way to share a deck that must look right everywhere.",
    caveat: "Needs LibreOffice installed for faithful layout. Animations, transitions and speaker notes do not carry over.",
  },
  "epub→pdf": {
    summary: "Converts a reflowable e-book to fixed pages.",
    caveat: "EPUB has no pages, so pagination is invented. This trades the format's main advantage, text that adapts to the reader's screen, for a fixed layout.",
  },
  "xlsx→csv": {
    summary: "Exports spreadsheet cell values as comma-separated text.",
    caveat: "CSV holds one table, so only a single sheet is exported. Formulas become their computed values, and all formatting, charts and multiple sheets are lost.",
  },
  "xlsx→json": {
    summary: "Turns spreadsheet rows into JSON objects, using the header row for keys.",
    caveat: "Formulas become values. Cell formatting, merged cells and anything outside the used range are dropped.",
  },

  // --- images ---
  "png→jpg": {
    summary: "Re-encodes a lossless PNG as JPEG, usually shrinking photographic content substantially.",
    caveat: "JPEG has no transparency, so any alpha channel is flattened, normally onto white. The compression is lossy and cannot be undone.",
  },
  "jpg→png": {
    summary: "Rewraps JPEG image data in PNG's lossless container, which stops further generation loss on subsequent edits.",
    caveat: "The detail JPEG already discarded does not come back, and the file usually gets larger. Worth doing before editing, not for storage.",
  },
  "jpg→webp": {
    summary: "Re-encodes JPEG as WebP, typically 25 to 35 percent smaller at comparable visual quality.",
    caveat: "This is a second lossy encode on already-lossy data, so some additional detail is lost.",
  },
  "png→webp": {
    summary: "Converts PNG to WebP, which supports both lossless mode and alpha transparency, usually at a smaller size than PNG.",
  },
  "webp→jpg": {
    summary: "Converts WebP to JPEG for software that predates WebP support.",
    caveat: "Transparency is flattened, and re-encoding lossy WebP as lossy JPEG loses a little more detail.",
  },
  "webp→png": {
    summary: "Converts WebP to PNG, preserving alpha transparency in a universally supported lossless format.",
    caveat: "Files are typically larger, and any loss already baked into a lossy WebP stays.",
  },
  "heic→jpg": {
    summary: "Converts an iPhone photo to JPEG so it opens anywhere. HEIC stores stills using HEVC video compression, which is why the originals are roughly half the size.",
    caveat: "JPEG is less efficient, so the converted file is usually larger than the HEIC it came from. Live Photo motion and depth data are not carried over.",
  },
  "heic→png": {
    summary: "Converts an iPhone photo to lossless PNG, avoiding a second lossy encode.",
    caveat: "PNG is a poor fit for photographs, so expect a file several times larger than the original HEIC.",
  },
  "png→tiff": {
    summary: "Converts PNG to TIFF, the usual choice for print and archival workflows.",
  },
  "tiff→png": {
    summary: "Converts TIFF to PNG for web and general use, keeping lossless quality.",
    caveat: "TIFF can hold multiple pages and high bit depths; only the first page survives, and depth above 8 bits per channel is reduced.",
  },
  "svg→png": {
    summary: "Rasterises vector artwork to pixels at a chosen size, for use where SVG is not supported.",
    caveat: "The result stops being scalable. Enlarging the PNG afterwards softens it, where the SVG would have stayed sharp.",
  },
  "png→svg": {
    summary: "Traces a bitmap into vector paths, which works well for logos, icons and line art.",
    caveat: "This is tracing, not recovery. Photographs produce enormous files of meaningless shapes. Use it on flat-colour graphics only.",
  },
  "gif→webp": {
    summary: "Converts an animated GIF to animated WebP, normally a large size reduction because GIF's compression is decades behind.",
    caveat: "GIF's 256-colour palette limit is already baked in, so the conversion cannot restore colour the GIF never had.",
  },

  // --- video ---
  "mp4→gif": {
    summary: "Turns a video clip into an animated GIF that plays inline anywhere without a video player.",
    caveat: "GIF is limited to 256 colours and has no audio, and the file is often larger than the video it came from. Keep clips short.",
  },
  "gif→mp4": {
    summary: "Converts an animated GIF to video, usually a dramatic size reduction with better colour.",
  },
  "mp4→webm": {
    summary: "Re-encodes video to WebM, the royalty-free format browsers play natively.",
    caveat: "A full re-encode, so it takes time and loses a little quality. Hardware players often cannot play WebM.",
  },
  "webm→mp4": {
    summary: "Converts WebM to MP4 for the players, editors and phones that expect H.264.",
    caveat: "A full re-encode rather than a rewrap, since the codecs differ.",
  },
  "mp4→mov": {
    summary: "Rewraps MP4 into Apple's QuickTime container for editing tools that prefer it.",
    caveat: "MP4 and MOV share a structure, so this is usually a container swap rather than a re-encode, and quality is untouched.",
  },
  "mov→mp4": {
    summary: "Rewraps a QuickTime file as MP4 for broader compatibility.",
    caveat: "Normally a container swap with no quality change, since the two formats share a structure.",
  },
  "mp4→mkv": {
    summary: "Rewraps video into Matroska, which can carry unlimited subtitle and audio tracks.",
    caveat: "Usually lossless rewrapping. MKV is excellent for archiving but poorly supported by hardware players and browsers.",
  },
  "mkv→mp4": {
    summary: "Rewraps Matroska as MP4 so it plays on phones, TVs and browsers.",
    caveat: "If MKV carries codecs MP4 cannot hold, a re-encode is needed. Extra subtitle and audio tracks may be dropped.",
  },
  "avi→mp4": {
    summary: "Converts a legacy AVI to MP4, usually shrinking it considerably because AVI predates modern compression.",
  },
  "mp4→avi": {
    summary: "Converts MP4 to AVI for legacy software that requires it.",
    caveat: "AVI is a worse container in nearly every respect, and files typically get larger. Only do this when something specifically demands AVI.",
  },
  "flv→mp4": {
    summary: "Rescues video from the retired Flash format into MP4.",
    caveat: "FLV usually carries old, low-bitrate encodes. Converting preserves what is there but cannot improve it.",
  },

  // --- audio ---
  "mp3→wav": {
    summary: "Decodes compressed MP3 audio back to uncompressed PCM, the standard working format for editing.",
    caveat: "The file grows roughly tenfold, and the detail MP3 discarded during encoding does not return. Useful for editing, pointless for storage.",
  },
  "wav→mp3": {
    summary: "Compresses uncompressed audio to MP3, typically around a tenth of the size.",
    caveat: "Lossy and permanent. At the default 192 kbps stereo most listeners hear no difference, but the discarded data is gone.",
  },
  "flac→mp3": {
    summary: "Converts lossless FLAC to MP3 for players and devices that need it, at a large size saving.",
    caveat: "Lossy and irreversible. Keep the FLAC as your master, since you can always re-encode from it.",
  },
  "mp3→flac": {
    summary: "Stores MP3 audio in a lossless container, which prevents any further generation loss.",
    caveat: "FLAC can hold the audio perfectly but the frequencies MP3 removed are already gone. The file gets much larger with no quality gain.",
  },
  "wav→flac": {
    summary: "Compresses uncompressed audio losslessly, typically to about half the size, decoding back bit-for-bit identical.",
  },
  "flac→wav": {
    summary: "Decodes FLAC to uncompressed PCM for editors and hardware that need raw audio.",
    caveat: "Lossless in both directions, so nothing is lost. The file roughly doubles.",
  },
  "mp3→aac": {
    summary: "Converts MP3 to AAC, which is more efficient at the same bitrate and is what Apple Music and YouTube use.",
    caveat: "Re-encoding one lossy format as another loses a little more. Convert from a lossless source when you have one.",
  },
  "aac→mp3": {
    summary: "Converts AAC to MP3 for older players that predate AAC support.",
    caveat: "A second lossy encode, and MP3 is the less efficient codec, so this trades quality for compatibility.",
  },
  "m4a→mp3": {
    summary: "Extracts the audio from an MPEG-4 container and re-encodes it as MP3.",
    caveat: "M4A usually holds AAC, so this is a lossy-to-lossy conversion into a less efficient codec.",
  },
  "ogg→mp3": {
    summary: "Converts Ogg Vorbis to MP3 for hardware and software that does not support Ogg.",
    caveat: "Another lossy re-encode. Vorbis is generally the better codec, so this is a compatibility trade.",
  },
  "wav→ogg": {
    summary: "Compresses uncompressed audio to Ogg Vorbis, which sounds better than MP3 at the same bitrate and carries no patent baggage.",
    caveat: "Lossy, and support is narrower than MP3 on consumer hardware.",
  },
  "mid→mp3": {
    summary: "Renders a MIDI sequence to actual audio by synthesising the notes it describes.",
    caveat: "MIDI stores instructions, not sound, so the result depends entirely on the synthesizer and instrument bank used. It will not match how the file sounded elsewhere.",
  },

  // --- data ---
  "csv→json": {
    summary: "Turns tabular rows into JSON objects, using the header row for keys.",
    caveat: "CSV has no types, so numbers and booleans arrive as strings unless inferred. Irregular rows can produce inconsistent objects.",
  },
  "json→csv": {
    summary: "Flattens JSON records into a table with one row per record.",
    caveat: "CSV is strictly two-dimensional. Nested objects and arrays have to be flattened or dropped, and records with differing keys produce sparse columns.",
  },
  "json→xml": {
    summary: "Converts JSON to XML elements, for systems that require XML input.",
    caveat: "JSON arrays have no direct XML equivalent, so repeated elements are used. Keys that are not valid XML names have to be rewritten.",
  },
  "xml→json": {
    summary: "Converts XML to JSON, mapping elements to objects and repeated elements to arrays.",
    caveat: "XML distinguishes attributes from child elements and JSON does not, so attributes are given a prefix. Namespaces, comments and mixed content are simplified.",
  },
  "json→yaml": {
    summary: "Rewrites JSON as YAML, which is easier to read and edit by hand for configuration.",
    caveat: "YAML is whitespace-significant, so the result is more readable and easier to break with a bad indent.",
  },
  "yaml→json": {
    summary: "Converts YAML to JSON for tools and APIs that only accept JSON.",
    caveat: "Comments are lost, because JSON has no way to represent them. YAML dates and other rich scalars become strings.",
  },
};
