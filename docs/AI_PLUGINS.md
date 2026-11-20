<!-- docs-frontmatter
icon: ◇
label: AI Plugins
desc: Claude and ChatGPT desktop integrations
-->

# frogConvert for AI

<div class="ai-plugins">

<section class="ai-intro" aria-label="Plugin overview">
  <div class="ai-intro-topline"><span class="ai-intro-mark" aria-hidden="true"></span> Local-first file tools for AI</div>
  <p class="ai-intro-lead">From a prompt to the finished file.</p>
  <p class="ai-intro-copy">Native desktop builds provide local file tools where the host supports MCP execution. A separate Claude workspace ZIP installs the same guidance skills, without a bundled executable or conversion service.</p>
  <div class="ai-intro-rail" aria-label="Plugin characteristics">
    <span>Native desktop runtime</span>
    <span>Shared conversion engine</span>
    <span>Originals preserved by default</span>
  </div>
</section>

<div class="ai-status" role="status">
  <div class="ai-status-indicator" aria-hidden="true"></div>
  <div>
    <strong>GitHub archives published; real-client acceptance pending.</strong>
    <p>The v3.5.4 release adds a portable Claude workspace ZIP alongside native Claude and ChatGPT builds. Workspace skills do not execute conversions by themselves; native builds still require supported local hosts and real-client verification. See the <a href="https://github.com/ogfrench/frogConvert/releases/latest">latest GitHub release</a> for downloadable assets.</p>
  </div>
</div>

<section aria-labelledby="ai-platforms">
  <div class="ai-section-heading">
    <div><p class="ai-overline">01 / Choose your workspace</p><h2 id="ai-platforms">Two clients. One conversion engine.</h2></div>
    <p>Choose the Claude workspace skills ZIP for web/Cowork upload, or a native platform ZIP for local MCP in Claude Code. ChatGPT native ZIPs remain unverified local desktop candidates.</p>
  </div>
  <div class="ai-client-grid">
    <article class="ai-client ai-client-claude">
      <div class="ai-client-upper">
        <span class="ai-client-symbol" aria-hidden="true">C</span>
        <span class="ai-client-phase">Build validation</span>
      </div>
      <h3>Claude Code</h3>
      <p class="ai-client-description">Native local MCP on a compatible host. Claude workspace upload requires the separate skills-only ZIP described below.</p>
      <ul class="ai-client-specs">
        <li>Local MCP tools and reusable skills</li>
        <li>Platform-specific native executable</li>
        <li>No Bun installation on the destination machine</li>
      </ul>
      <div class="ai-client-footer">
        <a class="ai-client-action" href="https://github.com/ogfrench/frogConvert/actions/workflows/ai-plugins.yml">View build status <span aria-hidden="true">↗</span></a>
        <a class="ai-client-secondary" href="#install-claude">Installation details</a>
      </div>
    </article>
    <article class="ai-client ai-client-chatgpt">
      <div class="ai-client-upper">
        <span class="ai-client-symbol" aria-hidden="true">G</span>
        <span class="ai-client-phase">Unverified ChatGPT desktop preview</span>
      </div>
      <h3>ChatGPT Desktop</h3>
      <p class="ai-client-description">A packaged local MCP candidate. The ChatGPT desktop client must support and approve this local executable before it can be installed.</p>
      <ul class="ai-client-specs">
        <li>Same conversion capabilities and skill names</li>
        <li>Native MCP process on your own computer</li>
        <li>Public distribution subject to OpenAI approval</li>
      </ul>
      <div class="ai-client-footer">
        <a class="ai-client-action" href="https://github.com/ogfrench/frogConvert/pull/123">View merged source <span aria-hidden="true">↗</span></a>
        <a class="ai-client-secondary" href="#install-chatgpt">Installation details</a>
      </div>
    </article>
  </div>
  <p class="ai-under-cards">These links open the source and build status. They are intentionally <strong>not</strong> presented as working installers.</p>
</section>

<section aria-labelledby="ai-capabilities">
  <div class="ai-section-heading">
    <div><p class="ai-overline">02 / What it can do</p><h2 id="ai-capabilities">Four skills, eight MCP tools.</h2></div>
    <p>Skills route a natural-language request to the right operation. Tool availability is checked in the installed environment.</p>
  </div>
  <div class="ai-capability-grid">
    <div class="ai-capability"><span class="ai-capability-index">01</span><div><h3>Convert files</h3><p>CSV, JSON and related native data formats in the initial Essentials build. Other conversion engines are gated on validation.</p></div></div>
    <div class="ai-capability"><span class="ai-capability-index">02</span><div><h3>Edit PDFs</h3><p>Merge documents, reorder pages, extract pages and add text watermarks without altering the originals.</p></div></div>
    <div class="ai-capability"><span class="ai-capability-index">03</span><div><h3>Compress files</h3><p>The compression MCP tool is exposed, but image, media and PDF compression support is not claimed until its engines pass packaging tests.</p></div></div>
    <div class="ai-capability"><span class="ai-capability-index">04</span><div><h3>Inspect formats</h3><p>See which formats and routes are genuinely available on this machine, instead of relying on the broader website catalog.</p></div></div>
  </div>
</section>

