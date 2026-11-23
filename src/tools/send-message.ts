import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { UltraMsgError, type UltraMsgClient } from '../ultramsg.client.js';

// Número internacional (+5215512345678) o chat id de WhatsApp (5215512345678@c.us, ...@g.us).
const RECIPIENT = /^(\+?\d{8,15}|\d{8,30}(-\d+)?@(c|g)\.us)$/;

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
        to: z
          .string()
          .transform((v) => v.replace(/[\s()-]/g, ''))
          .refine((v) => RECIPIENT.test(v), {
            message: 'Destinatario inválido: usa formato internacional (+5215512345678) o un chat id (...@c.us / ...@g.us)',
          })
          .describe('Número con código de país o chat id de WhatsApp'),
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
        const message = err instanceof UltraMsgError || err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `No se pudo enviar el mensaje a ${to}: ${message}` }],
        };
      }
    },
  );
}
