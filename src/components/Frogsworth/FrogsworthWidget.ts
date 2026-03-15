import "./FrogsworthWidget.css";

type Context = { from: string | null; to: string | null };
type Face = "idle" | "thinking" | "happy" | "excited" | "smug" | "hungry";

const KAOMOJI: Record<Face, string> = {
  idle:    "₍𝄐-𝄐₎",
  thinking:"₍𝄐^𝄐₎",
  happy:   "₍𝄐⩌𝄐₎",
  excited: "ദ്ദി₍𝄐⩌𝄐₎",
  smug:    "₍𝄐~𝄐₎",
  hungry:  "₍𝄐O𝄐₎",
};

type Quip = string | [string, Face];
const q = (text: string, face: Face): [string, Face] => [text, face];
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const resolve = (quip: Quip): { text: string; face: Face } =>
  typeof quip === "string" ? { text: quip, face: "idle" } : { text: quip[0], face: quip[1] };
const pickFrom = (arr: Quip[], exclude: string | null): Quip => {
  if (!exclude || arr.length <= 1) return rand(arr);
  const filtered = arr.filter(item => resolve(item).text !== exclude);
  return rand(filtered.length ? filtered : arr);
};

const IDLE_QUIPS: Quip[] = [
  "drop a file, pick a format",
  q("ribbit", "happy"),
  q("i'm a frog who converts files, somehow", "smug"),
  "no file, no format, no comment",
  q("feed me", "happy"),
  q("just sitting here being amphibious", "happy"),
  q("my pond has a conversion pipeline", "excited"),
  q("technically i have no legs in this little face but i still showed up", "excited"),
  q("i've seen things. mostly bad file formats", "smug"),
  q("hi. i'm frogsworth. i convert files", "happy"),
  q("frogsworth at your service", "excited"),
  q("name's frogsworth. yes, the frog", "smug"),
  q("i'm frogsworth and this is my pond", "excited"),
  q("drop something. i'm ready", "happy"),
  q("i have been waiting here for precisely this moment", "excited"),
  q("no judgment on the file. some judgment on the format", "smug"),
];

