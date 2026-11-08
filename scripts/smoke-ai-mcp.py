#!/usr/bin/env python3
"""Smoke-test a compiled frogConvert MCP binary without the source repository."""
import argparse
import json
import os
import select
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

EXPECTED = {
    "list_formats", "find_conversion_path", "convert_file", "compress_file",
    "pdf_merge", "pdf_organize", "pdf_extract", "pdf_watermark",
}


def read_response(proc, request_id, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"MCP server exited with {proc.returncode}")
        ready, _, _ = select.select([proc.stdout], [], [], 0.5)
        if not ready:
            continue
        line = proc.stdout.readline()
        if not line:
            continue
        msg = json.loads(line)
        if msg.get("id") == request_id:
            return msg
    raise TimeoutError(f"No response for MCP request {request_id}")


def send(proc, message):
    proc.stdin.write((json.dumps(message) + "\n").encode("utf-8"))
    proc.stdin.flush()


def smoke(binary):
    with tempfile.TemporaryDirectory() as temp:
        copied = Path(temp) / "frogconvert-mcp"
        shutil.copy2(binary, copied)
        copied.chmod(0o755)
        proc = subprocess.Popen(
            [str(copied), "mcp"],
            cwd=temp,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "FROGCONVERT_SANDBOX_ROOT": temp},
        )
        failure = None
        try:
            send(proc, {
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "frogconvert-smoke", "version": "1.0"}
                }
            })
            initialized = read_response(proc, 1)
            if "result" not in initialized:
                raise AssertionError(f"initialize failed: {initialized}")
            send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})
            send(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            reply = read_response(proc, 2)
            names = {tool["name"] for tool in reply["result"]["tools"]}
            if names != EXPECTED:
                raise AssertionError(f"Expected {sorted(EXPECTED)}, got {sorted(names)}")
            print(f"Standalone MCP handshake succeeded, {len(names)} tools listed")
        except Exception as exc:
            failure = exc
        finally:
            proc.terminate()
            try:
                _, stderr = proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                _, stderr = proc.communicate()
        if failure:
            print(stderr.decode("utf-8", errors="replace")[-6000:])
            raise failure


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    smoke(args.binary.resolve())
