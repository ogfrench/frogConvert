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
  <p class="ai-intro-copy">Convert data, organize PDFs, and work with local files directly from Claude or ChatGPT. No repository clone, account, or hosted conversion service is planned for the desktop plugin.</p>
  <div class="ai-intro-rail" aria-label="Plugin characteristics">
    <span>Native desktop runtime</span>
    <span>Shared conversion engine</span>
    <span>Originals preserved by default</span>
  </div>
</section>

<div class="ai-status" role="status">
  <div class="ai-status-indicator" aria-hidden="true"></div>
  <div>
    <strong>Engineering preview, not yet a public download.</strong>
    <p>The source implementation was merged in <a href="https://github.com/ogfrench/frogConvert/pull/123">PR #123</a> and hardened in <a href="https://github.com/ogfrench/frogConvert/pull/125">PR #125</a>. These are still unapproved plugin previews, not supported ChatGPT downloads. Download links will appear only after real-host installation, security and conversion tests pass.</p>
  </div>
</div>

<section aria-labelledby="ai-platforms">
  <div class="ai-section-heading">
    <div><p class="ai-overline">01 / Choose your workspace</p><h2 id="ai-platforms">Two clients. One conversion engine.</h2></div>
    <p>Both preview packages target the same eight-tool MCP server. Installation, approval and actual tool availability must be verified separately for each client.</p>
  </div>
  <div class="ai-client-grid">
    <article class="ai-client ai-client-claude">
      <div class="ai-client-upper">
        <span class="ai-client-symbol" aria-hidden="true">C</span>
        <span class="ai-client-phase">Build validation</span>
      </div>
      <h3>Claude Code</h3>
      <p class="ai-client-description">Recommended first validation target. Claude Cowork and Claude chat require independent import and tool-call checks.</p>
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
    <p>ZIP releases will include the executable, manifest, MCP configuration, skills and a checksum. Separate steps for each client are below.</p>
  </div>
</section>

</div>

### Claude Code

<div id="install-claude" class="ai-install-note">
<strong>Installation candidate.</strong> After a platform-specific build passes its clean-install checks, extract the Claude ZIP and point Claude Code to that folder:
</div>

```sh
claude --plugin-dir /absolute/path/to/frogconvert
```

The package includes `.claude-plugin/plugin.json`, `.mcp.json`, `skills/` and `bin/frogconvert` (or `frogconvert.exe` on Windows). Confirm the server and eight tools in `/mcp`. Claude Cowork is a separate validation target. Unverified archives are not supported installers.

### ChatGPT Desktop

<div id="install-chatgpt" class="ai-install-note">
<strong>Not yet available to install.</strong> The ChatGPT package uses portable <code>plugin.json</code> and <code>mcp.json</code> manifests with a bundled local executable. Source code and build checks exist, but a successful ChatGPT desktop import and real tool calls have not been demonstrated. Do not treat the source ZIP or GitHub Actions preview as an approved installer.
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

### Release candidate and attribution

The current source candidate is **v3.5.1** on [PR #135](https://github.com/ogfrench/frogConvert/pull/135).
A GitHub release should contain both Claude and ChatGPT native packages for
Linux x64, Windows x64, macOS ARM64 and macOS x64, with verified SHA-256 digests.
These are target-specific binary candidates, not proof of approval by any client
that does not support a local executable connector. Host checks remain required
before offering a public download.

The website footer now reads `designed by François` with a monochrome FPE
signature directly after the name, approximately 11 px high in the footer's
own ink. It has no separate link, color treatment or tracking.

### What needs to pass before release?

The release gate covers real conversions, packaging of native/WASM assets, Windows and macOS cold installs, client-specific plugin loading, security hardening and reproducible archives. The packaging workflow will not upload an installation preview unless its clean-folder runtime test passes. Check the <a href="https://github.com/ogfrench/frogConvert/actions/workflows/ai-plugins.yml">AI plugin packaging workflow</a> and <a href="https://github.com/ogfrench/frogConvert/pull/123">merged implementation</a> for engineering evidence. Neither is proof of ChatGPT host approval.

<div class="ai-endnote">
  <strong>Need a format outside Essentials?</strong>
  <p>Use <a href="https://frogconvert.xyz">frogConvert on the web</a> or the existing <a href="INTEGRATIONS.md">full MCP/REST integration</a>. The website has broader conversion coverage than this native plugin preview.</p>
</div>