const PAIR_QUIPS: Record<string, Quip[]> = {
  "pdf→docx": [
    q("pdf to docx: attempting to undo what adobe hath wrought", "smug"),
    q("pdf to docx: lower your expectations before you proceed", "smug"),
  ],
  "docx→pdf": [
    q("docx to pdf: locking it down forever, very professional", "smug"),
    "docx to pdf: committing to permanence",
  ],
  "mp3→wav": [
    q("mp3 to wav: the quality isn't coming back", "smug"),
    "mp3 to wav: adding bytes doesn't restore what lossy compression removed",
  ],
  "wav→mp3": [
    q("wav to mp3: you will lose something. your ears probably won't notice.", "smug"),
  ],
  "flac→mp3": [
    q("flac to mp3: audiophile tears, now compressed", "happy"),
    q("flac to mp3: all that losslessness, gone", "smug"),
  ],
  "mp3→flac": [
    q("mp3 to flac: a lossless container for a lossy file. philosophical.", "smug"),
    q("mp3 to flac: flac can store it, but the missing frequencies are gone forever", "smug"),
  ],
  "wav→flac": [
    q("wav to flac: keeping every bit. respectable.", "happy"),
  ],
  "flac→wav": [
    q("flac to wav: lossless to lossless. a lateral move for the principled.", "smug"),
  ],
  "png→jpg": [
    q("png to jpg: some pixels will not survive this", "smug"),
    "png to jpg: trading lossless quality for social acceptance",
  ],
  "jpg→png": [
    q("jpg to png: losslessly preserving a lossy mistake", "smug"),
  ],
  "jpeg→png": [
    q("jpeg to png: losslessly preserving a lossy mistake", "smug"),
  ],
  "svg→png": [
    q("svg to png: trading infinite resolution for a number. bold choice.", "smug"),
    q("svg to png: svg has no native resolution. you just picked one.", "excited"),
  ],
  "png→svg": [
    q("png to svg: asking a computer to trace what a human drew. goes well sometimes.", "excited"),
  ],
  "mp4→gif": [
    q("mp4 to gif: cinema to meme, as nature intended", "excited"),
    q("mp4 to gif: removing audio, color depth, and dignity", "happy"),
  ],
  "gif→mp4": [
    q("gif to mp4: the gif finally gets what it always deserved", "happy"),
    q("gif to mp4: a 10-second gif can be 50x larger than the equivalent mp4", "excited"),
  ],
  "gif→webp": [
    q("gif to webp: retiring the 256-color 1987 format. finally.", "happy"),
    q("gif to webp: smaller, smoother, still looping", "excited"),
  ],
  "html→pdf": [
    q("html to pdf: the print dialog, but automated", "smug"),
    "html to pdf: snapshotting the web into a document",
  ],
  "html→md": [
    q("html to markdown: stripping the tags, keeping the meaning", "happy"),
    q("html to markdown: de-webbing a document, one tag at a time", "smug"),
  ],
  "md→html": [
    q("markdown to html: becoming the html it always was", "smug"),
    q("md to html: the readme ascends", "excited"),
  ],
  "md→pdf": [
    q("markdown to pdf: readme.md to forever. poetic.", "happy"),
  ],
  "docx→txt": [
    q("docx to txt: stripping out all the formatting you worked so hard on", "smug"),
  ],
  "docx→odt": [
    q("docx to odt: escaping microsoft's gravitational pull. brave.", "excited"),
  ],
  "odt→docx": [
    q("odt to docx: entering microsoft's ecosystem voluntarily", "smug"),
  ],
  "txt→pdf": [
    q("txt to pdf: making the simplest thing complicated. achievement unlocked.", "excited"),
  ],
  "txt→md": [
    q("txt to markdown: adding meaning to plain text", "happy"),
    "txt to md: promotion from plaintext to intentional plaintext",
  ],
  "md→txt": [
    q("markdown to txt: removing the asterisks and getting on with it", "smug"),
  ],
  "csv→json": [
    q("csv to json: adding curly braces to rows. very web-scale.", "smug"),
  ],
  "json→csv": [
    "json to csv: removing the nesting and getting on with it",
  ],
  "json→xml": [
    q("json to xml: making json verbose and angry", "smug"),
    "json to xml: curly braces to angle brackets. a downgrade.",
  ],
  "xml→json": [
    q("xml to json: removing verbosity and calming down", "happy"),
    q("xml to json: no more closing tags. the burden, lifted.", "excited"),
  ],
  "json→yaml": [
    q("json to yaml: adding indentation anxiety to structured data", "smug"),
    q("json to yaml: valid json is valid yaml. yaml is not valid json.", "smug"),
  ],
  "yaml→json": [
    q("yaml to json: removing the indentation landmines", "happy"),
    "yaml to json: space anxiety cured",
  ],
  "yaml→toml": [
    q("yaml to toml: choosing sanity over cleverness", "happy"),
  ],
  "xlsx→csv": [
    "xlsx to csv: corporate spreadsheet to humble plaintext",
  ],
  "xlsx→json": [
    q("xlsx to json: corporate data enters the api era", "excited"),
  ],
  "csv→xlsx": [
    q("csv to xlsx: giving your rows a spreadsheet-shaped home", "happy"),
  ],
  "midi→mp3": [
    q("midi to mp3: turning instructions into sound. finally.", "happy"),
    q("midi to mp3: midi files are tiny. a full symphony can be under 100kb.", "excited"),
  ],
  "mid→mp3": [
    q("mid to mp3: turning instructions into sound. finally.", "happy"),
    q("mid to mp3: midi contains no audio, just instructions. now they become sound.", "excited"),
  ],
  "mp4→webm": [
    q("mp4 to webm: google wants you to use this", "smug"),
  ],
  "webm→mp4": [
    "webm to mp4: escaping google's format. sensible choice.",
  ],
  "mp4→mov": [
    q("mp4 to mov: same video, different apple tax", "smug"),
  ],
  "mov→mp4": [
    q("mov to mp4: escaping the quicktime container. wise.", "happy"),
  ],
  "mp4→mkv": [
    q("mp4 to mkv: adding more tracks than anyone asked for", "smug"),
  ],
  "mkv→mp4": [
    q("mkv to mp4: making the video actually play somewhere", "happy"),
    q("mkv to mp4: taming the container", "smug"),
  ],
  "avi→mp4": [
    q("avi to mp4: the glow-up your video deserves", "excited"),
    q("avi to mp4: dragging it into the current decade", "happy"),
  ],
  "mp4→avi": [
    q("mp4 to avi: going backward with commitment", "smug"),
  ],
  "flv→mp4": [
    q("flv to mp4: escaping flash's ghost. rest in peace.", "happy"),
  ],
  "jpg→webp": [
    q("jpg to webp: smaller file, same image. the web approves.", "happy"),
  ],
  "png→webp": [
    "png to webp: smaller file, slightly more complicated existence",
  ],
  "webp→jpg": [
    q("webp to jpg: leaving the future, returning to the familiar", "smug"),
  ],
  "webp→png": [
    q("webp to png: decompressing the future. losslessly.", "happy"),
  ],
  "heic→jpg": [
    q("heic to jpg: freeing your photo from apple's preferred vault", "excited"),
    q("heic to jpg: heic is typically half the size of jpg. useful efficiency, lost here.", "smug"),
  ],
  "heic→png": [
    q("heic to png: compatibility and losslessness in one move", "excited"),
  ],
  "jpg→heic": [
    q("jpg to heic: voluntarily entering apple's preferred format", "smug"),
  ],
  "tiff→png": [
    q("tiff to png: smaller but still lossless. reasonable.", "happy"),
  ],
  "png→tiff": [
    q("png to tiff: going bigger for no obvious reason", "smug"),
  ],
  "pdf→txt": [
    q("pdf to txt: extracting the soul from the document", "smug"),
    q("pdf to txt: pdf stores text as positioned glyphs, not paragraphs. extraction is guesswork.", "smug"),
  ],
  "pptx→pdf": [
    q("pptx to pdf: slides, but eternal and unchangeable", "smug"),
    q("pptx to pdf: death by powerpoint, preserved forever", "excited"),
  ],
  "epub→pdf": [
    q("epub to pdf: sealing the book forever", "smug"),
    "epub to pdf: the ebook commits to a layout",
  ],
  "mp3→aac": [
    q("mp3 to aac: modest codec upgrade, modest improvement", "happy"),
  ],
  "aac→mp3": [
    q("aac to mp3: going back to 2003. classic.", "smug"),
  ],
  "m4a→mp3": [
    q("m4a to mp3: de-appling your audio", "happy"),
  ],
  "mp3→m4a": [
    q("mp3 to m4a: apple approved", "smug"),
  ],
  "ogg→mp3": [
    q("ogg to mp3: trading principles for compatibility", "smug"),
  ],
  "wav→ogg": [
    q("wav to ogg: compressing the uncompressed, open-sourcely", "happy"),
  ],
};

