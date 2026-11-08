# Inspection rubric for real rendered design

Use this when a user asks for a full visual audit, rejects multiple options, or when a consequential UI or slide design has changed. This complements `visual-loop`; it is not a mandatory design intake, aesthetic score, or separate approval stage.

## Evidence before verdicts

Confirm which source revision, brand or theme, viewport or slide size, content and state the screenshot depicts. Inspect the actual rendered output at readable scale; source code, successful builds and miniature contact sheets are not substitutes. When no renderer is available, say "not visually verified" and keep conclusions to what the available evidence supports.

Prioritize:
1. **Blocking:** clipped or overlapping text, truncated labels, misleading scales, missing key evidence, unreadable contrast, inaccessible controls or incorrect output.
2. **Material:** misplaced focal point, avoidable top/bottom heaviness, competing hierarchy, optical misalignment, typography that collapses at intended size, repetitive compositions that obscure different relationships.
3. **Polish:** inconsistent radii, icon weight, kerning, dividers or decoration without explanatory value.

## Inspect deliberately

- **Hierarchy and balance:** Identify the intended first, second and third reading targets. Compare occupied space above and below the visual center. Check whether the body sits in the space remaining after the actual header, not an assumed fixed offset. Asymmetry is fine when intentional.
- **Type and numbers:** Read at final viewing size. Check wraps, orphans, figure alignment, tabular numerals for columns and changing values, and optical rather than purely geometric centering of asymmetric shapes. Don't override a legitimate brand face.
- **Information form:** A statistic trio is not automatically a good comparison. If values have different units or denominators, separate or contextualize them. Use a common scale only when the measures are actually comparable. Do not alter evidence to make a layout attractive.
- **Components:** Check inner radius against surrounding padding, visible focus, target size, meaningful labels, hit areas and error/empty/loading states when applicable.
- **Motion:** Verify interruptions, back navigation, mid-transition input, settled state and reduced motion using actual frames. Motion should explain or acknowledge something; a static screenshot cannot certify it.
- **Delivery:** For slides, inspect every changed or risky slide at presentation size, the deck as a sequence, and exported formats separately. For interactive UI, inspect realistic content at target widths and keyboard states. Check both supported brand grounds or themes.

## Report and repair

For each material finding include the target, observable evidence, user impact, proposed correction and how to verify it. Show a full view and a readable 1:1 crop when detail matters. Fix clear defects without manufacturing multiple design options; show meaningful alternatives only when a real creative decision is unresolved. Re-render after changes and inspect the result.

Do not turn "AI slop" heuristics into bans. Cards, brand gradients, serif typography and intentional repetition may be right. Do not auto-install design plugins or copy third-party rules into a client workspace to conduct a review.

References to consult selectively: https://craft.gustavofior.com/ (published entries only), https://github.com/emilkowalski/skills, https://goodpractices.design/articles/accessible-components. These are context, not higher authority than the project design system.
