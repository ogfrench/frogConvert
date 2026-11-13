import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
import importlib.util
import shutil
import subprocess
from unittest.mock import patch

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

    def test_release_pipeline_includes_four_architectures_and_both_clients(self):
        workflow = (ROOT / ".github/workflows/electron.yml").read_text()
        self.assertIn("build-ai-plugins:", workflow)
        self.assertIn("needs: [preflight, build-electron, build-ai-plugins]", workflow)
        for target in ("linux-x64", "windows-x64", "macos-arm64", "macos-x64"):
            self.assertIn("target: " + target, workflow)
        self.assertIn("for client in claude chatgpt", workflow)
        self.assertIn("sha256sum -c SHA256SUMS.txt", workflow)
        self.assertIn("SHA256SUMS-AI-PLUGINS.txt", workflow)
        self.assertIn("files: installers/*", workflow)

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
                self.assertEqual(files["assets/frogconvert-icon.png"], (ROOT / "public/icon-512.png").read_bytes())
                if client == "chatgpt":
                    ui = json.loads(files["plugin.json"])["extensions"]["com.openai"]["interface"]
                    self.assertEqual(ui["logo"], "./assets/frogconvert-icon.png")
                    self.assertEqual(ui["composerIcon"], ui["logo"])
                    self.assertLessEqual(len(ui["shortDescription"]), 30)
                    compat = json.loads(files[".codex-plugin/plugin.json"])
                    self.assertEqual(compat["version"], version)
                    self.assertEqual(compat["interface"]["logo"], ui["logo"])
                self.assertEqual(len([x for x in files if x.endswith("/SKILL.md")]), 4)

    def test_rejects_symlinked_native_binary(self):
        external = self.path / "external-binary"
        external.write_bytes(b"secret-fixture" * 200)
        linked = self.path / "linked-executable"
        linked.symlink_to(external)
        with self.assertRaisesRegex(ValueError, "symlink"):
            builder.plugin_files("claude", "3.5.0", "linux-x64", linked)

    def test_cli_rejects_symlinked_native_binary(self):
        external = self.path / "outside-binary"
        external.write_bytes(b"unintended-local-content" * 100)
        linked = self.path / "linked-executable-cli"
        linked.symlink_to(external)
        output = self.path / "cli-output"

        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts/build-ai-plugins.py"),
                "--target", "linux-x64",
                "--binary", str(linked),
                "--out", str(output),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symlink", result.stderr)
        self.assertFalse(list(output.glob("*.zip")))

    def test_rejects_symlinked_plugin_content_and_shared_skill(self):
        version = json.loads((ROOT / "package.json").read_text())["version"]
        secret = self.path / "not-for-distribution.txt"
        secret.write_text("private local content")
        source = self.path / "source"
        shutil.copytree(builder.SOURCE, source)
        (source / "claude" / "unexpected.txt").symlink_to(secret)
        with patch.object(builder, "SOURCE", source), self.assertRaisesRegex(ValueError, "Symlinked plugin source"):
            builder.plugin_files("claude", version, "linux-x64", self.binary)

        skills = self.path / "skills"
        shutil.copytree(builder.SKILLS, skills)
        original = skills / "convert-files" / "SKILL.md"
        original.unlink()
        original.symlink_to(secret)
        with patch.object(builder, "SKILLS", skills), self.assertRaisesRegex(ValueError, "Symlinked shared skill"):
            builder.plugin_files("chatgpt", version, "linux-x64", self.binary)

    def test_rejects_chatgpt_symlink_before_writing_any_archive(self):
        secret = self.path / "unintended-chatgpt-content"
        secret.write_text("private fixture")
        source = self.path / "source"
        shutil.copytree(builder.SOURCE, source)
        (source / "chatgpt" / "unexpected.txt").symlink_to(secret)
        output = self.path / "packages"

        with patch.object(builder, "SOURCE", source), self.assertRaisesRegex(ValueError, "Symlinked plugin source"):
            builder.build(output, "linux-x64", self.binary)
        self.assertFalse(list(output.glob("*.zip")))

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
