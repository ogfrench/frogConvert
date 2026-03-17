import * as pdfjsLib from 'pdfjs-dist';

// PDF.js internally does `new Worker(workerSrc)` — a classic (non-module) worker.
// Classic workers can't execute .mjs files with ES module syntax, which Safari enforces strictly.
// Vite recognises the `new Worker(new URL(...), { type: 'module' })` pattern and bundles the
// worker correctly for all browsers. We bypass PDF.js's worker creation by setting workerPort
// to our pre-created module worker; PDF.js uses its postMessage/onmessage interface directly.
const pdfWorker = new Worker(
    new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
    { type: 'module' },
);
(pdfjsLib.GlobalWorkerOptions as any).workerPort = pdfWorker;
