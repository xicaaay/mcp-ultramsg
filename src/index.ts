#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { registerSendMessage } from './tools/send-message.js';
import { UltraMsgClient } from './ultramsg.client.js';

// En transporte stdio, stdout es el canal del protocolo: todo log va a stderr.
async function main(): Promise<void> {
  const client = new UltraMsgClient(loadConfig());

  const server = new McpServer({ name: 'mcp-ultramsg', version: '1.0.0' });
  registerSendMessage(server, client);

  await server.connect(new StdioServerTransport());
  console.error('mcp-ultramsg listo (stdio)');
}

main().catch((err) => {
  console.error('Error al iniciar mcp-ultramsg:', err instanceof Error ? err.message : err);
  process.exit(1);
});
