# Clean visual composition for system diagrams

These are design defaults, not a substitute for the project's actual design system.

## Editorial treatment

- Start with a white or warm-white canvas, charcoal text, subtle gray boundaries and one purposeful accent. Avoid saturated category palettes.
- Use a strict alignment grid; group by ownership, trust boundary or process stage. Spacing must explain relationships.
- Prefer short direct labels over sentences. One typographic family, two or three text sizes, consistent edge weights and arrowheads.
- Avoid 3D symbols, floating platform graphics, thick gradients, oversized cards, invented brand marks and redundant explanatory captions.
- Make the primary flow visually obvious. If there are more than roughly seven peer elements, consider overview + detail rather than forced miniaturization.
- Distinguish arrows conveying data flow, invocation and dependency. Label ambiguous connectors. Never silently reverse them for composition.

## Two useful deliverables

1. **Precise technical graph:** Mermaid source plus deterministic renderer output (SVG preferred), with source-grounded nodes, ports and edges. Inspect output at final size.
2. **Executive picture:** a restrained visual simplification of the same verified relationships. It may be image-generated only when an illustrative picture is actually requested. If image generation is used, inspect and correct labels and arrows; do not call it a faithful render of Mermaid.

For an illustrative image request, describe the visual brief rather than using vague terms like "beautiful architecture": *flat editorial vector diagram, ample white space, black/gray typography, one accent, 1px connections, simple square-corner or modest-radius modules, no mascot/3D/glow, preserve the supplied exact labels and flow*. This is a preference, not a universal brand rule.

## Inspection checklist

Read at presentation size and on mobile when relevant: all labels present and correct, no crossing/ambiguous edge directions, consistent spacing, no cropped arrows, sufficient contrast and clearly marked assumptions. Inspect SVG or PNG, not just Mermaid syntax. Distinguish an illustrative mock from tested technical architecture.
