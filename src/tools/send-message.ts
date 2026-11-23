import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { UltraMsgClient } from '../ultramsg.client.js';
import { fail, recipientSchema } from '../util.js';

export function registerSendMessage(server: McpServer, client: UltraMsgClient): void {
  server.registerTool(
    'send-message',
    {
      title: 'Enviar mensaje de WhatsApp',
      description:
        'Envía un mensaje de texto por WhatsApp usando UltraMsg. ' +
        'El destinatario debe ir en formato internacional con código de país (p. ej. +5215512345678) ' +
        'o como chat id de WhatsApp (p. ej. 5215512345678@c.us para personas, ...@g.us para grupos).',
      inputSchema: {
        to: recipientSchema.describe('Número con código de país o chat id de WhatsApp'),
        body: z.string().trim().min(1, 'El mensaje no puede estar vacío').max(4096).describe('Texto del mensaje'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, body }) => {
      try {
        const result = await client.sendChat(to, body);
        return {
          content: [{ type: 'text', text: `Mensaje enviado a ${to} (id: ${result.id}).` }],
        };
      } catch (err) {
        return fail(`No se pudo enviar el mensaje a ${to}`, err);
      }
    },
  );
}
