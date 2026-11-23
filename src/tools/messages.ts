import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ChatMessage, UltraMsgClient } from '../ultramsg.client.js';
import { dateSchema, dayWindow, fail, formatLocal, ok, phoneOf, RECIPIENT, timezoneSchema } from '../util.js';

const MAX_BODY = 1000;

export function registerMessageTools(server: McpServer, client: UltraMsgClient): void {
  server.registerTool(
    'get-chat-messages',
    {
      title: 'Leer mensajes de un chat o grupo',
      description:
        'Devuelve los mensajes más recientes de un chat o grupo de WhatsApp (orden cronológico), con autor, hora local, tipo y texto. ' +
        'Opcionalmente filtra por un día. Los audios, stickers e imágenes aparecen con su tipo y sin texto (o con su caption).',
      inputSchema: {
        chatId: z
          .string()
          .trim()
          .refine((v) => RECIPIENT.test(v) && v.includes('@'), { message: 'chatId inválido: usa …@g.us o …@c.us' })
          .describe('Chat id: …@g.us para grupos (de list-groups) o …@c.us para personas'),
        limit: z.number().int().min(1).max(1000).default(50).describe('Cuántos mensajes recientes leer (1-1000, por defecto 50)'),
        date: dateSchema.optional().describe('Si se indica (YYYY-MM-DD), solo devuelve mensajes de ese día local'),
        timezone: timezoneSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chatId, limit, date, timezone }) => {
      try {
        let msgs = await client.getChatMessages(chatId, limit);
        let window: { from: number; to: number } | undefined;
        if (date) {
          window = dayWindow(date, '00:00', '23:59', timezone);
          msgs = msgs.filter((m) => m.timestamp >= window!.from && m.timestamp < window!.to);
        }
        return ok({
          chatId,
          timezone,
          date,
          count: msgs.length,
          messages: msgs.map((m) => compactMessage(m, timezone)),
        });
      } catch (err) {
        return fail(`No se pudieron leer los mensajes de ${chatId}`, err);
      }
    },
  );
}

export function compactMessage(m: ChatMessage, tz: string) {
  const body = m.body ?? '';
  return {
    id: m.id,
    time: formatLocal(m.timestamp, tz),
    author: phoneOf(m.author ?? m.from),
    fromMe: m.fromMe,
    type: m.type,
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}…` : body || undefined,
    quoted: m.quotedMsg?.body ? m.quotedMsg.body.slice(0, 200) : undefined,
  };
}
