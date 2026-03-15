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
  "pdf→docx": [q("attempting to undo what adobe hath wrought", "smug"), q("good luck. lower your expectations first", "smug")],
  "docx→pdf": [q("locking it down forever, very professional", "smug"), "committing to permanence"],
  "mp3→wav": [q("the quality isn't coming back", "smug"), "adding bytes doesn't add what was lost"],
  "wav→mp3": [q("you will lose something. probably won't notice", "smug")],
  "flac→mp3": [q("audiophile tears, now compressed", "happy"), q("all that losslessness, gone", "smug")],
  "mp3→flac": [q("a lossless container for a lossy file — philosophical", "smug")],
  "wav→flac": [q("keeping every bit. respectable", "happy")],
  "flac→wav": [q("lossless to lossless — a lateral move for the principled", "smug")],
  "png→jpg": [q("some pixels will not survive this", "smug"), "trading quality for social acceptance"],
  "jpg→png": [q("losslessly preserving a lossy mistake", "smug")],
  "jpeg→png": [q("losslessly preserving a lossy mistake", "smug")],
  "svg→png": [q("trading infinite resolution for a number — bold choice", "smug")],
  "png→svg": [q("asking a computer to trace what a human drew — goes well sometimes", "excited")],
  "mp4→gif": [q("cinema → meme, as nature intended", "excited"), q("removing audio, color depth, and dignity", "happy")],
  "gif→mp4": [q("the gif finally gets what it always deserved", "happy"), q("upgrading a meme to a proper file", "happy")],
  "gif→webp": [q("retiring the 1987 format — finally", "happy"), q("smaller, smoother, still looping", "excited")],
  "html→pdf": [q("the print dialog, but automated", "smug"), "snapshotting the web into a document"],
  "html→md": [q("stripping the tags, keeping the meaning", "happy"), q("de-webbing a document", "smug")],
  "md→html": [q("markdown finally becoming the html it always was", "smug"), q("the readme ascends", "excited")],
  "md→pdf": [q("readme.md to forever — poetic", "happy")],
  "docx→txt": [q("stripping out all the formatting you worked so hard on", "smug")],
  "docx→odt": [q("escaping microsoft's gravitational pull — brave", "excited")],
  "odt→docx": [q("entering microsoft's ecosystem voluntarily", "smug")],
  "txt→pdf": [q("making the simplest thing complicated — achievement unlocked", "excited")],
  "txt→md": [q("adding meaning to plain text", "happy"), "promotion from plaintext to intentional plaintext"],
  "md→txt": [q("removing the asterisks and getting on with it", "smug")],
  "csv→json": [q("adding curly braces to rows. very web-scale", "smug")],
  "json→csv": ["removing the nesting and getting on with it"],
  "json→xml": [q("making json verbose and angry", "smug"), "curly braces to angle brackets — a downgrade"],
  "xml→json": [q("removing verbosity and calming down", "happy"), q("the relief of closing tags, gone forever", "excited")],
  "json→yaml": [q("adding indentation anxiety to structured data", "smug")],
  "yaml→json": [q("removing the indentation landmines", "happy"), "tab anxiety cured"],
  "yaml→toml": [q("choosing sanity over cleverness", "happy")],
  "xlsx→csv": ["corporate spreadsheet to humble plaintext"],
  "xlsx→json": [q("corporate data enters the api era", "excited")],
  "csv→xlsx": [q("giving your rows a spreadsheet-shaped home", "happy")],
  "midi→mp3": [q("turning instructions into sound — finally", "happy")],
  "mid→mp3": [q("turning instructions into sound — finally", "happy")],
  "mp4→webm": [q("google wants you to use this", "smug")],
  "webm→mp4": ["escaping google's format, sensible choice"],
  "mp4→mov": [q("same video, different apple tax", "smug")],
  "mov→mp4": [q("escaping the quicktime container — wise", "happy")],
  "mp4→mkv": [q("adding more tracks than anyone asked for", "smug")],
  "mkv→mp4": [q("making the video actually play somewhere", "happy"), q("taming the container", "smug")],
  "avi→mp4": [q("the glow-up your video deserves", "excited"), q("dragging it into the current decade", "happy")],
  "mp4→avi": [q("going backward with commitment", "smug")],
  "flv→mp4": [q("escaping flash's ghost — rest in peace", "happy")],
  "jpg→webp": [q("downsizing to the format the web pretends to prefer", "smug")],
  "png→webp": ["smaller file, slightly more complicated existence"],
  "webp→jpg": [q("leaving the future, returning to the familiar", "smug")],
  "webp→png": [q("decompressing the future — losslessly", "happy")],
  "heic→jpg": [q("freeing your photo from apple's proprietary vault", "excited"), q("liberation with mild quality cost", "happy")],
  "heic→png": [q("freedom and losslessness in one move", "excited")],
  "jpg→heic": [q("voluntarily entering apple's format vault", "smug")],
  "tiff→png": [q("smaller but still lossless — reasonable", "happy")],
  "png→tiff": [q("going bigger for no obvious reason", "smug")],
  "pdf→txt": [q("extracting the soul from the document", "smug"), "text in, text out — the rest was decoration"],
  "pptx→pdf": [q("slides, but eternal and unchangeable", "smug"), q("death by powerpoint, preserved forever", "excited")],
  "epub→pdf": [q("sealing the book forever", "smug"), "the ebook commits to a layout"],
  "mp3→aac": [q("modest codec upgrade, modest improvement", "happy")],
  "aac→mp3": [q("going back to 2003 — classic", "smug")],
  "m4a→mp3": [q("de-appling your audio", "happy")],
  "mp3→m4a": [q("apple approved", "smug")],
  "ogg→mp3": [q("trading principles for compatibility", "smug")],
  "wav→ogg": [q("compressing the uncompressed, open-sourcely", "happy")],
};

