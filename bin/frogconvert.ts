#!/usr/bin/env bun

const cmd = process.argv[2];

if (cmd === 'mcp') {
    await import('../src/mcp/index.ts');
} else if (cmd === 'api') {
    await import('../src/api/index.ts');
} else {
    const usage = `frogConvert - universal file converter

Usage:
  bunx frogconvert mcp    Start the MCP server (stdio, for use with Claude / AI agents)
  bunx frogconvert api    Start the local REST API server (default port 3000)

Examples:
  # MCP config for Claude Code / Claude Desktop:
  # { "mcpServers": { "frogconvert": { "command": "bunx", "args": ["frogconvert", "mcp"] } } }

  # REST API:
  # PORT=8080 bunx frogconvert api

All file processing is local - no files are sent to any remote server.
Requires Bun: https://bun.sh
`;
    process.stderr.write(usage);
    process.exit(cmd ? 1 : 0);
}
