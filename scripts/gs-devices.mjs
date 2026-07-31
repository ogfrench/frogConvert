/**
 * Print the output devices actually compiled into the shipped gs.wasm.
 *
 * The device list decides what conversions are possible at all, and it is not
 * the stock Ghostscript set - this is a size-trimmed WASM build. Guessing here
 * means shipping a format the engine cannot write.
 *
 * Usage: node scripts/gs-devices.mjs
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const pkgDir = path.resolve("node_modules/@jspawn/ghostscript-wasm");

const factory = require(path.join(pkgDir, "gs.js"));
const compiled = await WebAssembly.compile(fs.readFileSync(path.join(pkgDir, "gs.wasm")));

const out = [];
const Module = await new Promise((resolve, reject) => {
    factory({
        noInitialRun: true,
        instantiateWasm: (imports, success) => {
            WebAssembly.instantiate(compiled, imports).then(i => success(i, compiled), reject);
            return {};
        },
        print: (s) => out.push(s),
        printErr: (s) => out.push(s),
    }).then(resolve, reject);
});

Module.callMain(["-h"]);
console.log(out.join("\n"));
