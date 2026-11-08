#!/usr/bin/env python3
"""Build deterministic preview ZIPs for the Claude and ChatGPT frogConvert plugins."""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "integrations" / "ai-plugins"
SKILLS = SOURCE / "shared" / "skills"
PLATFORMS = ("claude", "chatgpt")


def plugin_files(platform, version):
    source = SOURCE / platform
    files = {}
    for path in source.rglob("*"):
        if path.is_file():
            relative = path.relative_to(source).as_posix()
            content = path.read_bytes()
            if relative in ("plugin.json", ".claude-plugin/plugin.json"):
                manifest = json.loads(content)
                manifest["version"] = version
                content = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
            if relative in ("mcp.json", ".mcp.json"):
                config = json.loads(content)
                config["mcpServers"]["frogconvert"]["args"] = [
                    f"frogconvert@{version}", "mcp"
                ]
                content = (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode()
            files[relative] = content

    for path in SKILLS.rglob("SKILL.md"):
        relative = "skills/" + path.relative_to(SKILLS).as_posix()
        files[relative] = path.read_bytes()

    manifest_name = ".claude-plugin/plugin.json" if platform == "claude" else "plugin.json"
    mcp_name = ".mcp.json" if platform == "claude" else "mcp.json"
    manifest = json.loads(files[manifest_name])
    mcp = json.loads(files[mcp_name])
    assert manifest["name"] == "frogconvert"
    assert manifest["version"] == version
    assert mcp["mcpServers"]["frogconvert"]["args"] == [f"frogconvert@{version}", "mcp"]
    assert len([x for x in files if x.endswith("/SKILL.md")]) == 4
    for name, data in files.items():
        assert ".." not in Path(name).parts and not name.startswith("/")
        if name.endswith("/SKILL.md"):
            assert data.startswith(b"---\n") and b"\nname:" in data
    return files


def build(output):
    version = json.loads((ROOT / "package.json").read_text())["version"]
    output.mkdir(parents=True, exist_ok=True)
    checksums = []
    for platform in PLATFORMS:
        archive = output / f"frogconvert-{platform}.zip"
        with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=9) as zipfile:
            for name, data in sorted(plugin_files(platform, version).items()):
                info = ZipInfo("frogconvert/" + name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                zipfile.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        checksums.append(f"{digest}  {archive.name}")
    (output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ROOT / "dist" / "ai-plugins")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    build(args.out)
    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            duplicate = build(Path(tmp))
            for original in args.out.iterdir():
                other = duplicate / original.name
                if original.read_bytes() != other.read_bytes():
                    raise SystemExit(f"Non-reproducible package: {original.name}")
        for platform in PLATFORMS:
            with ZipFile(args.out / f"frogconvert-{platform}.zip") as z:
                paths = set(z.namelist())
                assert all(p.startswith("frogconvert/") for p in paths)
                assert len([p for p in paths if p.endswith("/SKILL.md")]) == 4
    print(f"Built frogConvert AI plugin previews in {args.out}")


if __name__ == "__main__":
    main()
