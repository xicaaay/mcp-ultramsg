// Prueba del entrypoint de Cloudflare Workers: se invoca `fetch` del Worker
// directamente en Node con un cliente MCP real sobre Streamable HTTP y un
// UltraMsg falso en localhost (no envía mensajes reales).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import worker from '../dist/worker.js';

const AUTH = 'a'.repeat(40);
const requests = [];
let mock;
let env;

// fetch que enruta https://worker.test/* al Worker y lo demás a la red real (el mock).
const workerFetch = (input, init) => {
  const req = new Request(input, init);
  return new URL(req.url).host === 'worker.test' ? worker.fetch(req, env) : fetch(req);
};

async function connect(path, headers = {}) {
  const client = new Client({ name: 'worker-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`https://worker.test${path}`), {
      fetch: workerFetch,
      requestInit: { headers },
    }),
  );
  return client;
}

before(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(raw));
      requests.push({ url: req.url, params });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ sent: 'true', message: 'ok', id: 7 }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  env = {
    ULTRAMSG_INSTANCE_ID: 'instance123',
    ULTRAMSG_TOKEN: 'test-token',
    ULTRAMSG_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
    MCP_AUTH_TOKEN: AUTH,
  };
});

after(() => mock?.close());

test('health check responde sin auth', async () => {
  const res = await worker.fetch(new Request('https://worker.test/'), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('rechaza /mcp sin token o con token incorrecto', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

  for (const [path, extra] of [
    ['/mcp', {}],
    ['/mcp', { Authorization: 'Bearer wrong' }],
    ['/mcp/wrong', {}],
  ]) {
    const res = await worker.fetch(
      new Request(`https://worker.test${path}`, { method: 'POST', headers: { ...headers, ...extra }, body }),
      env,
    );
    assert.equal(res.status, 401, `${path} ${JSON.stringify(extra)}`);
  }
  assert.equal(requests.length, 0);
});

test('se niega a funcionar si MCP_AUTH_TOKEN falta o es corto', async () => {
  const res = await worker.fetch(
    new Request('https://worker.test/mcp', { method: 'POST' }),
    { ...env, MCP_AUTH_TOKEN: 'corto' },
  );
  assert.equal(res.status, 500);
});

test('ruta desconocida devuelve 404', async () => {
  const res = await worker.fetch(new Request('https://worker.test/otra'), env);
  assert.equal(res.status, 404);
});

test('cliente MCP con Bearer: lista tools y envía mensaje', async () => {
  const client = await connect('/mcp', { Authorization: `Bearer ${AUTH}` });
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'send-message'));

  const res = await client.callTool({ name: 'send-message', arguments: { to: '+502 3000 0000', body: 'Hola' } });
  assert.ok(!res.isError, res.content[0].text);
  assert.match(res.content[0].text, /id: 7/);
  assert.deepEqual(requests.at(-1), {
    url: '/instance123/messages/chat',
    params: { token: 'test-token', to: '+50230000000', body: 'Hola' },
  });
  await client.close();
});

test('cliente MCP con token en la ruta (/mcp/<token>)', async () => {
  const client = await connect(`/mcp/${AUTH}`);
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'send-message'));
  await client.close();
});
