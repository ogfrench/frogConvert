#!/usr/bin/env python3
"""Package self-contained native MCP executables, manifests, and shared skills."""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "integrations" / "ai-plugins"
SKILLS = SOURCE / "shared" / "skills"
CLIENTS = ("claude", "chatgpt")
TARGETS = ("linux-x64", "windows-x64", "macos-arm64", "macos-x64")


def plugin_files(client, version, target, binary):
    if client not in CLIENTS or target not in TARGETS:
        raise ValueError("Unknown client or target")
    if binary.is_symlink() or not binary.is_file() or binary.stat().st_size < 1024:
        raise ValueError("A regular compiled native executable is required (no symlinks)")
    if (SOURCE / client).is_symlink() or SKILLS.is_symlink():
        raise ValueError("Plugin source directories must not be symlinks")
    files = {}
    for path in (SOURCE / client).rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinked plugin source must not be packaged: {path}")
        if path.is_file():
            name = path.relative_to(SOURCE / client).as_posix()
            data = path.read_bytes()
            if name in ("plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"):
                manifest = json.loads(data)
                manifest["version"] = version
                data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
            files[name] = data

    binary_name = "frogconvert.exe" if target.startswith("windows") else "frogconvert"
    mcp_name = ".mcp.json" if client == "claude" else "mcp.json"
    manifest_name = ".claude-plugin/plugin.json" if client == "claude" else "plugin.json"
    mcp = json.loads(files[mcp_name])
    server = mcp["mcpServers"]["frogconvert"]
    server["command"] = (
        "${CLAUDE_PLUGIN_ROOT}" if client == "claude" else "${PLUGIN_ROOT}"
    ) + "/bin/" + binary_name
    server["args"] = ["mcp"]
    files[mcp_name] = (json.dumps(mcp, indent=2) + "\n").encode()
    files["bin/" + binary_name] = binary.read_bytes()
    for name in ("LICENSE", "LICENSE.upstream-GPLv2", "COPYRIGHT"):
        notice = ROOT / name
        if notice.is_symlink() or not notice.is_file():
            raise ValueError(f"Plugin legal notice must be a regular file: {name}")
        files[name] = notice.read_bytes()

    icon = ROOT / "public/icon-512.png"
    if icon.is_symlink() or not icon.is_file():
        raise ValueError("App icon must be a regular file (no symlinks)")
    data = icon.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("App icon must be a valid PNG")
    files["assets/frogconvert-icon.png"] = data

    for path in SKILLS.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinked shared skill must not be packaged: {path}")
    for path in SKILLS.rglob("SKILL.md"):
        files["skills/" + path.relative_to(SKILLS).as_posix()] = path.read_bytes()

    files["INSTALL.md"] = (
        "# frogConvert native desktop plugin\n\n"
        f"Client: {client}\n\nTarget: {target}\n\nEngine: frogConvert {version}\n\n"
        "This ZIP includes the executable and requires no separate Bun installation. "
        "The agent will start it as a local MCP server. It is a release candidate, "
        "not evidence that optional format runtimes and browser-only conversions work. "
        "Run the clean-machine tests and review the platform requirements before distribution.\n"
    ).encode()

    assert json.loads(files[manifest_name])["version"] == version
    assert server["command"].endswith("/bin/" + binary_name)
    assert len([x for x in files if x.endswith("/SKILL.md")]) == 4
    for name in files:
        assert not name.startswith("/") and ".." not in Path(name).parts
    return files