const FORMAT_QUIPS: Record<string, Quip[]> = {
  // Documents
  pdf: [
    q("adobe's ongoing revenge on humanity", "smug"),
    "a document that does not want to be changed",
    q("pdf: it's a trap disguised as a file", "excited"),
    q("pdf: the format that ends arguments by making everything worse", "smug"),
    q("pdf stands for portable document format. emphasis on portable, not editable.", "smug"),
    "pdf was invented by adobe in 1993 to look the same everywhere. and it does, annoyingly.",
  ],
  docx: [
    q("xml wrapped in a zip wrapped in a lie", "smug"),
    "compatible with everything, perfectly with nothing",
    q("microsoft's gift to future archaeologists", "smug"),
    q("docx is actually a zip file. rename it to .zip and peek inside.", "excited"),
    "opened correctly on the machine it was made on, and nowhere else",
  ],
  odt: [
    q("odt: docx but it took a philosophy class", "smug"),
    q("libre office's pride and joy, largely unappreciated", "happy"),
    "the open alternative nobody's employer accepts",
  ],
  txt: [
    q("txt: pure content, zero drama", "happy"),
    q("the format that outlives everything", "happy"),
    "it's just text. nothing complicated here",
    q("frogsworth respects a txt file", "happy"),
    "no metadata, no styling, no excuses",
  ],
  md: [
    q("html for people who hate angle brackets", "smug"),
    q("readme.md or perish", "excited"),
    "formatting via punctuation, an acquired taste",
    q("a plain text file that wants credit for the asterisks", "smug"),
    q("the developer's love language", "happy"),
  ],
  html: [
    "a document or a website, pending context",
    q("everything is html if you're brave enough", "smug"),
    q("the original markup language, still holding on", "happy"),
    "technically a text file that got ideas",
  ],
  rtf: [
    q("rtf: the diplomatic format. understood by all, preferred by none.", "smug"),
    q("rtf: older than most of its users", "smug"),
    q("the format that just wants everyone to get along", "happy"),
  ],
  epub: [
    "the format ebooks deserve but rarely get right",
    q("epub is just a zip of html files with a table of contents. the kindest lie in publishing.", "excited"),
    q("the right way to store a book, technically", "happy"),
  ],
  pptx: [
    q("slides for the meeting that could have been an email", "smug"),
    q("death by powerpoint: the format", "excited"),
    q("pptx is also just a zip file. the 'x' in office formats means open xml.", "smug"),
    "a file format that inflicted itself on corporate culture",
  ],
  xlsx: [
    q("every business runs on this and refuses to admit it", "smug"),
    "rows and columns, foundation of corporate civilization",
    q("someone's entire career is inside this file", "excited"),
    q("xlsx is a zip of xml. microsoft office formats are all zip files in disguise.", "smug"),
    "a spreadsheet is just a small database with better marketing",
  ],
  csv: [
    q("a spreadsheet that gave up on itself", "smug"),
    "relationships, but flat",
    q("csv has no official standard. every program handles edge cases differently.", "smug"),
    q("commas holding data together. barely.", "smug"),
    "data's most humble form",
  ],
  // Images
  jpg: [
    q("jpg: art with commitment issues", "smug"),
    "beauty with a lossy tax",
    q("one compression away from abstract art", "excited"),
    q("the format that made digital photography possible and slightly worse", "smug"),
    "good enough for most things, perfect for none",
  ],
  jpeg: [
    q("jpeg: art with commitment issues", "smug"),
    "beauty with a lossy tax",
    q("jpeg by another name, equally guilty", "smug"),
  ],
  png: [
    q("png: lossless, like your grudges", "smug"),
    q("png: jpg but it has standards", "smug"),
    q("transparent about its transparency", "happy"),
    q("every pixel accounted for. frogsworth approves.", "happy"),
    q("png was created in 1995 specifically to replace gif and its patents", "excited"),
  ],
  gif: [
    q("gif: an image that refused to sit still", "happy"),
    q("technically not a video but acting like one", "excited"),
    q("gif: 1987 called. it's still loading.", "smug"),
    q("gif uses only 256 colors per frame. that's why they look like that.", "smug"),
    "the gif format is from 1987. so is the debate about pronunciation.",
  ],
  webp: [
    q("google's attempt to colonize the image format space", "smug"),
    q("webp was released by google in 2010. browsers took a decade to widely support it.", "smug"),
    q("the format the web actually wanted but wasn't ready for", "smug"),
    "smaller and better, now widely supported",
  ],
  svg: [
    q("svg: xml wearing a turtleneck", "smug"),
    "infinitely scalable, indefinitely confusing",
    q("svg is just xml. you can open it in notepad and edit it by hand.", "excited"),
    q("the format designers love and developers fear", "smug"),
    "resolution-independent because it's not actually pixels",
  ],
  bmp: [
    "an image format made before anyone thought about file size",
    q("bmp files have no compression by default. a 1920x1080 bmp is about 6 megabytes.", "smug"),
    q("bmp: raw pixels, no apologies", "happy"),
    "technically correct. practically enormous.",
  ],
  tiff: [
    q("the format photographers use to feel important", "smug"),
    q("tiff supports up to 32 bits per channel. more color depth than your monitor can display.", "smug"),
    q("every detail preserved, hard drive suffering", "smug"),
    "professional grade, amateur hard drive space",
  ],
  ico: [
    "your app's entire identity, squashed into a tiny grid",
    q("ico files can contain multiple resolutions in one file. windows picks the best fit.", "excited"),
    q("your app's first impression, measured in pixels", "happy"),
  ],
  heic: [
    q("heic: apple's preferred format, based on an mpeg standard nobody else adopted", "smug"),
    q("heic uses the hevc video codec to compress still images. your photos are basically frozen video frames.", "excited"),
    q("heic: efficient, modern, and mildly inconvenient outside apple", "smug"),
    "your iphone's preferred format. nobody else's.",
  ],
  avif: [
    "avif: the future, finally arriving",
    q("avif uses the av1 video codec for images. the same codec that powers youtube at 4k.", "excited"),
    q("genuinely impressive compression. browser support has caught up.", "happy"),
  ],
  raw: [
    q("raw: unprocessed, uncompressed, unhinged", "excited"),
    "your camera's unfiltered thoughts",
    q("raw files aren't a single format. canon, nikon, and sony all have their own incompatible variants.", "smug"),
    "enormous, beautiful, camera-specific",
  ],
  psd: [
    q("adobe's file, adobe's rules, adobe's subscription", "smug"),
    q("psd files support countless layers. each one a separate act of self-expression.", "excited"),
    q("the creative cloud's hostage format", "smug"),
    "technically a container for your entire creative process",
  ],
  // Audio
  mp3: [
    q("compressed feelings, literally", "smug"),
    q("mp3 discards sounds humans theoretically can't hear. audiophiles disagree.", "smug"),
    "your music, but with a compression tax",
    "mp3 was invented in 1993. the patent expired in 2017. you're welcome.",
    "still the format everyone actually uses",
  ],
  wav: [
    q("wav: uncompressed, unbothered", "happy"),
    q("wav stands for waveform audio file format. it says exactly what it is.", "happy"),
    q("making your hard drive cry since 1991", "smug"),
    q("frogsworth respects the commitment to losslessness", "happy"),
    "every sample preserved. no regrets.",
  ],
  flac: [
    q("flac: lossless, just like my grudges", "smug"),
    q("flac stands for free lossless audio codec. emphasis on free.", "happy"),
    q("the format that proves you could tell the difference", "smug"),
    "compressed without losing a single thing. frogsworth nods.",
  ],
  ogg: [
    q("ogg is just a container. vorbis is the audio inside. people confuse these constantly.", "smug"),
    "open source audio for people who correct you at parties",
    q("the firefox of audio formats", "smug"),
    "technically excellent. socially marginal.",
  ],
  aac: [
    q("aac: mp3 went to college and came back better", "happy"),
    q("aac: lossy, but in a sophisticated way", "happy"),
    q("the standard that won by being good enough", "smug"),
  ],
  m4a: [
    q("apple decided aac needed a container", "smug"),
    "itunes made this happen. we move on.",
    q("m4a: aac in a box with apple branding", "smug"),
  ],
  opus: [
    "opus was standardized by the ietf in 2012 and genuinely beats every other codec at low bitrates",
    q("opus: the right answer to a question nobody was asking", "smug"),
    q("extraordinary compression. extraordinary obscurity.", "smug"),
    q("the format that optimizes for everything except adoption", "smug"),
  ],
  aiff: [
    q("aiff: wav's mac-only cousin", "smug"),
    q("aiff: apple's take on uncompressed audio. for the committed mac audiophile.", "smug"),
  ],
  wma: [
    q("wma: windows media audio. microsoft pushed this hard in the early 2000s.", "smug"),
    q("the format windows media player insisted on", "smug"),
  ],
  mid: [
    q("mid/midi: music described in instructions rather than sound", "happy"),
    q("the format that powers every elevator", "happy"),
    q("no samples, just vibes and math", "excited"),
    q("midi: sheet music, but digital and tinier", "happy"),
  ],
  midi: [
    "a midi file contains no audio. just instructions for what notes to play and when.",
    q("the format that powers every elevator", "happy"),
    q("no samples, just vibes and math", "excited"),
    q("instructions for playing music without any actual music in them", "excited"),
  ],
  // Video
  mp4: [
    "the format that just works, mostly",
    q("mp4: h.264 in a trenchcoat", "smug"),
    q("the universal container. frogsworth approved.", "happy"),
    "not always the best. reliably the least problematic.",
  ],
  mkv: [
    q("mkv (matroska) is named after a russian nesting doll. containers within containers.", "excited"),
    q("mkv: assumes you installed vlc. did you install vlc?", "excited"),
    q("a container ambitious enough to hold an entire film festival", "smug"),
    "the format that says 'yes, and' to every track type",
  ],
  mov: [
    q("mov: apple's format, compatible on apple's terms", "smug"),
    q("quicktime is dead but mov persists", "smug"),
    "the format that works great until you leave the ecosystem",
  ],
  avi: [
    q("avi: old enough to have its own museum exhibit", "smug"),
    "from the era when microsoft named things sensibly",
    q("avi: audio video interleave. a name from a more honest time.", "happy"),
    q("still playing on some family computers somewhere", "excited"),
  ],
  webm: [
    q("webm: mp4 but google made it and needs you to use it", "smug"),
    q("open source video with a corporate agenda", "smug"),
    "technically free, practically tied to chrome's update schedule",
  ],
  wmv: [
    q("wmv: windows movie maker's legacy, preserved in digital amber", "smug"),
    q("the video equivalent of internet explorer", "smug"),
  ],
  flv: [
    q("flv was adobe flash's video format. flash died in 2020. flv files outlasted it.", "smug"),
    q("a ghost format haunting old embed codes", "smug"),
    "youtube used to serve these. we've come far.",
  ],
  // Data
  json: [
    q("json: structured data, quietly judging your indentation", "smug"),
    "curly braces all the way down",
    q("it's everywhere and honestly i respect it", "happy"),
    q("json was popularized in 2001 by douglas crockford. he insists it's pronounced 'jason'.", "smug"),
    q("simple, ubiquitous, slightly verbose. frogsworth uses it.", "happy"),
  ],
  xml: [
    q("xml: verbose by design, exhausting by nature", "smug"),
    "xml was finalized in 1998. the verbosity was a feature.",
    q("angle brackets as far as the eye can see", "excited"),
    q("enterprise software's native tongue", "smug"),
    "technically self-describing. practically self-important.",
  ],
  yaml: [
    q("yaml: one wrong space and it's over. tabs are outright banned.", "excited"),
    "yaml stands for yaml ain't markup language. a recursive acronym, naturally.",
    q("the format that makes whitespace load-bearing", "excited"),
    q("readable until suddenly it isn't", "smug"),
    q("kubernetes is written in this. make of that what you will.", "smug"),
  ],
  toml: [
    q("toml: ini files with ambitions", "happy"),
    q("toml was created by tom preston-werner, github's co-founder. tom's obvious minimal language.", "happy"),
    q("readable, predictable, underrated", "happy"),
    q("the configuration format frogsworth actually likes", "excited"),
  ],
  // Archives
  zip: [
    q("zip: the ancient ritual of compression. frog-approved.", "excited"),
    q("zip was invented by phil katz in 1989, who released the spec publicly. hero.", "happy"),
    q("sending a folder via email since the dawn of civilization", "smug"),
    q("zip: old enough to vote in most countries", "smug"),
  ],
  tar: [
    q("tar: compression without the compression part", "smug"),
    q("tar stands for tape archive. designed for magnetic tape in 1979.", "smug"),
    q("bundling files since the tape drive era", "smug"),
    "a container that doesn't compress, but does bundle",
  ],
  gz: [
    q("gz: deflate doing its best", "happy"),
    q("gz: compression applied. proceed with dignity.", "happy"),
  ],
  rar: [
    q("winrar will remind you your trial expires. forever.", "smug"),
    q("rar's compression algorithm is proprietary. only winrar can create them, but anyone can extract.", "smug"),
    q("rar: abandonware icon of the early internet", "smug"),
  ],
  "7z": [
    q("7z achieves better compression than zip using lzma2. often 30-70% smaller.", "happy"),
    q("7-zip is free and asks nothing of you", "happy"),
    q("7z: technically superior. practically optional.", "smug"),
  ],
};