<section class="ai-prompt-showcase" aria-label="Example prompt">
  <div class="ai-prompt-heading"><span>TRY A NATURAL-LANGUAGE REQUEST</span><span class="ai-prompt-dots" aria-hidden="true">···</span></div>
  <blockquote>“Merge these three PDFs in the order I gave them, and save the result as a new file.”</blockquote>
  <p>frogConvert's PDF tools receive the file paths, carry out the operation locally, and return the saved path or an explicit error. This is an example request, not a live demo.</p>
  <p class="ai-under-cards"><strong>After installing a verified build, try:</strong> "List the conversion formats available on this computer"; "Convert this CSV to JSON and keep the original"; "Merge these PDFs, then extract pages 2 to 4 from the result." These are acceptance prompts, not proof that every route is packaged.</p>
</section>

<section aria-labelledby="ai-setup">
  <div class="ai-section-heading">
    <div><p class="ai-overline">03 / Installation</p><h2 id="ai-setup">An installation flow that stays simple.</h2></div>
    <p>The published release has native archives and checksums; inspect the selected ZIP for its executable, manifest, MCP configuration and skills. Separate steps for each client are below.</p>
  </div>
</section>

</div>

### Claude Code

<div id="install-claude" class="ai-install-note">
<strong>Native Claude Code installation candidate.</strong> Download the platform-specific `frogconvert-claude-<platform>-v3.5.4.zip`, extract it and point Claude Code at the contained `frogconvert` directory:
</div>

```sh
claude --plugin-dir /absolute/path/to/frogconvert
```

The native ZIP includes `.claude-plugin/plugin.json`, `.mcp.json`, `skills/` and `bin/frogconvert` (or `frogconvert.exe` on Windows). Confirm tool discovery and real conversions in `/mcp`. **Do not upload the native ZIP to the Claude web/Cowork plugin uploader.**

### Claude workspace upload (web and Cowork)

Select **`frogconvert-claude-workspace-v3.5.4.zip`** in Claude's **Upload a plugin** dialog. It has `.claude-plugin/plugin.json` at the archive root and the four `skills/` definitions. It does **not** contain `bin/`, a local MCP executable or `.mcp.json`. Uploading it installs workflow guidance only; file conversion requires an independently supported MCP connection. No conversion capability is claimed for Claude chat from this package alone. Verify acceptance in the actual Claude uploader.

### ChatGPT Desktop

<div id="install-chatgpt" class="ai-install-note">
<strong>Archive published; ChatGPT host execution unverified.</strong> The ChatGPT native packages retain <code>plugin.json</code>, <code>mcp.json</code> and a platform-specific executable. A new release or green CI does not establish ChatGPT desktop import, authorization or functional local MCP tool calls. Do not upload the Claude workspace ZIP as a ChatGPT native installer.
</div>

OpenAI restricts public distribution of desktop-only plugins with local MCP to approved partners. The package is **not generally installable yet**. Do not assume ChatGPT web or mobile can execute local binaries. See <a href="https://developers.openai.com/plugins/deploy/desktop-only">OpenAI's desktop-only plugin requirements</a>.

### Privacy and safe file handling

<div class="ai-safety-grid">
  <div><strong>Local processing</strong><p>The converter runs on the machine hosting the MCP server. No hosted frogConvert conversion backend is required.</p></div>
  <div><strong>AI-client data</strong><p>File paths, names, contents or tool responses shared with the client may be processed by its model provider. Local conversion is not a guarantee of model-side privacy.</p></div>
  <div><strong>Filesystem access</strong><p>The MCP process can read and write files you authorize. The sandbox-root option is not equivalent to an OS security sandbox, and symlink handling remains under review.</p></div>
  <div><strong>Safe defaults</strong><p>Essentials disables the Chromium browser bridge and refuses to overwrite existing output paths. Unsupported formats return errors.</p></div>
</div>

Read the <a href="INTEGRATIONS.md">MCP and REST reference</a> and <a href="../SECURITY.md">security documentation</a> for technical details.

### Published artifacts and attribution

The [v3.5.4 release](https://github.com/ogfrench/frogConvert/releases/tag/v3.5.4) is configured to publish one cross-platform Claude workspace skills ZIP plus eight native Claude/ChatGPT archives (Linux x64, Windows x64, macOS ARM64 and macOS x64), with SHA-256 checksums. Downloadable binary candidates do not prove host approval or working tool calls. Verify the release exists and checksums match before installing.

The website footer now reads `designed by François` with a monochrome FPE
signature directly after the name, 9 px high and baseline-aligned in the footer's
own ink. It has no separate link, color treatment or tracking.

### Immutable release identity

The tag must resolve to the same reviewed source commit used by the release
workflow. A published GitHub release cannot be overwritten, even by a job
rerun; failed unpublished drafts may be rebuilt in place. To correct published
binaries, make a new version and release. Check both plugin and desktop
checksums independently.

### What still needs host acceptance?

Package and clean-folder build tests are distinct from client import, permissions, tool discovery, actual native/WASM conversion and safe failures. Verify those journeys on the intended host/OS before claiming the integration works. Check the <a href="https://github.com/ogfrench/frogConvert/actions/workflows/ai-plugins.yml">AI plugin packaging workflow</a> and <a href="https://github.com/ogfrench/frogConvert/pull/123">merged implementation</a> for engineering evidence. Neither is proof of ChatGPT host approval.

<div class="ai-endnote">
  <strong>Need a format outside Essentials?</strong>
  <p>Use <a href="https://frogconvert.xyz">frogConvert on the web</a> or the existing <a href="INTEGRATIONS.md">full MCP/REST integration</a>. The website has broader conversion coverage than the native plugin package.</p>
</div>
