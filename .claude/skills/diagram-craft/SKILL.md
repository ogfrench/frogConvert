---
name: diagram-craft
description: >-
  Create editable, source-grounded Mermaid and clean diagrams. Use for
  architecture, components, processes and sequences.
---

# Diagram craft

Create diagrams that communicate **verified relationships**, not decorative boxes. Prefer a small editable source diagram over a beautiful but invented image. Use the existing project's design system where available. A user asking for a visual does not authorize changing repository architecture or inventing components.

## Pick the diagram and abstraction

1. Identify the audience and question: *what should someone understand or decide?*
2. Choose only the useful level: system landscape/context for a product overview; container/component for technical ownership; sequence for request paths; flowchart for a process; state diagram for state transitions; ER for data relationships. Do not mix levels in one crowded figure.
3. For a real system, inspect the relevant source, manifests and boundary tests. Distinguish **implemented**, **documented**, **inferred** and **proposed** relationships. Never invent a runtime, plugin connection, component, transport, deployment or data direction to fill space.
4. If the source is not accessible, make a clearly labeled conceptual diagram using only supplied information. Say which evidence is missing rather than implying code inspection.

## Create the editable diagram first

- Start with Mermaid for relationships that can be represented faithfully. Use short, precise node names; directional, labeled edges when their meaning is not obvious; and a single consistent reading direction. Split a dense system into overview and technical detail instead of shrinking everything.
- Default to restrained visual design: neutral background, high-contrast text, thin strokes, generous whitespace and at most one purposeful accent. No compulsory icons, emojis, gradients, rainbow category colors or ornamental cards.
- Prefer standard Mermaid syntax supported by the target renderer. Avoid assuming a layout engine, fonts, config directives or export capability without checking the host. Keep the source intact so someone can revise it.
- Keep node labels and line breaks readable at the **actual viewing size**. Don't confuse a package/skill dependency with a data flow or an installed/active host connection.

## Render, inspect and deliver

1. Where a renderer is available, render the **actual Mermaid source** to SVG or PNG and inspect the output, including labels, edge direction, clipping, overlap, contrast and mobile/slide-scale legibility. Re-render after fixes. Use `visual-loop` for substantial visual QA.
2. Where an image generator is used for an *illustrative* picture, treat it as an optional second artifact; verify its words and relationships against the source. Never present generated artwork as a faithful source-derived technical diagram without checking it.
3. Supply the editable Mermaid code with the render where supported. When an export/render tool is unavailable, provide Mermaid source and state the limitation. Do not pretend a PNG, SVG, screenshot, PDF or visual check exists.
4. For high-impact architecture diagrams, include relevant source paths and verification status separately from the figure. For an executive visual, omit unnecessary infrastructure detail without dropping material trust boundaries.

See [example patterns](references/examples.md) for concise, reusable starting points and [visual composition](references/visual-composition.md) for professional diagram visuals. Consult the official [Mermaid syntax reference](https://mermaid.js.org/intro/syntax-reference) and [C4 levels](https://c4model.com/diagrams) when needed, not as a mandatory ceremony.

## Coordination

- `product-passport` owns persistent product/feature maps and their maintenance after code changes.
- `architecture-gardener` investigates structural defects and boundary drift, not diagram styling.
- `visual-loop` owns inspecting **rendered** visual output; `diagram-craft` owns fidelity and information structure.
- `presentation-craft` owns presentation storytelling/design. Diagram craft can supply a figure to a slide without replacing the deck workflow.
