---
name: verify-frogconvert
description: >-
  Trace frogConvert behavior from executable TypeScript and verify actual
  conversions, PDF edits, compression and MCP/REST output using existing tests.
  Use for Product Passport checks or cross-surface regressions.
---

# Verify frogConvert

Executable source and actual output are authoritative. Read the owning `src/` implementation, its tests, and the command in `package.json` before trusting any documentation. Use `AGENTS.md` for the existing safety and subsystem separation rules.

For PDF merging, inspect `src/tools/pdfMerge.ts`, `src/mcp/tools/pdfMerge.ts`, and `src/api/routes/pdf.ts`. Run `bun run verify:pdf-merge` to exercise the existing engine, MCP and REST test files. When real corpus files and the required engines are available, additionally run the repository's `bun run test:corpus` and inspect the actual output files. Corpus tests that skip are **not verified**.

The PDF Workspace, conversion pipeline, and compression subsystem are independent. Do not route PDF editing through FormatHandlers or duplicate tool logic inside API adapters.

Evidence must describe exact source SHA, test runner and runtime, actual output assertions (page counts, order, content, original preservation), coverage by interface, failures and skips. A successful build, status 200 or returned file name does not prove correct bytes. Do not claim UI or packaged-host acceptance when only isolated unit or API tests ran.
