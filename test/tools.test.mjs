// Pruebas de las tools de lectura (grupos, mensajes, check-group-status) a
// través del Worker en Node, con un UltraMsg falso (no toca la API real).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import worker from '../dist/worker.js';

const GROUP = '120363000000000001@g.us';
const ME = '50230000001@c.us';
const ANA = '50230000002@c.us';
const BETO = '50230000003@c.us';
const CARLA = '50230000004@c.us';
const ADMIN = '50230000005@c.us';

// 2026-11-23 en America/Guatemala (UTC-6) empieza a las 06:00 UTC.
const at = (h, m = 0) => Date.UTC(2026, 10, 23, h + 6, m) / 1000;

const group = {
  id: GROUP,
  name: 'Equipo Desarrollo',
  isGroup: true,
  last_time: at(10),
  groupMetadata: {
    description: 'Status diario',
    owner: ADMIN,
    participants: [ME, ANA, BETO, CARLA, ADMIN].map((id) => ({ id, isAdmin: id === ADMIN, isSuperAdmin: false })),
  },
};
const other = { id: '120363000000000002@g.us', name: 'Fútbol', groupMetadata: { participants: [] } };

const msg = (author, ts, body, type = 'chat') => ({
  id: `${author}_${ts}`,
  from: author === ME ? ME : GROUP,
  to: author === ME ? GROUP : ME,
  author,
  body,
  fromMe: author === ME,
  type,
  timestamp: ts,
});

const messages = [
  msg(BETO, at(-2), '#status de ayer'), // día anterior: no cuenta
  msg(ANA, at(8, 15), '#Status: terminé el login'),
  msg(ME, at(8, 30), 'Buenos días equipo'),
  msg(CARLA, at(9), '', 'ptt'), // audio
  msg(BETO, at(11), 'ya voy con el status'), // sin #
  msg('99999@lid', at(12), '#status desde lid'),
];

const calls = [];
let mock;
let env;

const workerFetch = (input, init) => {
  const req = new Request(input, init);
  return new URL(req.url).host === 'worker.test' ? worker.fetch(req, env) : fetch(req);
};

async function connect() {
  const client = new Client({ name: 'tools-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('https://worker.test/mcp'), { fetch: workerFetch }));
  return client;
}

async function call(name, args) {
  const client = await connect();
  try {
    const res = await client.callTool({ name, arguments: args });
    return { ...res, data: res.isError ? undefined : JSON.parse(res.content[0].text) };
  } finally {
    await client.close();
  }
}

before(async () => {
  mock = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const q = Object.fromEntries(url.searchParams);
    calls.push({ method: req.method, path: url.pathname, q });
    res.setHeader('Content-Type', 'application/json');
    const send = (b) => res.end(JSON.stringify(b));
    if (q.token !== 'test-token') return send({ error: 'Wrong token' });
    switch (url.pathname) {
      case '/instance123/groups':
        return send([group, other]);
      case '/instance123/groups/group':
        return q.groupId === GROUP ? send(group) : send({ error: 'group not found' });
      case '/instance123/chats/messages':
        return send(messages.slice(-Number(q.limit)).reverse()); // desordenado a propósito
      default:
        res.statusCode = 404;
        return send({ error: 'not found' });
    }
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  env = {
    ULTRAMSG_INSTANCE_ID: 'instance123',
    ULTRAMSG_TOKEN: 'test-token',
    ULTRAMSG_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
  };
});

after(() => mock?.close());

test('expone todas las tools, las de lectura marcadas como readOnly', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  await client.close();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const name of ['send-message', 'list-groups', 'get-group', 'get-chat-messages', 'check-group-status']) {
    assert.ok(byName[name], `falta ${name}`);
  }
  for (const name of ['list-groups', 'get-group', 'get-chat-messages', 'check-group-status']) {
    assert.equal(byName[name].annotations?.readOnlyHint, true, name);
  }
});

test('list-groups filtra por nombre sin acentos', async () => {
  const { data } = await call('list-groups', { query: 'futbol' });
  assert.equal(data.count, 1);
  assert.equal(data.groups[0].name, 'Fútbol');

  const all = await call('list-groups', {});
  assert.equal(all.data.count, 2);
  assert.equal(all.data.groups[0].participants, 5);
});

test('get-group devuelve participantes con teléfono y admin', async () => {
  const { data } = await call('get-group', { groupId: GROUP });
  assert.equal(data.participantCount, 5);
  assert.deepEqual(data.participants.find((p) => p.id === ADMIN), { id: ADMIN, phone: '+50230000005', isAdmin: true });
  assert.equal(data.owner, '+50230000005');

  const bad = await call('get-group', { groupId: '120363999999999999@g.us' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /group not found/);
});

test('get-chat-messages ordena, filtra por día y usa hora local', async () => {
  const { data } = await call('get-chat-messages', { chatId: GROUP, limit: 10, date: '2026-11-23' });
  assert.equal(data.count, 5); // excluye el de ayer
  assert.equal(data.messages[0].time, '2026-11-23 08:15');
  assert.equal(data.messages[0].author, '+50230000002');
  assert.ok(data.messages.every((m, i, a) => i === 0 || a[i - 1].time <= m.time));
  assert.deepEqual(calls.at(-1).q, { token: 'test-token', chatId: GROUP, limit: '10' });
});

test('check-group-status: cualquier mensaje cuenta, se excluye a mí y a los excluidos', async () => {
  const { data } = await call('check-group-status', { groupId: GROUP, date: '2026-11-23', exclude: ['+502 3000 0005'] });
  assert.deepEqual(data.summary, { participants: 3, reported: 3, pending: 0 });
  assert.deepEqual(data.reported.map((r) => r.phone).sort(), ['+50230000002', '+50230000003', '+50230000004']);
  assert.ok(data.excluded.includes('+50230000001'), 'mi número se excluye solo');
  assert.ok(data.excluded.includes('+50230000005'));
  assert.deepEqual(data.unmatchedAuthors, ['99999@lid']);
  assert.equal(data.warnings.length, 1);
});

test('check-group-status: con keyword solo cuentan los que la incluyen', async () => {
  const { data } = await call('check-group-status', { groupId: GROUP, date: '2026-11-23', keyword: '#status', exclude: [ADMIN] });
  assert.deepEqual(data.reported.map((r) => r.phone), ['+50230000002']);
  assert.deepEqual(data.pending, [
    { phone: '+50230000003', chatId: BETO },
    { phone: '+50230000004', chatId: CARLA },
  ]);
  assert.equal(data.reported[0].at, '2026-11-23 08:15');
});

test('check-group-status: rango de horas y countMedia=false', async () => {
  const { data } = await call('check-group-status', {
    groupId: GROUP,
    date: '2026-11-23',
    startTime: '08:00',
    endTime: '10:00',
    countMedia: false,
    exclude: [ADMIN],
  });
  // Ana (08:15, texto) cuenta; Carla mandó audio; Beto escribió a las 11:00.
  assert.deepEqual(data.reported.map((r) => r.phone), ['+50230000002']);
  assert.deepEqual(data.pending.map((p) => p.phone), ['+50230000003', '+50230000004']);
});

test('check-group-status valida el groupId y la zona horaria', async () => {
  const a = await call('check-group-status', { groupId: 'equipo' });
  assert.equal(a.isError, true);
  const b = await call('check-group-status', { groupId: GROUP, timezone: 'Marte/Olympus' });
  assert.equal(b.isError, true);
});
