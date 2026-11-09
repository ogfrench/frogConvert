import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_ai_plugins", ROOT / "scripts/build-ai-plugins.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PluginPackagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.binary = self.path / "fake-bin"
        self.binary.write_bytes(b"binary-fixture" * 200)

    def test_source_chatgpt_manifest_matches_engine(self):
        manifest = json.loads((ROOT / "integrations/ai-plugins/chatgpt/plugin.json").read_text())
        engine = json.loads((ROOT / "package.json").read_text())
        self.assertEqual(manifest["version"], engine["version"])
        self.assertEqual(manifest["name"], "frogconvert")
        self.assertEqual(manifest["extensions"]["com.openai"]["interface"]["displayName"], "frogConvert")
        claude = json.loads((ROOT / "integrations/ai-plugins/claude/.claude-plugin/plugin.json").read_text())
        self.assertEqual(claude["version"], engine["version"])
        release_notes = (ROOT / ".github/RELEASE_NOTES.md").read_text()
        version = engine["version"]
        self.assertIn("## What\u0027s new in " + version, release_notes)
        changelog = (ROOT / "CHANGELOG.md").read_text()
        self.assertIn(f"## [{version}]", changelog)

    def test_required_native_binary(self):
        with self.assertRaises(ValueError):
            builder.plugin_files("claude", "3.4.7", "linux-x64", self.path / "missing")
        with self.assertRaises(ValueError):
            builder.plugin_files("claude", "3.4.7", "linux-x64", self.path / "empty")

    def test_both_clients_and_targets(self):
        version = json.loads((ROOT / "package.json").read_text())["version"]
        for target in builder.TARGETS:
            for client in builder.CLIENTS:
                files = builder.plugin_files(client, version, target, self.binary)
                mcp_path = ".mcp.json" if client == "claude" else "mcp.json"
                manifest_path = ".claude-plugin/plugin.json" if client == "claude" else "plugin.json"
                mcp = json.loads(files[mcp_path])["mcpServers"]["frogconvert"]
                expected_name = "frogconvert.exe" if target.startswith("windows") else "frogconvert"
                self.assertEqual(mcp["args"], ["mcp"])
                self.assertEqual(mcp["env"]["FROGCONVERT_DISABLE_BROWSER_BRIDGE"], "1")
                self.assertEqual(mcp["env"]["FROGCONVERT_DENY_OVERWRITE"], "1")
                self.assertEqual(mcp["env"]["FROGCONVERT_ESSENTIALS"], "1")
                self.assertEqual(mcp["command"], (
                    "${CLAUDE_PLUGIN_ROOT}" if client == "claude" else "${PLUGIN_ROOT}"
                ) + "/bin/" + expected_name)
                self.assertEqual(files["bin/" + expected_name], self.binary.read_bytes())
                for notice in ("LICENSE", "LICENSE.upstream-GPLv2", "COPYRIGHT"):
                    self.assertEqual(files[notice], (ROOT / notice).read_bytes())
                self.assertEqual(json.loads(files[manifest_path])["version"], version)
                self.assertEqual(len([x for x in files if x.endswith("/SKILL.md")]), 4)

    def test_zip_contains_executable_and_valid_checksums(self):
        first = builder.build(self.path / "a", "linux-x64", self.binary)
        second = builder.build(self.path / "b", "linux-x64", self.binary)
        self.assertEqual(sorted(x.name for x in first.iterdir()), sorted(x.name for x in second.iterdir()))
        for p in first.iterdir():
            self.assertEqual(p.read_bytes(), (second / p.name).read_bytes())
        sums = (first / "SHA256SUMS.txt").read_text()
        for archive in first.glob("*.zip"):
            self.assertIn(hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name, sums)
            with ZipFile(archive) as z:
                binary_info = z.getinfo("frogconvert/bin/frogconvert")
                self.assertEqual((binary_info.external_attr >> 16) & 0o777, 0o755)
                self.assertEqual(z.read(binary_info.filename), self.binary.read_bytes())
                for notice in ("LICENSE", "LICENSE.upstream-GPLv2", "COPYRIGHT"):
                    self.assertEqual(z.read("frogconvert/" + notice), (ROOT / notice).read_bytes())


if __name__ == "__main__":
    unittest.main()