const GENERIC_QUIPS: Quip[] = [
  "a bold format choice",
  q("ribbit", "happy"),
  q("i'm a frog but i do file conversion apparently", "smug"),
  "every file was a different format once",
  q("data wants to be free. formats keep it imprisoned.", "smug"),
  q("my pond has a conversion pipeline and i'm proud of it", "excited"),
  "some formats survive. most are eventually forgotten",
  q("just a frog doing its best out here", "happy"),
  q("technically i have no legs but i still showed up", "excited"),
  q("frogsworth has seen this format. frogsworth has opinions.", "smug"),
  q("an unusual conversion. frogsworth is intrigued.", "excited"),
  "file in, different file out. the cycle continues.",
  q("i don't judge the file. i only judge the format.", "smug"),
  q("frogsworth endorses this conversion, conditionally", "happy"),
  "interesting. proceed.",
  q("every format is someone's favorite format. this is someone's favorite format.", "smug"),
  q("the conversion frogsworth did not expect today", "excited"),
  "it's giving 'creative format decision'",
];

export function pick(from: string | null, to: string | null, exclude: string | null = null): { text: string; face: Face } {
  const f = from?.toLowerCase();
  const t = to?.toLowerCase();

  if (!f && !t) return resolve(pickFrom(IDLE_QUIPS, exclude));

  if (f && t) {
    const pair = PAIR_QUIPS[`${f}→${t}`] ?? PAIR_QUIPS[`${t}→${f}`];
    if (pair) return resolve(pickFrom(pair, exclude));
  }
  const fmtQuips = (f && FORMAT_QUIPS[f]) ?? (t && FORMAT_QUIPS[t]);
  if (fmtQuips) return resolve(pickFrom(fmtQuips, exclude));
  return resolve(pickFrom(GENERIC_QUIPS, exclude));
}

