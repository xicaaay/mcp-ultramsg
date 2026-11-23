// Entrypoint para Cloudflare Workers: MCP sobre Streamable HTTP (sin estado).
//
// Rutas:
//   GET  /                     → health check
//   POST /mcp                  → endpoint MCP
//   POST /mcp/<MCP_AUTH_TOKEN> → mismo endpoint con el token en la ruta, para
//                                clientes que no permiten headers (conector de claude.ai)
//
// Autenticación opcional:
//   - Sin MCP_AUTH_TOKEN: /mcp queda ABIERTO (cualquiera con la URL puede enviar mensajes).
//   - Con MCP_AUTH_TOKEN (≥ 32 caracteres): se exige `Authorization: Bearer <token>`
//     o el token en la ruta.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { loadConfig, type EnvSource } from './config.js';
import { createMcpServer } from './server.js';
import { UltraMsgClient } from './ultramsg.client.js';

const MIN_AUTH_TOKEN_LENGTH = 32;

export default {
  async fetch(request: Request, env: EnvSource): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'GET') {
      return json(200, { name: 'mcp-ultramsg', status: 'ok', endpoint: '/mcp', auth: Boolean(env.MCP_AUTH_TOKEN) });
    }

    const match = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
    if (!match) return json(404, { error: 'Not found' });

    const expected = typeof env.MCP_AUTH_TOKEN === 'string' ? env.MCP_AUTH_TOKEN.trim() : '';
    if (expected) {
      if (expected.length < MIN_AUTH_TOKEN_LENGTH) {
        return json(500, { error: `MCP_AUTH_TOKEN demasiado corto (mínimo ${MIN_AUTH_TOKEN_LENGTH} caracteres)` });
      }
      const header = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      const provided = match[1] ? decodeURIComponent(match[1]) : header;
      if (!provided || !(await safeEqual(provided, expected))) {
        return json(401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
      }
    }

    let client: UltraMsgClient;
    try {
      client = new UltraMsgClient(loadConfig(env));
    } catch (err) {
      return json(500, { error: err instanceof Error ? err.message : String(err) });
    }

    // Modo sin estado: un servidor y un transporte por petición.
    const server = createMcpServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Comparación en tiempo constante (vía hash) para no filtrar el token por timing. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