def workspace_files(version):
    """Claude web/Cowork upload: portable skills only, no local executable or MCP promise."""
    source = SOURCE / "claude" / ".claude-plugin" / "plugin.json"
    if source.is_symlink() or (SOURCE / "claude").is_symlink() or SKILLS.is_symlink():
        raise ValueError("Workspace plugin sources must not be symlinks")
    manifest = json.loads(source.read_bytes())
    manifest["version"] = version
    manifest["description"] = (
        "Guide file conversions and PDF editing; requires a separately configured "
        "frogConvert MCP server to execute operations."
    )
    files = {
        ".claude-plugin/plugin.json": (json.dumps(manifest, indent=2) + "\n").encode(),
        "INSTALL.md": (
            "# frogConvert for Claude workspace\n\n"
            "Skills-only edition for Claude web and Cowork plugin upload. "
            "It contains no local executable, no MCP server configuration, "
            "and does not itself perform file conversions. "
            "Actual conversion requires a separately available, approved frogConvert MCP connection.\n\n"
            "For local native MCP execution in Claude Code, install the matching "
            "platform-specific frogConvert Claude archive instead. "
            "Do not upload the native archive to Claude's workspace plugin uploader.\n"
        ).encode(),
    }
    for name in ("LICENSE", "LICENSE.upstream-GPLv2", "COPYRIGHT"):
        notice = ROOT / name
        if notice.is_symlink() or not notice.is_file():
            raise ValueError(f"Plugin legal notice must be a regular file: {name}")
        files[name] = notice.read_bytes()
    for path in SKILLS.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinked shared skill must not be packaged: {path}")
    for path in SKILLS.rglob("SKILL.md"):
        files["skills/" + path.relative_to(SKILLS).as_posix()] = path.read_bytes()
    assert len([name for name in files if name.endswith("/SKILL.md")]) == 4
    assert not any(name.startswith("bin/") or name.endswith(".exe") for name in files)
    assert ".mcp.json" not in files
    return files


def write_archive(archive, files, prefix=""):
    with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=6) as z:
        for name, data in sorted(files.items()):
            info = ZipInfo(prefix + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            is_exe = name.startswith("bin/")
            info.external_attr = (0o755 if is_exe else 0o644) << 16
            z.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=6)


def build(output, target, binary):
    version = json.loads((ROOT / "package.json").read_text())["version"]
    # Validate both clients before creating any archive, including empty ZIP files.
    packages = {client: plugin_files(client, version, target, binary) for client in CLIENTS}
    output.mkdir(parents=True, exist_ok=True)
    checksums = []
    for client in CLIENTS:
        filename = f"frogconvert-{client}-{target}-v{version}.zip"
        archive = output / filename
        write_archive(archive, packages[client], "frogconvert/")
        checksums.append(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {filename}")
    # Ship one platform-independent account-upload package, not four duplicates.
    if target == "linux-x64":
        filename = f"frogconvert-claude-workspace-v{version}.zip"
        archive = output / filename
        write_archive(archive, workspace_files(version))
        checksums.append(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {filename}")
    (output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, choices=TARGETS)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=ROOT / "dist" / "ai-plugins")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    # Keep the user-supplied path intact so the symlink guard can inspect it.
    binary = args.binary.absolute()
    build(args.out, args.target, binary)
    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            duplicate = build(Path(tmp), args.target, binary)
            for original in args.out.iterdir():
                assert original.read_bytes() == (duplicate / original.name).read_bytes()
        for archive in args.out.glob("*.zip"):
            with ZipFile(archive) as z:
                paths = z.namelist()
                assert len([p for p in paths if p.endswith("/SKILL.md")]) == 4
                if archive.name.startswith("frogconvert-claude-workspace-"):
                    assert ".claude-plugin/plugin.json" in paths
                    assert not any(p.startswith("bin/") or p.startswith("frogconvert/") for p in paths)
                    assert not any(p.endswith(".exe") or p.endswith(".mcp.json") for p in paths)
                else:
                    assert len([p for p in paths if p.startswith("frogconvert/bin/")]) == 1
                    for path in paths:
                        assert path.startswith("frogconvert/") and ".." not in Path(path).parts
    print(f"Built native frogConvert plugin packages for {args.target} in {args.out}")


if __name__ == "__main__":
    main()
