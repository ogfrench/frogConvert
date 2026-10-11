// LibreOffice for the desktop app, served to the renderer over app://.
//
// The libreoffice handler already has a "remote" mode: in a browser it probes
// /api/health and converts through /api/convert on its own origin (the local
// REST API, src/api/routes/convert.ts). In the desktop app that origin is
// app://-/, which the main process serves, so answering those two paths here
// gives the desktop app a real Office engine with no renderer changes. Before
// this, desktop Office -> PDF fell back to the browser's image-only route
// even with LibreOffice installed.
//
// Detection and arguments mirror the native mode in src/handlers/libreoffice.ts.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const KNOWN_PATHS = [
  'C:/Program Files/LibreOffice/program/soffice.exe',
  'C:/Program Files (x86)/LibreOffice/program/soffice.exe',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];
const TIMEOUT_MS = 120_000;
const MAX_INPUT_BYTES = 200 * 1024 * 1024;

let sofficePromise = null;
let workDir = null;
let queue = Promise.resolve();

function findSoffice() {
  sofficePromise ??= (async () => {
    if (process.env.FROG_SOFFICE && fsSync.existsSync(process.env.FROG_SOFFICE)) return process.env.FROG_SOFFICE;
    for (const p of KNOWN_PATHS) if (fsSync.existsSync(p)) return p;
    try {
      const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['soffice'], {
        encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().split(/\r?\n/)[0];
      if (out && fsSync.existsSync(out)) return out;
    } catch { /* not on PATH */ }
    return null;
  })();
  return sofficePromise;
}

async function ensureWorkDir() {
  if (!workDir) {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frogconvert-office-'));
    await fs.mkdir(path.join(workDir, 'profile'), { recursive: true });
  }
  return workDir;
}

function run(binary, outDir, inputPath, profileDir) {
  // pathToFileURL, never a hand-rolled encoder: "C%3A" makes LibreOffice hang
  // until the timeout on Windows (see libreoffice.ts #exec).
  const args = ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir,
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`, inputPath];
  return new Promise((resolve, reject) => {
    const p = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('LibreOffice conversion timed out (120s)')); }, TIMEOUT_MS);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`LibreOffice exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`));
    });
  });
}

/** One soffice at a time: instances can't share a user profile. */
function enqueue(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function convertToPdf(fileName, bytes) {
  const binary = await findSoffice();
  if (!binary) throw new Error('LibreOffice is not installed');
  const root = await ensureWorkDir();
  return enqueue(async () => {
    const callDir = path.join(root, crypto.randomUUID());
    await fs.mkdir(callDir, { recursive: true });
    try {
      const safeName = path.basename(fileName) || 'input';
      const inputPath = path.join(callDir, safeName);
      await fs.writeFile(inputPath, bytes);
      await run(binary, callDir, inputPath, path.join(root, 'profile'));
      const dot = safeName.lastIndexOf('.');
      const base = dot > 0 ? safeName.slice(0, dot) : safeName;
      try {
        return { fileName: `${base}.pdf`, bytes: await fs.readFile(path.join(callDir, `${base}.pdf`)) };
      } catch {
        throw new Error('LibreOffice produced no output - input file may be corrupt or unsupported');
      }
    } finally {
      fs.rm(callDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

/**
 * Answer app://-/api/health and app://-/api/convert; null for anything else.
 * Same contract as the REST API the handler's remote mode was written for.
 */
async function handleOfficeApi(request, urlPath) {
  if (urlPath === 'api/health') {
    const binary = await findSoffice();
    return json(200, { ok: true, handlers: binary ? ['libreoffice'] : [] });
  }
  if (urlPath !== 'api/convert') return null;
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const body = await request.json();
    if (typeof body?.base64Bytes !== 'string' || typeof body?.fileName !== 'string') {
      return json(400, { error: 'fileName and base64Bytes are required' });
    }
    if (body.outputExt && String(body.outputExt).toLowerCase() !== 'pdf') {
      return json(400, { error: 'Only PDF output is supported' });
    }
    const bytes = Buffer.from(body.base64Bytes, 'base64');
    if (bytes.length > MAX_INPUT_BYTES) return json(413, { error: 'File too large' });
    const out = await convertToPdf(body.fileName, bytes);
    return json(200, [{ fileName: out.fileName, base64Bytes: out.bytes.toString('base64') }]);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
}

module.exports = { handleOfficeApi, findSoffice };
