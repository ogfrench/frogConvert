# frogConvert — How It Works (Plain English)

This guide explains frogConvert for beginners and people who are new to the codebase. No prior experience required.

---

## What is frogConvert?

frogConvert is a **file converter that runs entirely in your browser**. You upload a file (like a `.jpg` image), pick an output format (like `.pdf`), and it converts it — without ever sending your file to any server.

Most online converters only handle obvious pairs: image-to-image, video-to-video. frogConvert can convert almost anything to almost anything — even a video to a PDF — by **chaining multiple conversion tools together automatically**.

It runs at [frogconvert.xyz](https://frogconvert.xyz) and is a fork of [Convert to it!](https://github.com/p2r3/convert).

---

## The Big Picture

```mermaid
flowchart LR
    U([👤 User]) -->|uploads file| B[Browser UI]
    B -->|asks: how do I get from A to B?| G[Route Finder\nTraversionGraph]
    G -->|finds a path| C[Conversion Engine\nFormatHandlers]
    C -->|runs tools in sequence| O[Output File]
    O -->|auto-download| U

    style U fill:#6ee7b7,stroke:#059669
    style O fill:#6ee7b7,stroke:#059669
    style B fill:#93c5fd,stroke:#3b82f6
    style G fill:#fcd34d,stroke:#d97706
    style C fill:#f9a8d4,stroke:#db2777
```

Everything stays inside your browser tab. Nothing leaves your computer.

---

## What Happens When You Convert a File

Here's the step-by-step flow, in plain terms:

```mermaid
flowchart TD
    A[You drop a file onto the page] --> B[Browser detects file type\ne.g. image/jpeg]
    B --> C[You pick an output format\ne.g. PDF]
    C --> D{Is there a direct\nconverter for this?}
    D -- Yes --> E[Run that converter]
    D -- No --> F[Route Finder calculates\na multi-step path\ne.g. JPG → PNG → PDF]
    F --> G[Step 1: Run Converter A\nJPG → PNG]
    G --> H[Step 2: Run Converter B\nPNG → PDF]
    E --> I[Output file ready]
    H --> I
    I --> J[Browser downloads the file]
```

---

## The Route Finder (TraversionGraph)

Think of all file formats as **cities on a map**, and each conversion tool as a **road** between cities.

The Route Finder uses **Dijkstra's algorithm** — the same logic a GPS uses — to find the cheapest path from your input format to your output format.

```mermaid
flowchart LR
    JPG((JPG)) -->|FFmpeg, cheap| PNG((PNG))
    JPG -->|FFmpeg, cheap| MP4((MP4))
    PNG -->|Pandoc, medium| PDF((PDF))
    MP4 -->|FFmpeg, cheap| MP3((MP3))
    WAV((WAV)) -->|FFmpeg, cheap| MP3

    style PDF fill:#fcd34d,stroke:#d97706
    style JPG fill:#93c5fd,stroke:#3b82f6
```

Costs go up when:
- The tool is **heavy to start** (like FFmpeg or ImageMagick)
- The conversion is **lossy** (loses quality)
- It **crosses media categories** (e.g., audio → image carries a big penalty to avoid absurd paths)

---

## Conversion Tools (Handlers)

Each converter is called a **handler**. A handler knows:
- Which input formats it accepts
- Which output formats it can produce
- How to actually do the conversion

```mermaid
classDiagram
    class FormatHandler {
        +name: string
        +supportedFormats: FileFormat[]
        +ready: boolean
        +requiresMainThread: boolean
        +init() void
        +doConvert(files, from, to) FileData[]
    }

    FormatHandler <|-- FFmpegHandler : audio/video
    FormatHandler <|-- ImageMagickHandler : images
    FormatHandler <|-- PandocHandler : documents
    FormatHandler <|-- CanvasToBlobHandler : browser-only
    FormatHandler <|-- JSONHandler : text formats
```

Some handlers are pure compute (run in a background thread). Others need browser features like `<canvas>` or `AudioContext` and must run on the main thread — that's what `requiresMainThread` controls.

### Handler Examples

| Handler | What it does | Runs where |
|---|---|---|
| `FFmpeg.ts` | Audio/video conversion | Background worker |
| `ImageMagick.ts` | Image conversion | Background worker |
| `pandoc.ts` | Documents (PDF, DOCX, MD…) | Background worker |
| `canvasToBlob.ts` | Encodes images using the browser's canvas | Main thread |
| `json.ts` | JSON ↔ other data formats | Background worker |
| `font.ts` | Font file conversion | Background worker |

---

## Web Workers (Why the Page Doesn't Freeze)

Converting a video can take seconds. If that ran on the browser's main thread, the whole page would lock up.

frogConvert uses **Web Workers** — background threads that run heavy work without touching the UI:

```mermaid
flowchart TD
    UI[Main Thread\nUI / Page stays responsive] -->|sends file + job| W1[conversion.worker.ts\nRuns doConvert in background]
    UI -->|asks for route| W2[route-search.worker.ts\nRuns Dijkstra in background]
    W1 -->|returns converted file| UI
    W2 -->|returns path| UI
```

Handlers with `requiresMainThread: true` are the exception — they need browser APIs that only exist on the main thread, so they run there.

---

## Code Structure at a Glance

```
frogConvert/
├── src/
│   ├── handlers/          ← Conversion tools (FFmpeg, ImageMagick, etc.)
│   ├── core/
│   │   ├── FormatHandler/ ← The FormatHandler interface + base classes
│   │   ├── TraversionGraph/ ← Route-finding algorithm (Dijkstra)
│   │   └── CommonFormats/ ← Registry of all MIME types and extensions
│   ├── workers/
│   │   ├── conversion.worker.ts  ← Runs handlers off the main thread
│   │   └── route-search.worker.ts ← Runs pathfinding off the main thread
│   ├── components/
│   │   ├── ConversionModal/ ← Progress popup + conversion orchestration
│   │   ├── FormatModal/    ← Format picker UI
│   │   ├── store/store.ts  ← Shared app state (current files, UI refs)
│   │   └── Frogsworth/     ← The mascot frog in the corner
│   ├── mcp/               ← MCP server for AI agents (Node.js, stdio)
│   └── api/               ← REST API server (HTTP on localhost:3000)
├── docs/
│   ├── AGENTS.md          ← Guide for AI agents using the MCP/REST API
│   ├── AGENT_CONTEXT.md   ← Deep architecture guide (also for AI agents)
│   └── OVERVIEW.md        ← This file — plain English intro
├── test/
│   ├── e2e/               ← End-to-end browser tests (Puppeteer)
│   └── *.test.ts          ← Unit tests (Vitest + jsdom)
└── README.md              ← Main docs, deployment, contributing guide
```

---

## State Management (Without React)

frogConvert doesn't use React or Vue. It's plain TypeScript + DOM manipulation.

Shared state lives in `store.ts` as simple objects:

```typescript
// Example from store.ts
export const currentFiles: { value: File[] } = { value: [] };
```

Components read and write `.value` directly. It's simple on purpose — fast to load, easy to trace.

---

## The Conversion Flow in Code

When you hit Convert, here's what actually happens:

```mermaid
sequenceDiagram
    actor User
    participant UI as ConversionModal.ts
    participant Worker as route-search.worker.ts
    participant CW as conversion.worker.ts
    participant Handler as e.g. FFmpeg

    User->>UI: clicks Convert
    UI->>Worker: "find path from JPG to PDF"
    Worker-->>UI: [FFmpeg → Pandoc]
    loop for each step in path
        UI->>CW: "run FFmpeg on these bytes"
        CW->>Handler: handler.doConvert(files, from, to)
        Handler-->>CW: converted bytes
        CW-->>UI: done, here are the bytes
    end
    UI->>User: download file
```

---

## The MCP Server & REST API

frogConvert also exposes its conversion engine as a **local server** — so scripts, automation tools, and AI assistants can trigger conversions without opening a browser.

```mermaid
flowchart LR
    A[AI Agent\nor Script] -->|MCP stdio| M[MCP Server\nsrc/mcp/]
    A -->|HTTP POST /convert| R[REST API\nsrc/api/]
    M --> E[Same Conversion Engine]
    R --> E
    E --> O[Output File]
```

Both run 100% locally. No internet needed. See [AGENTS.md](AGENTS.md) for usage.

---

## Key Terms Glossary

| Term | What it means |
|---|---|
| **Handler** | A wrapper around one conversion tool (FFmpeg, Pandoc, etc.) |
| **FormatHandler** | The TypeScript interface every handler must follow |
| **TraversionGraph** | The route-finding system that chains handlers together |
| **Web Worker** | A background thread in the browser — keeps the UI responsive |
| **requiresMainThread** | A flag that tells the engine "this handler needs browser APIs, don't offload it" |
| **FileFormat** | An object describing a format: its name, MIME type, extension, category |
| **FileData** | A wrapper for a file's bytes (`Uint8Array`) and its name |
| **MCP** | Model Context Protocol — a standard way for AI agents to call tools |
| **Dijkstra** | A graph algorithm that finds the cheapest path (here: fewest/cheapest conversion steps) |
| **WASM** | WebAssembly — compiled native code (like FFmpeg) that runs inside a browser |

---

## How to Add a New Format (Summary for Beginners)

1. Create a new file in `src/handlers/myFormat.ts`
2. Implement the `FormatHandler` interface — define which formats you accept/output
3. Register your handler in `src/handlers/index.ts`
4. The route finder automatically includes your handler in the graph — no other wiring needed

See the full guide in the README — "Creating a Handler" section.
