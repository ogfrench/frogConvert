#!/usr/bin/env python3
"""Verify that a compiled frogConvert binary works from an empty directory."""
import argparse
import base64
import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

EXPECTED = {
    "list_formats", "find_conversion_path", "convert_file", "compress_file",
    "pdf_merge", "pdf_organize", "pdf_extract", "pdf_watermark",
}


def minimal_pdf():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = [0]
    for n, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += str(n).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 4\n0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    return out + b"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n"


def start_reader(stream, out):
    def read():
        for line in iter(stream.readline, b""):
            try:
                out.put(json.loads(line))
            except json.JSONDecodeError:
                out.put({"unparseable": line.decode(errors="replace")})
    thread = threading.Thread(target=read, daemon=True)
    thread.start()


def request(proc, messages, response_queue, request_id, timeout=90):
    proc.stdin.write((json.dumps(messages) + "\n").encode())
    proc.stdin.flush()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"MCP binary exited with {proc.returncode}")
        try:
            message = response_queue.get(timeout=min(1, max(0.1, deadline - time.monotonic())))
        except queue.Empty:
            continue
        if message.get("id") == request_id:
            return message
        if "unparseable" in message:
            raise RuntimeError("Non-JSON stdout from MCP: " + message["unparseable"])
    raise TimeoutError(f"MCP request {request_id} timed out")


def smoke(binary):
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / ("frogconvert.exe" if os.name == "nt" else "frogconvert")
        shutil.copy2(binary, path)
        path.chmod(0o755)
        with tempfile.TemporaryFile() as log:
            proc = subprocess.Popen(
                [str(path), "mcp"], cwd=temp, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=log,
                env={**os.environ, "FROGCONVERT_SANDBOX_ROOT": temp, "FROGCONVERT_DISABLE_BROWSER_BRIDGE": "1", "FROGCONVERT_DENY_OVERWRITE": "1", "FROGCONVERT_ESSENTIALS": "1"},
            )
            responses = queue.Queue()
            start_reader(proc.stdout, responses)
            failed = None
            try:
                init = request(proc, {
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-03-26",
                        "capabilities": {},
                        "clientInfo": {"name": "frogconvert-smoke", "version": "1.0"}
                    }
                }, responses, 1)
                assert "result" in init, init
                proc.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
                proc.stdin.flush()

                listed = request(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, responses, 2)
                names = {tool["name"] for tool in listed["result"]["tools"]}
                assert names == EXPECTED, f"Wrong MCP tools: {names}"

                pdf = base64.b64encode(minimal_pdf()).decode()
                output = str(Path(temp) / "merged.pdf")
                merged = request(proc, {
                    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": {
                        "name": "pdf_merge",
                        "arguments": {
                            "inputs": [
                                {"base64Bytes": pdf, "fileName": "first.pdf"},
                                {"base64Bytes": pdf, "fileName": "second.pdf"}
                            ],
                            "outputFilePath": output
                        }
                    }
                }, responses, 3, timeout=150)
                assert not merged["result"].get("isError"), merged
                assert Path(output).exists() and Path(output).read_bytes().startswith(b"%PDF"), merged
                previous_bytes = Path(output).read_bytes()
                attempted_overwrite = request(proc, {
                    "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                    "params": {
                        "name": "pdf_merge",
                        "arguments": {
                            "inputs": [
                                {"base64Bytes": pdf, "fileName": "first.pdf"},
                                {"base64Bytes": pdf, "fileName": "second.pdf"}
                            ],
                            "outputFilePath": output
                        }
                    }
                }, responses, 4, timeout=90)
                assert attempted_overwrite["result"].get("isError"), attempted_overwrite
                assert Path(output).read_bytes() == previous_bytes, "Existing output overwritten"

                formats = request(proc, {
                    "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                    "params": {"name": "list_formats", "arguments": {}}
                }, responses, 5, timeout=240)
                assert not formats["result"].get("isError"), formats
                catalog = json.loads(formats["result"]["content"][0]["text"])
                assert any(f["extension"] == "csv" for f in catalog), "Missing CSV handler"

                converted = str(Path(temp) / "rows.json")
                csv_data = base64.b64encode(b"name,age\nAda,42\n").decode()
                result = request(proc, {
                    "jsonrpc": "2.0", "id": 6, "method": "tools/call",
                    "params": {
                        "name": "convert_file",
                        "arguments": {
                            "base64Bytes": csv_data,
                            "fileName": "rows.csv",
                            "inputMime": "text/csv",
                            "inputExtension": "csv",
                            "outputMime": "application/json",
                            "outputExtension": "json",
                            "outputFilePath": converted
                        }
                    }
                }, responses, 6, timeout=120)
                assert not result["result"].get("isError"), result
                assert "Ada" in Path(converted).read_text(), "CSV to JSON conversion did not run"
                print("Native MCP: 8 tools, PDF merge, no-overwrite, format listing and CSV to JSON passed")
            except Exception as exc:
                failed = exc
            finally:
                proc.terminate()
                try:
                    proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.communicate()
                if failed:
                    log.seek(0)
                    print(log.read().decode(errors="replace")[-7000:])
                    raise failed


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    smoke(parser.parse_args().binary.resolve())
