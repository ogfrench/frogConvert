import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util

spec = importlib.util.spec_from_file_location("build_ai_plugins", ROOT / "scripts/build-ai-plugins.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PluginPackagingTest(unittest.TestCase):
    def test_manifests_and_skills(self):
        version = json.loads((ROOT / "package.json").read_text())["version"]
        for platform in ("claude", "chatgpt"):
            files = builder.plugin_files(platform, version)
            self.assertEqual(len([x for x in files if x.endswith("/SKILL.md")]), 4)
            manifest_key = ".claude-plugin/plugin.json" if platform == "claude" else "plugin.json"
            mcp_key = ".mcp.json" if platform == "claude" else "mcp.json"
            manifest = json.loads(files[manifest_key])
            mcp = json.loads(files[mcp_key])
            self.assertEqual(manifest["version"], version)
            self.assertEqual(mcp["mcpServers"]["frogconvert"]["args"], [f"frogconvert@{version}", "mcp"])
            if platform == "chatgpt":
                self.assertEqual(mcp["mcpServers"]["frogconvert"]["type"], "stdio")
                self.assertEqual(manifest["extensions"]["com.openai"]["requires_local_executor"], True)

    def test_archives_are_reproducible_and_contained(self):
        with tempfile.TemporaryDirectory() as left, tempfile.TemporaryDirectory() as right:
            builder.build(Path(left))
            builder.build(Path(right))
            for platform in ("claude", "chatgpt"):
                filename = f"frogconvert-{platform}.zip"
                self.assertEqual((Path(left) / filename).read_bytes(), (Path(right) / filename).read_bytes())
                with ZipFile(Path(left) / filename) as zipfile:
                    paths = zipfile.namelist()
                    self.assertTrue(paths)
                    self.assertTrue(all(x.startswith("frogconvert/") and ".." not in Path(x).parts for x in paths))


if __name__ == "__main__":
    unittest.main()
