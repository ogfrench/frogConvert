# Next steps: issue #19 (PostScript / EPS / AI via Ghostscript)

Working branch: `claude/v3-lt7527` (this branch, tracked as `v3-lt7527-local`
locally). Issue #21 (PDF Editor cancellation) is done and merged here. This
file tracks what's left for **#19** so work can resume cleanly across
sessions. Delete this file once #19 ships.

## Scope, as approved by the maintainer

- **Include AI→PDF conversion**, not just PS/EPS. The UI must honestly
  disclose that Illustrator-specific data (layers, editable text, effects)
  gets flattened — Ghostscript rasterizes/flattens what it can't represent
  natively. This is issue #19's own acceptance criterion: "AI's lossiness is
  stated honestly wherever it is offered."
- **Revisit the Ghostscript WASM download messaging.** The existing
  one-time-fetch/progress copy (`~16MB`, in `src/handlers/ghostscript.ts`'s
  `fetchAndCompile`) was written assuming only Compress users trigger it.
  Converter users doing PS/EPS/AI conversions will now trigger the same
  download, so the copy needs to read naturally from either entry point.
- **Do TIFF and PDF/A now, not later**, if feasible with the shipped engine —
  the issue's own text defers these, but the maintainer overrode that:
  "just do it if it's feasible." The `gs.wasm` already shipped includes
  `tiffg4`/`tiff24nc` devices and PDF/A support (`-dPDFA=2`), so this should
  be in-scope rather than a separate issue.

## Implementation checklist

- [ ] **Format registry**: add PS, EPS, AI entries to
      `src/core/CommonFormats/CommonFormats.ts` (extension + MIME,
      `Category.VECTOR`). Confirm `TraversionGraph` auto-builds the right
      graph edges once `from`/`to` are declared via `.builder()` — no manual
      graph registration should be needed (see `src/handlers/libreoffice.ts`
      for the from-only/to-only declaration pattern).
- [ ] **Ghostscript handlers** (`src/handlers/ghostscript.ts` +
      `src/handlers/ghostscript.node.ts`, keep both in sync):
  - Loosen the hard guard `if (outputFormat.format !== "pdf") throw ...` to
    allow the new output formats.
  - PS/EPS/AI → PDF: no special input device needed, Ghostscript reads these
    natively.
  - PDF → PS/EPS: `-sDEVICE=ps2write` / `-sDEVICE=eps2write`.
  - PDF → TIFF: `-sDEVICE=tiffg4` (mono) or `-sDEVICE=tiff24nc` (color),
    multi-page.
  - PDF/A: `-dPDFA=2` flag alongside `pdfwrite`.
  - Generalize `ghostscriptArgs()` in `src/core/compression/pdfSettings.ts`
    (currently hardcoded to `pdfwrite`) to build args for the device/flags
    needed per conversion, instead of only compression quality.
- [ ] **AI lossiness disclosure**: UI copy wherever AI→PDF is offered
  (format picker / conversion confirmation) stating that Illustrator-only
  data is flattened.
- [ ] **Download messaging**: update the fetch-progress copy so it reads
  correctly whether triggered from Compress or Converter.
- [ ] **Magic-byte detection — open decision, not yet resolved with the
  maintainer.** #19's acceptance criteria list content-sniffing
  (`%!PS-Adobe`, EPS binary header `C5 D0 D3 C6`, `%PDF-` for AI) as a
  checklist item, but **no format in this codebase does content-sniffing
  today** — detection is purely extension + browser-reported MIME
  (`src/core/FormatHandler/detectFormat.ts`'s `findMatchingFormat()`).
  Extension-based routing alone is sufficient to resolve `.ps`/`.eps`/`.ai`
  uploads correctly (none collide with `.pdf`). Decide: skip magic-byte
  detection (consistent with the rest of the codebase) or add it (matches
  the issue's literal checklist) before implementing.
- [ ] **Registries**: register the new formats/handlers in
  `src/handlers/index.ts` (browser) and `src/mcp/core/handlers.ts`
  (Node/MCP/REST/CLI).
- [ ] **Docs**: update format-count strings ("70+ formats") in `README.md`,
  `docs/CONVERTER.md`, `AGENTS.md`, `CLAUDE.md`; add PS/EPS/AI (and TIFF/PDF-A
  if shipped) to `docs/HANDLERS.md`'s engine list.
- [ ] **Tests**: format detection for PS/EPS/AI inputs; a real EPS fixture
  round-tripping to PDF; a page-count/no-rasterization guard for vector
  content; TIFF/PDF-A output tests if those ship.

## Workflow to follow

Same rigor as #21: typecheck (`bun x tsc --noEmit`), full unit test suite
(`bun x vitest run` — the two pre-existing environment-dependent failures,
`pipeline.integration.test.ts` needing `bun install` for
`@jspawn/ghostscript-wasm`, and a Puppeteer e2e needing a live browser, are
known and unrelated to this work), live browser verification via
chrome-devtools MCP for anything UI-visible, then commit on this branch.
