import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Group, UltraMsgClient } from '../ultramsg.client.js';
import { DEFAULT_TZ, fail, formatLocal, groupIdSchema, ok, phoneOf } from '../util.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerGroupTools(server: McpServer, client: UltraMsgClient): void {
  server.registerTool(
    'list-groups',
    {
      title: 'Listar grupos de WhatsApp',
      description:
        'Lista los grupos de WhatsApp de la instancia con su id (…@g.us), nombre, número de participantes y última actividad. ' +
        'Úsalo para obtener el groupId a partir del nombre del grupo.',
      inputSchema: {
        query: z.string().trim().optional().describe('Filtra por nombre (contiene, sin distinguir mayúsculas ni acentos)'),
      },
      annotations: READ_ONLY,
    },
    async ({ query }) => {
      try {
        const q = query ? normalize(query) : undefined;
        const groups = (await client.getGroups())
          .filter((g) => !q || normalize(g.name ?? '').includes(q))
          .map((g) => ({
            id: g.id,
            name: g.name,
            participants: g.groupMetadata?.participants?.length ?? 0,
            lastActivity: g.last_time ? formatLocal(g.last_time, DEFAULT_TZ) : undefined,
          }));
        return ok({ count: groups.length, timezone: DEFAULT_TZ, groups });
      } catch (err) {
        return fail('No se pudieron obtener los grupos', err);
      }
    },
  );

  server.registerTool(
    'get-group',
    {
      title: 'Ver grupo y participantes',
      description:
        'Devuelve el nombre, descripción, dueño y la lista de participantes (número y si es admin) de un grupo de WhatsApp.',
      inputSchema: { groupId: groupIdSchema },
      annotations: READ_ONLY,
    },
    async ({ groupId }) => {
      try {
        return ok(describeGroup(await client.getGroup(groupId)));
      } catch (err) {
        return fail(`No se pudo obtener el grupo ${groupId}`, err);
      }
    },
  );
}

export function describeGroup(g: Group) {
  const participants = g.groupMetadata?.participants ?? [];
  return {
    id: g.id,
    name: g.name,
    description: g.groupMetadata?.description || undefined,
    owner: phoneOf(g.groupMetadata?.owner),
    participantCount: participants.length,
    participants: participants.map((p) => ({
      id: p.id,
      phone: phoneOf(p.id),
      isAdmin: Boolean(p.isAdmin || p.isSuperAdmin),
    })),
  };
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