class FrogsworthWidget {
  private el: HTMLElement;
  private face: HTMLElement;
  private bubble: HTMLElement;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private lastQuip: string | null = null;
  private getContext: () => Context;

  constructor(getContext: () => Context) {
    this.getContext = getContext;

    this.el = document.createElement("div");
    this.el.className = "frogsworth-widget";
    this.el.setAttribute("role", "button");
    this.el.setAttribute("aria-label", "Ask Frogsworth");
    this.el.setAttribute("tabindex", "0");
    this.el.innerHTML = `
      <div class="frogsworth-bubble" aria-live="polite"></div>
      <div class="frogsworth-face">${KAOMOJI.idle}</div>
    `;
    this.face = this.el.querySelector(".frogsworth-face")!;
    this.bubble = this.el.querySelector(".frogsworth-bubble")!;
    this.el.addEventListener("click", () => this.onClick());
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.onClick();
      }
    });
    let dragCount = 0;
    window.addEventListener("dragenter", (e) => {
      if (!(e.dataTransfer?.types ?? []).includes("Files")) return;
      if (++dragCount === 1 && !this.busy) this.setState("hungry");
    });
    window.addEventListener("dragleave", (e) => {
      if (!(e.dataTransfer?.types ?? []).includes("Files")) return;
      dragCount = Math.max(0, dragCount - 1);
      if (dragCount === 0 && !this.busy) this.setState("idle");
    });
    window.addEventListener("drop", () => {
      dragCount = 0;
      if (!this.busy) this.setState("idle");
    });
    document.body.appendChild(this.el);
  }

  private onClick(): void {
    if (this.busy) return;
    const { from, to } = this.getContext();
    this.run(from, to);
  }

  private async run(from: string | null, to: string | null): Promise<void> {
    if (this.dismissTimer) { clearTimeout(this.dismissTimer); this.dismissTimer = null; }
    this.busy = true;

    this.setState("thinking");
    this.bubble.textContent = "...";
    this.bubble.classList.add("visible");

    await delay(900);

    const { text, face } = pick(from, to, this.lastQuip);
    this.lastQuip = text;
    this.bubble.classList.remove("frogsworth-reveal");
    void this.bubble.offsetWidth;
    this.bubble.textContent = `> ${text}`;
    this.bubble.setAttribute("aria-label", text); // omit the visual ">" prefix for screen readers
    this.bubble.classList.add("frogsworth-reveal");
    this.setState(face);
    this.dismissTimer = setTimeout(() => this.hideBubble(), 5_000);
    this.busy = false;
  }

  private setState(state: Face): void {
    this.face.textContent = KAOMOJI[state];
    this.el.dataset.state = state;
  }

  private hideBubble(): void {
    if (this.dismissTimer) { clearTimeout(this.dismissTimer); this.dismissTimer = null; }
    this.bubble.classList.remove("frogsworth-reveal");
    void this.bubble.offsetWidth;
    this.bubble.classList.remove("visible");
    setTimeout(() => this.setState("idle"), 400);
    this.busy = false;
  }

}

let initialized = false;
export function initFrogsworth(getContext: () => Context): void {
  if (initialized) return;
  initialized = true;
  new FrogsworthWidget(getContext);
}
