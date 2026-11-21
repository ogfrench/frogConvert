# Experience journey: prove the product people actually use

Use this reference when one feature appears across a catalog, detail screen, editor, preview, generated artifact or installed host. It complements the feature contract and visual-loop, rather than creating a new universal tester.

## Inspect the complete journey

Trace one **real user goal**, using the product's own terms:

1. **Find:** Can a visitor discover the correct item or category without knowing internal object types? Compare catalog labels with actual data models and routes. A narrative sequence should not be mislabeled as an atom or component simply because it shares a backend collection.
2. **Understand:** Does the detail screen identify what the item actually does? Keep its description and primary action useful to a visitor. Repeated plugin installation links, implementation provenance, feature IDs, dependency graphs and AI-instruction boilerplate are not primary product content. Keep necessary setup and developer material accessible in the appropriate docs or secondary disclosure.
3. **Experience:** Exercise the authentic preview in the *real item detail page*. Where a live renderer exists, the primary preview should use it, with an honest loading/error/static fallback. A gallery containing dozens of items can use lightweight still images for performance. Do not turn every static artifact into a fake interactive preview.
4. **Act:** Trigger the primary user action such as copy, customize, download, compose or play. Verify the state, correct source asset, chosen brand/theme and the output, not only the button's existence.
5. **Take away:** Open or inspect the generated HTML/PDF/PPTX/download or persistence result. Distinguish a successful source build from what an end user actually receives and can use.

## Cross-surface acceptance matrix

For a changed capability, inspect the product-owned equivalents of:

| Surface | Meaningful assertion |
| --- | --- |
| Collection/search | Correct classification, useful label, count/filter, lightweight preview, responsive layout |
| Detail page | Accurate explanatory copy, real primary preview or explicit static nature, controls, accessible fallback |
| Primary action | Correct interaction and feedback with expected result, including one negative path |
| Resulting artifact | Correct content, standalone/offline or native fidelity where applicable |
| Other consumers | Docs, API/MCP, plugin, registry, exports, host installs only when touched by the change |

Do not require every surface of every product. **Select the affected journey and write down excluded surfaces.** If an item can appear in two views, test the connection between views rather than merely testing them separately.

## Visual evidence is an inspected outcome

Use the existing visual-loop and browser tooling, not a second renderer or a synthetic screenshot as proof. Capture the actual product at a recorded source SHA/runtime revision and representative desktop/mobile sizes. Inspect images for readable typography, overflow, layout stability, color/brand variants, contrast, correct selected states, and content relevance. Test interaction/motion in-browser because screenshots alone cannot prove it. Record `passed`, `failed`, `blocked` or `not_run` for each claim.

A still is valid **for a large catalog card** or an intrinsically static feature. It is not proof that a live effect, playable deck or interactive detail view works. A successfully loaded iframe can still be blank or incorrect. Check the rendered content or observable lifecycle state.

Do not claim source-based mockups, CSS-only reconstructions or screenshots of an earlier revision are runtime evidence of the changed item.

## Contrasting cases

- **Correct:** A page lists many animations using still thumbnails for speed; each detail view plays the actual current animation and offers pause, with a fallback on failure.
- **Incorrect:** A detail view shows an old still although its title promises a live, adjustable animation.
- **Correct:** A download-oriented static icon page uses a precise SVG preview, no fake animation, and verifies the downloaded SVG.
- **Incorrect:** A sequence of ten narrative steps is classified as a single reusable icon or component, and the only download is a list of labels while the page promises a playable presentation.

The remedy may be category/copy correction, a shared preview component, action routing, a generator fix or a missing regression. Diagnose the owning code first; never solve a product mismatch by making the Passport documentation falsely claim it works.
