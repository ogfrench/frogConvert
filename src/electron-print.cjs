// HTML to PDF for the desktop app, served to the renderer over app://.
//
// A browser can only draw an HTML page into a PDF as pictures. Electron has
// Chromium's own PDF printer (webContents.printToPDF), the one behind Print,
// then Save as PDF: real text, real pages, the page's own print styles. The
// svgForeignObject handler posts the page to app://-/api/html-to-pdf and falls
// back to pictures when this answers anything but a PDF.
//
// The page is untrusted. The renderer has already stripped scripts and
// external URLs; here it also loads with JavaScript off, in its own session
// that refuses every request except the page file itself and data: URLs, so a
// relative "../../" reference can't read other local files.
const { BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PARTITION = 'frog-print';
const TIMEOUT_MS = 30_000;
const MAX_HTML_BYTES = 50 * 1024 * 1024;
const allowed = new Set();
let sessionReady = false;

function printSession() {
  const s = session.fromPartition(PARTITION);
  if (!sessionReady) {
    s.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !(allowed.has(details.url) || details.url.startsWith('data:')) });
    });
    sessionReady = true;
  }
  return s;
}

async function htmlToPdf(html) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frogconvert-print-'));
  const file = path.join(dir, 'page.html');
  await fs.writeFile(file, html, 'utf8');
  const url = pathToFileURL(file).href;
  allowed.add(url);
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: printSession(),
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  let timer;
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Loading the page timed out')), TIMEOUT_MS); }),
    ]);
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
  } finally {
    clearTimeout(timer);
    allowed.delete(url);
    win.destroy();
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

/** Answer app://-/api/html-to-pdf; null for anything else. */
async function handlePrintApi(request, urlPath) {
  if (urlPath !== 'api/html-to-pdf') return null;
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const body = await request.json();
    if (typeof body?.html !== 'string') return json(400, { error: 'html is required' });
    if (Buffer.byteLength(body.html) > MAX_HTML_BYTES) return json(413, { error: 'Page too large' });
    const pdf = await htmlToPdf(body.html);
    return json(200, { base64Bytes: Buffer.from(pdf).toString('base64') });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
}

module.exports = { handlePrintApi };
