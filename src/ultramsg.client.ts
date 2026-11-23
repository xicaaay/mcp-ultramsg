import type { UltraMsgConfig } from './config.js';

export interface SendChatResult {
  id: string;
  message: string;
}

export interface GroupParticipant {
  id: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

export interface Group {
  id: string;
  name: string;
  isGroup?: boolean;
  last_time?: number;
  groupMetadata?: {
    description?: string;
    owner?: string;
    creation?: number;
    participants?: GroupParticipant[];
  };
}

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  /** En grupos: quién envió el mensaje (p. ej. 50212345678@c.us). */
  author?: string;
  body?: string;
  fromMe: boolean;
  /** chat, ptt, image, video, document, sticker, ... */
  type: string;
  /** Unix en segundos. */
  timestamp: number;
  isForwarded?: boolean;
  mentionedIds?: string[];
  quotedMsg?: { body?: string };
}

export class UltraMsgError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'UltraMsgError';
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export class UltraMsgClient {
  constructor(private readonly config: UltraMsgConfig) {}

  /** Envía un mensaje de texto. `to` acepta un número internacional o un chat id (`...@c.us` / `...@g.us`). */
  async sendChat(to: string, body: string): Promise<SendChatResult> {
    const data = await this.request('POST', 'messages/chat', { to, body });

    if (isObject(data) && (data.sent === 'true' || data.sent === true)) {
      return { id: String(data.id), message: String(data.message ?? 'ok') };
    }
    throw new UltraMsgError(errorOf(data) ?? 'UltraMsg no confirmó el envío', undefined, data);
  }

  /** Todos los grupos de la instancia, con sus participantes. */
  async getGroups(): Promise<Group[]> {
    return expectArray<Group>(await this.request('GET', 'groups', {}), 'groups');
  }

  /** Información y participantes de un grupo. */
  async getGroup(groupId: string): Promise<Group> {
    const data = await this.request('GET', 'groups/group', { groupId });
    if (!isObject(data) || typeof data.id !== 'string') {
      throw new UltraMsgError(errorOf(data) ?? `Grupo no encontrado: ${groupId}`, undefined, data);
    }
    return data as unknown as Group;
  }

  /** Últimos `limit` mensajes de un chat o grupo (máx. 1000), en orden cronológico ascendente. */
  async getChatMessages(chatId: string, limit: number): Promise<ChatMessage[]> {
    const msgs = expectArray<ChatMessage>(
      await this.request('GET', 'chats/messages', { chatId, limit: String(limit) }),
      'chats/messages',
    );
    return msgs.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async request(method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.config.baseUrl}/${encodeURIComponent(this.config.instanceId)}/${path}`);
    const form = new URLSearchParams({ token: this.config.token, ...params });

    const init: RequestInit = { method, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
    if (method === 'GET') {
      url.search = form.toString();
    } else {
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = form;
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new UltraMsgError(`No se pudo conectar con UltraMsg: ${reason}`);
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UltraMsgError(`Respuesta no válida de UltraMsg (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
    }

    if (!res.ok) {
      throw new UltraMsgError(errorOf(data) ?? `HTTP ${res.status}`, res.status, data);
    }
    return data;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function expectArray<T>(data: unknown, what: string): T[] {
  if (Array.isArray(data)) return data as T[];
  throw new UltraMsgError(errorOf(data) ?? `Respuesta inesperada de UltraMsg en ${what}`, undefined, data);
}

/** UltraMsg devuelve los errores como string, como arreglo de objetos o como objeto. */
function errorOf(data: unknown): string | undefined {
  if (!isObject(data)) return undefined;
  const err = data.error;
  if (!err) return undefined;
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) {
    return err
      .map((e) => (typeof e === 'object' && e !== null ? Object.values(e).join(': ') : String(e)))
      .join('; ');
  }
  return JSON.stringify(err);
}
