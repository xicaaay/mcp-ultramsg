#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';
import { UltraMsgClient } from './ultramsg.client.js';

// Claude lanza el servidor desde cualquier directorio, así que el .env se
// busca en la raíz del proyecto y no en el cwd.
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// En transporte stdio, stdout es el canal del protocolo: todo log va a stderr.
async function main(): Promise<void> {
  const server = createMcpServer(new UltraMsgClient(loadConfig(process.env)));
  await server.connect(new StdioServerTransport());
  console.error('mcp-ultramsg listo (stdio)');
}

main().catch((err) => {
  console.error('Error al iniciar mcp-ultramsg:', err instanceof Error ? err.message : err);
  process.exit(1);
});
