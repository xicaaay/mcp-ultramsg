import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCheckGroupStatus } from './tools/check-group-status.js';
import { registerGroupTools } from './tools/groups.js';
import { registerMessageTools } from './tools/messages.js';
import { registerSendMessage } from './tools/send-message.js';
import type { UltraMsgClient } from './ultramsg.client.js';

const INSTRUCTIONS = `Herramientas de WhatsApp (UltraMsg).
Flujo típico para recordatorios de status diario en un grupo:
1. list-groups (con query = nombre del grupo) para obtener el groupId.
2. check-group-status con ese groupId (opcional: date, startTime/endTime, keyword, exclude) para ver quién está en "pending".
3. send-message a cada chatId de "pending" con un recordatorio breve y amable.
Antes de enviar recordatorios masivos, confirma con el usuario salvo que la tarea ya lo indique explícitamente.`;

/** Crea el servidor MCP con todas las tools. Lo comparten el modo stdio y el Worker. */
export function createMcpServer(client: UltraMsgClient): McpServer {
  const server = new McpServer({ name: 'mcp-ultramsg', version: '1.2.0' }, { instructions: INSTRUCTIONS });
  registerSendMessage(server, client);
  registerGroupTools(server, client);
  registerMessageTools(server, client);
  registerCheckGroupStatus(server, client);
  return server;
}
