import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSendMessage } from './tools/send-message.js';
import type { UltraMsgClient } from './ultramsg.client.js';

/** Crea el servidor MCP con todas las tools. Lo comparten el modo stdio y el Worker. */
export function createMcpServer(client: UltraMsgClient): McpServer {
  const server = new McpServer({ name: 'mcp-ultramsg', version: '1.1.0' });
  registerSendMessage(server, client);
  return server;
}