const FORMAT_QUIPS: Record<string, Quip[]> = {
  // Documents
  pdf: [
    q("adobe's ongoing revenge on humanity", "smug"),
    "a document that does not want to be changed",
    q("it's a trap disguised as a file", "excited"),
    q("locked by design, annoying by nature", "smug"),
    q("the format that ends arguments — by making everything worse", "smug"),
    q("a document wearing a padlock as a personality", "smug"),
  ],
  docx: [
    q("xml wrapped in a zip wrapped in a lie", "smug"),
    "compatible with everything, perfectly with nothing",
    q("microsoft's gift to future archaeologists", "smug"),
    q("the format that autocorrects your dignity", "smug"),
    "opened correctly on the machine it was made on, and nowhere else",
  ],
  odt: [
    q("docx but it took a philosophy class", "smug"),
    q("libre office's pride and joy, largely unappreciated", "happy"),
    "the open alternative nobody's employer accepts",
  ],
  txt: [
    q("pure content, zero drama", "happy"),
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
    q("the diplomatic format — understood by all, preferred by none", "smug"),
    "older than most of its users",
    q("the format that just wants everyone to get along", "happy"),
  ],
  epub: [
    "the format ebooks deserve but rarely get right",
    q("a zip file full of html pretending to be a book", "smug"),
    q("the right way to store a book, technically", "happy"),
  ],
  pptx: [
    q("slides for the meeting that could have been an email", "smug"),
    q("death by powerpoint — the format", "excited"),
    q("sixty slides about q3 performance, compressed", "smug"),
    "a file format that inflicted itself on corporate culture",
  ],
  xlsx: [
    q("every business runs on this and refuses to admit it", "smug"),
    "rows and columns, foundation of corporate civilization",
    q("someone's entire career is inside this file", "excited"),
    q("where data goes to become a formula nobody remembers", "smug"),
    "a spreadsheet is just a small database with better marketing",
  ],
  csv: [
    q("a spreadsheet that gave up on itself", "smug"),
    "relationships, but flat",
    q("excel without the opinions", "smug"),
    q("commas holding data together. barely.", "smug"),
    "data's most humble form",
  ],
  // Images
  jpg: [
    q("art with commitment issues", "smug"),
    "beauty with a lossy tax",
    q("one compression away from abstract art", "excited"),
    q("the format that made digital photography possible and slightly worse", "smug"),
    "good enough for most things, perfect for none",
  ],
  jpeg: [
    q("art with commitment issues", "smug"),
    "beauty with a lossy tax",
    q("jpg by another name, equally guilty", "smug"),
  ],
  png: [
    q("lossless, like your grudges", "smug"),
    q("jpg but it has standards", "smug"),
    q("transparent about its transparency", "happy"),
    q("every pixel accounted for. frogsworth approves.", "happy"),
    "the format that respects its contents",
  ],
  gif: [
    q("an image that refused to sit still", "happy"),
    q("technically not a video but acting like one", "excited"),
    q("1987 called. it's still loading", "smug"),
    q("256 colors and a dream", "excited"),
    "the internet's oldest moving picture",
    q("looping forever. like some meetings.", "smug"),
  ],
  webp: [
    q("google's attempt to colonize the image format space", "smug"),
    "better than jpg, adopted five years later than it should have been",
    q("the format the web actually wanted but wasn't ready for", "smug"),
    "smaller and better, slightly annoying to deal with",
  ],
  svg: [
    q("xml wearing a turtleneck", "smug"),
    "infinitely scalable, indefinitely confusing",
    q("it's math pretending to be a picture", "excited"),
    q("the format designers love and developers fear", "smug"),
    "resolution-independent because it's not actually pixels",
  ],
  bmp: [
    "an image format made before anyone thought about file size",
    q("compression-free. file-size not free", "smug"),
    q("raw pixels, no apologies", "happy"),
    "technically correct. practically enormous.",
  ],
  tiff: [
    q("the format photographers use to feel important", "smug"),
    "lossless and enormous, a dignified combination",
    q("every detail preserved, hard drive suffering", "smug"),
    "professional grade, amateur hard drive space",
  ],
  ico: [
    "32 pixels of brand identity",
    q("a tiny image with enormous responsibility", "happy"),
    q("your app's first impression, compressed into a grid", "happy"),
  ],
  heic: [
    q("apple made this one up", "smug"),
    "better than jpg, supported by approximately nobody",
    q("efficient, proprietary, mildly inconvenient", "smug"),
    "your iphone's preferred format. nobody else's.",
  ],
  avif: [
    "the future, arriving slightly too early",
    q("av1 but for pictures — unhinged in a good way", "excited"),
    q("genuinely impressive compression. browser support: eventually", "smug"),
  ],
  raw: [
    q("unprocessed, uncompressed, unhinged", "excited"),
    "your camera's unfiltered thoughts",
    q("the format that says 'i'll decide the white balance later'", "smug"),
    "enormous, beautiful, camera-specific",
  ],
  psd: [
    q("adobe's file, adobe's rules, adobe's subscription", "smug"),
    "layers all the way down",
    q("the creative cloud's hostage format", "smug"),
    "technically a container for your entire creative process",
  ],
  // Audio
  mp3: [
    q("compressed feelings, literally", "smug"),
    q("the format that convinced a generation 128kbps was enough", "smug"),
    "your music, but with a compression tax",
    q("psychoacoustic trickery in a small file", "excited"),
    "still the format everyone actually uses",
  ],
  wav: [
    q("uncompressed, unbothered", "happy"),
    "raw audio for people who can't let go",
    q("making your hard drive cry since 1991", "smug"),
    q("frogsworth respects the commitment to losslessness", "happy"),
    "every sample preserved. no regrets.",
  ],
  flac: [
    q("lossless, just like my grudges", "smug"),
    "for the audiophile who needs to justify the headphones",
    q("the format that proves you could tell the difference", "smug"),
    "compressed without losing a single thing. frogsworth nods.",
  ],
  ogg: [
    q("vorbis is objectively good and nobody cares", "smug"),
    "open source audio for people who correct you at parties",
    q("the firefox of audio formats", "smug"),
    "technically excellent. socially marginal.",
  ],
  aac: [
    "mp3 went to college and came back better",
    q("lossy, but in a sophisticated way", "happy"),
    q("the standard that won by being good enough", "smug"),
  ],
  m4a: [
    q("apple decided aac needed a container", "smug"),
    "itunes made this happen. we move on",
    q("aac in a box with apple branding", "smug"),
  ],
  opus: [
    "technically the best codec, practically the least used",
    q("the right answer to a question nobody was asking", "smug"),
    q("extraordinary compression. extraordinary obscurity.", "smug"),
    q("the format that optimizes for everything except adoption", "smug"),
  ],
  aiff: [
    "wav's mac-only cousin",
    q("apple wav. for the uncompressed mac experience.", "smug"),
  ],
  wma: [
    q("windows media audio — a 2003 microsoft experience, preserved", "smug"),
    q("the format windows media player insisted on", "smug"),
  ],
  mid: [
    "music described in instructions rather than sound",
    q("the format that powers every elevator", "happy"),
    q("no samples, just vibes and math", "excited"),
    q("sheet music, but digital and tinier", "happy"),
  ],
  midi: [
    "music described in instructions rather than sound",
    q("the format that powers every elevator", "happy"),
    q("no samples, just vibes and math", "excited"),
    q("instructions for playing music without any actual music in them", "excited"),
  ],
  // Video
  mp4: [
    "the format that just works, mostly",
    q("h.264 in a trenchcoat", "smug"),
    q("the universal container. frogsworth approved.", "happy"),
    "not always the best. reliably the least problematic.",
  ],
  mkv: [
    q("contains everything, plays nowhere by default", "smug"),
    q("assumes you installed vlc. did you install vlc?", "excited"),
    q("a container ambitious enough to hold an entire film festival", "smug"),
    "the format that says 'yes, and' to every track type",
  ],
  mov: [
    q("apple's format, compatible on apple's terms", "smug"),
    q("quicktime is dead but mov persists", "smug"),
    "the format that works great until you leave the ecosystem",
  ],
  avi: [
    q("old enough to have its own museum exhibit", "smug"),
    "from the era when microsoft named things sensibly",
    q("audio video interleave — a name from a more honest time", "happy"),
    q("still playing on some family computers somewhere", "excited"),
  ],
  webm: [
    q("mp4 but google made it and needs you to use it", "smug"),
    q("open source video with a corporate agenda", "smug"),
    "technically free, practically tied to chrome's update schedule",
  ],
  wmv: [
    q("windows movie maker's legacy, preserved in digital amber", "smug"),
    q("the video equivalent of internet explorer", "smug"),
  ],
  flv: [
    q("flash is dead but flv keeps showing up", "smug"),
    q("a ghost format haunting old embed codes", "smug"),
    "youtube used to serve these. we've come far.",
  ],
  // Data
  json: [
    q("structured data, quietly judging your indentation", "smug"),
    "curly braces all the way down",
    q("it's everywhere and honestly i respect it", "happy"),
    q("the lingua franca of apis everywhere", "happy"),
    q("simple, ubiquitous, slightly verbose. frogsworth uses it.", "happy"),
  ],
  xml: [
    q("json but angrier and more verbose", "smug"),
    "verbose by design, exhausting by nature",
    q("angle brackets as far as the eye can see", "excited"),
    q("enterprise software's native tongue", "smug"),
    "technically self-describing. practically self-important.",
  ],
  yaml: [
    q("one wrong tab and it's over", "excited"),
    q("readable until suddenly it isn't", "smug"),
    "indentation as a feature — bold choice",
    q("the format that makes whitespace load-bearing", "excited"),
    q("kubernetes is written in this. make of that what you will", "smug"),
  ],
  toml: [
    q("ini files with ambitions", "happy"),
    "configuration that knows what it is",
    q("readable, predictable, underrated", "happy"),
    q("the configuration format frogsworth actually likes", "excited"),
  ],
  // Archives
  zip: [
    q("the ancient ritual of compression — frog-approved", "excited"),
    "invented in 1989, still everywhere",
    q("sending a folder via email since the dawn of civilization", "smug"),
    q("old enough to vote in most countries", "smug"),
  ],
  tar: [
    q("compression without the compression part", "smug"),
    "a tape archive in a world that forgot about tape",
    q("bundling files since the tape drive era", "smug"),
    "a container that doesn't compress, but does bundle",
  ],
  gz: [
    "deflate doing its best",
    q("compression applied. proceed with dignity.", "happy"),
  ],
  rar: [
    q("winrar will remind you your trial expires — forever", "smug"),
    q("the eternal trial", "excited"),
    q("abandonware icon of the early internet", "smug"),
  ],
  "7z": [
    "better compression, lower adoption — classic open source arc",
    q("7-zip is free and asks nothing of you", "happy"),
    q("technically superior. practically optional.", "smug"),
  ],
};

const GENERIC_QUIPS: Quip[] = [
  "a bold format choice",
  q("ribbit", "happy"),
  q("i'm a frog but i do file conversion apparently", "smug"),
  "every file was a different format once",
  q("data wants to be free. formats keep it imprisoned", "smug"),
  q("my pond has a conversion pipeline and i'm proud of it", "excited"),
  "some formats survive. most are eventually forgotten",
  q("just a frog doing its best out here", "happy"),
  q("technically i have no legs but i still showed up", "excited"),
  q("frogsworth has seen this format. frogsworth has opinions.", "smug"),
  q("an unusual conversion. frogsworth is intrigued.", "excited"),
  "file in, different file out — the cycle continues",
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
