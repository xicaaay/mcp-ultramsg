// Prueba end-to-end: levanta un UltraMsg falso en localhost y habla con el
// servidor MCP real por stdio, igual que lo haría Claude.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const requests = [];
let mock;
let client;

before(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(raw));
      requests.push({ url: req.url, params });
      res.setHeader('Content-Type', 'application/json');
      if (params.token !== 'test-token') {
        res.end(JSON.stringify({ error: 'Wrong token. Please provide token as a GET parameter.' }));
      } else if (params.to === '+5210000000000') {
        res.end(JSON.stringify({ error: [{ to: 'invalid number' }] }));
      } else {
        res.end(JSON.stringify({ sent: 'true', message: 'ok', id: 42 }));
      }
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));

  client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      env: {
        PATH: process.env.PATH,
        ULTRAMSG_INSTANCE_ID: 'instance123',
        ULTRAMSG_TOKEN: 'test-token',
        ULTRAMSG_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
      },
    }),
  );
});

after(async () => {
  await client?.close();
  mock?.close();
});

test('expone la tool send-message', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'send-message');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required?.sort(), ['body', 'to']);
});

test('envía el mensaje a UltraMsg con los parámetros correctos', async () => {
  const res = await client.callTool({
    name: 'send-message',
    arguments: { to: '+52 (155) 1234-5678', body: 'Hola desde MCP' },
  });
  assert.ok(!res.isError, res.content[0].text);
  assert.match(res.content[0].text, /id: 42/);

  const last = requests.at(-1);
  assert.equal(last.url, '/instance123/messages/chat');
  assert.deepEqual(last.params, { token: 'test-token', to: '+5215512345678', body: 'Hola desde MCP' });
});

test('devuelve isError cuando UltraMsg rechaza el envío', async () => {
  const res = await client.callTool({
    name: 'send-message',
    arguments: { to: '+5210000000000', body: 'x' },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /invalid number/);
});

test('rechaza destinatarios inválidos sin llamar a UltraMsg', async () => {
  const before = requests.length;
  const res = await client.callTool({ name: 'send-message', arguments: { to: 'hola', body: 'x' } });
  assert.equal(res.isError, true);
  assert.equal(requests.length, before);
});
