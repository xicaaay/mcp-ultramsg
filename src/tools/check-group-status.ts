import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ChatMessage, UltraMsgClient } from '../ultramsg.client.js';
import {
  dateSchema,
  dayWindow,
  fail,
  formatLocal,
  groupIdSchema,
  ok,
  phoneOf,
  timeSchema,
  timezoneSchema,
  todayIn,
  toContactId,
} from '../util.js';
import { normalize } from './groups.js';

// Primero se piden pocos mensajes; si no alcanzan para cubrir el día, se amplía al máximo.
const FIRST_FETCH = 300;
const MAX_FETCH = 1000;
// Tipos que no son mensajes escritos por una persona.
const SYSTEM_TYPES = new Set(['e2e_notification', 'notification', 'notification_template', 'gp2', 'call_log', 'revoked']);

export function registerCheckGroupStatus(server: McpServer, client: UltraMsgClient): void {
  server.registerTool(
    'check-group-status',
    {
      title: 'Revisar quién envió su status en un grupo',
      description:
        'Revisa los mensajes de un grupo de WhatsApp en un día (y rango de horas) y separa a los participantes en ' +
        '"reported" (enviaron al menos un mensaje que cuenta como status) y "pending" (no lo enviaron). ' +
        'Por defecto cualquier mensaje cuenta; con `keyword` solo cuentan los mensajes cuyo texto contenga esa palabra. ' +
        'No envía nada: para recordar a los pendientes usa send-message con su `chatId`.',
      inputSchema: {
        groupId: groupIdSchema,
        date: dateSchema.optional(),
        timezone: timezoneSchema,
        startTime: timeSchema.default('00:00').describe('Hora local desde la que cuenta (HH:MM, por defecto 00:00)'),
        endTime: timeSchema.default('23:59').describe('Hora local hasta la que cuenta, inclusive (HH:MM, por defecto 23:59)'),
        keyword: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('Si se indica, solo cuentan mensajes cuyo texto la contenga (sin distinguir mayúsculas ni acentos), p. ej. "#status"'),
        countMedia: z
          .boolean()
          .default(true)
          .describe('Sin keyword: si audios/imágenes/stickers cuentan como status (por defecto true)'),
        exclude: z
          .array(z.string())
          .default([])
          .describe('Números a ignorar (p. ej. el admin): +502…, 502… o …@c.us. Tu propio número se excluye siempre.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(await checkGroupStatus(client, args));
      } catch (err) {
        return fail(`No se pudo revisar el grupo ${args.groupId}`, err);
      }
    },
  );
}

interface CheckArgs {
  groupId: string;
  date?: string;
  timezone: string;
  startTime: string;
  endTime: string;
  keyword?: string;
  countMedia: boolean;
  exclude: string[];
}

export async function checkGroupStatus(client: UltraMsgClient, a: CheckArgs) {
  const date = a.date ?? todayIn(a.timezone);
  const window = dayWindow(date, a.startTime, a.endTime, a.timezone);
  if (window.to <= window.from) throw new Error('endTime debe ser posterior a startTime');

  const [group, fetched] = await Promise.all([
    client.getGroup(a.groupId),
    fetchCovering(client, a.groupId, window.from),
  ]);

  const keyword = a.keyword ? normalize(a.keyword) : undefined;
  const counts = (m: ChatMessage) => {
    if (SYSTEM_TYPES.has(m.type)) return false;
    if (keyword) return normalize(m.body ?? '').includes(keyword);
    return a.countMedia || m.type === 'chat';
  };

  // Primer mensaje válido de cada autor dentro de la ventana.
  const firstByAuthor = new Map<string, ChatMessage>();
  for (const m of fetched.messages) {
    if (m.timestamp < window.from || m.timestamp >= window.to || !counts(m)) continue;
    const author = m.author ?? m.from;
    if (!firstByAuthor.has(author)) firstByAuthor.set(author, m);
  }

  // Tu propio número: autor de los mensajes fromMe o destinatario de los recibidos.
  const self = new Set<string>();
  for (const m of fetched.messages) {
    if (m.fromMe && m.author) self.add(m.author);
    else if (!m.fromMe && m.to?.endsWith('@c.us')) self.add(m.to);
  }
  const excluded = new Set([...self, ...a.exclude.map(toContactId)]);

  const participants = (group.groupMetadata?.participants ?? []).filter((p) => !excluded.has(p.id));
  const participantIds = new Set(participants.map((p) => p.id));

  const reported = [];
  const pending = [];
  for (const p of participants) {
    const m = firstByAuthor.get(p.id);
    if (m) {
      reported.push({
        phone: phoneOf(p.id),
        chatId: p.id,
        at: formatLocal(m.timestamp, a.timezone),
        type: m.type,
        preview: m.body ? m.body.slice(0, 120) : undefined,
      });
    } else {
      pending.push({ phone: phoneOf(p.id), chatId: p.id });
    }
  }

  // Autores que no se pudieron asociar a un participante (p. ej. ids @lid o gente que salió del grupo).
  const unmatchedAuthors = [...firstByAuthor.keys()]
    .filter((id) => !participantIds.has(id) && !excluded.has(id))
    .map((id) => phoneOf(id));

  const warnings: string[] = [];
  if (!fetched.coversWindow) {
    warnings.push(
      `Solo se pudieron leer los últimos ${fetched.messages.length} mensajes y no alcanzan el inicio de la ventana; ` +
        'puede haber status anteriores no contados.',
    );
  }
  if (unmatchedAuthors.length > 0) {
    warnings.push('Hay autores que no coinciden con ningún participante actual (ver unmatchedAuthors); revisa a mano si corresponden a algún pendiente.');
  }

  return {
    group: { id: group.id, name: group.name },
    window: {
      date,
      from: `${date} ${a.startTime}`,
      to: `${date} ${a.endTime}`,
      timezone: a.timezone,
    },
    criteria: keyword ? `mensajes que contienen "${a.keyword}"` : a.countMedia ? 'cualquier mensaje' : 'mensajes de texto',
    summary: { participants: participants.length, reported: reported.length, pending: pending.length },
    pending,
    reported,
    excluded: [...excluded].map((id) => phoneOf(id)),
    unmatchedAuthors,
    warnings,
  };
}

async function fetchCovering(client: UltraMsgClient, chatId: string, from: number) {
  let messages = await client.getChatMessages(chatId, FIRST_FETCH);
  const covers = (msgs: ChatMessage[], limit: number) => msgs.length < limit || msgs[0].timestamp < from;
  if (covers(messages, FIRST_FETCH)) return { messages, coversWindow: true };

  messages = await client.getChatMessages(chatId, MAX_FETCH);
  return { messages, coversWindow: covers(messages, MAX_FETCH) };
}
