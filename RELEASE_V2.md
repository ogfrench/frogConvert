# frogConvert v2.0.0 — The PDF Editor & 70+ Formats Milestone

The biggest update yet. v2.0.0 transforms frogConvert from a simple file converter into a comprehensive **PDF Workspace**, powered by a major architectural refactor and a full-stack security hardening pass.

## 🎨 The PDF Editor has arrived
No more juggling online tools. Toggle into **PDF Editor mode** from the top bar to:
* **Merge & Reorder**: Combine multiple PDFs and drag-and-drop pages into the perfect sequence.
* **Organize & Rotate**: Fix orientation, delete pages, or insert blanks.
* **Extract Range**: Pull exactly what you need with a refined selection UI.
* **Agent-Ready**: All PDF tools are exposed via **MCP** and **REST API** for your AI agents.

## 🚀 Better Conversion, Proactive UX
* **70+ Formats**: We've crossed the 70-format mark, covering everything from legacy Office docs to 3D exports.
* **Upload Overhaul**: Reach your flow faster. frogConvert now tells you *why* a file can't be added before you wait for a conversion. 
* **Smart Hints**: Proactive suggestions help you convert legacy `.doc` or `.xls` files by recommending modern counterparts.
* **Instant Pathfinding**: A new `TraversionGraph` engine makes finding conversion routes near-instant.

## 🛡️ Hardened for Production
A "Zero Trust" pass on the local API and worker logic makes this the most stable version yet:
* **Security**: Closes DNS-rebinding risks in the local API, adds Electron sandboxing, and sanitizes filenames against path-traversal.
* **Reliability Layer**: A new hard-cancel safety net ensures the UI never gets stuck "Converting..." if a worker hangs.
* **Safety First**: Archive-bomb protection and shape validation on all REST endpoints prevent malformed input crashes.

## 🏗️ Major Structural Refactor
The codebase has been reorganized into a clean, layered architecture. This unblocks faster feature development and makes the project significantly easier for contributors to navigate.

---
*See the [Full Changelog](CHANGELOG.md) for the complete list of 50+ improvements.*
