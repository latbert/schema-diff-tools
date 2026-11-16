import { isMainEntry, runServer } from '@nopilot/mcp-server-common';
import { registerSchemaTools, SERVER_NAME, SERVER_VERSION } from './tools.js';

const DEFAULT_PORT = 9430;

async function main() {
  await runServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    defaultPort: DEFAULT_PORT,
    jsonLimit: '16mb',  // tools accept inline file contents over HTTP
    register: (server) => registerSchemaTools(server),
  });
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
