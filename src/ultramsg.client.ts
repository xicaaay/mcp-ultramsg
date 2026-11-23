import type { UltraMsgConfig } from './config.js';

export interface SendChatResult {
  id: string;
  message: string;
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
    const data = await this.post('messages/chat', { to, body });

    if (data.sent === 'true' || data.sent === true) {
      return { id: String(data.id), message: String(data.message ?? 'ok') };
    }
    throw new UltraMsgError(extractError(data) ?? 'UltraMsg no confirmó el envío', undefined, data);
  }

  private async post(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = `${this.config.baseUrl}/${encodeURIComponent(this.config.instanceId)}/${path}`;
    const form = new URLSearchParams({ token: this.config.token, ...params });

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new UltraMsgError(`No se pudo conectar con UltraMsg: ${reason}`);
    }

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UltraMsgError(`Respuesta no válida de UltraMsg (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
    }

    if (!res.ok) {
      throw new UltraMsgError(extractError(data) ?? `HTTP ${res.status}`, res.status, data);
    }
    return data;
  }
}

/** UltraMsg devuelve los errores como string, como arreglo de objetos o como objeto. */
function extractError(data: Record<string, unknown>): string | undefined {
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
