# mcp-ultramsg

Servidor [MCP](https://modelcontextprotocol.io) que conecta Claude con [UltraMsg](https://ultramsg.com) para enviar mensajes de WhatsApp.

## Herramientas

| Tool | Tipo | Descripción |
|---|---|---|
| `send-message` | escritura | Envía un mensaje de texto. `to`: número con código de país (`+50212345678`) o chat id (`...@c.us` / `...@g.us`); `body`: texto |
| `list-groups` | lectura | Lista los grupos (id `...@g.us`, nombre, nº de participantes, última actividad). `query` opcional filtra por nombre |
| `get-group` | lectura | Participantes de un grupo (teléfono, admin), dueño y descripción. `groupId` |
| `get-chat-messages` | lectura | Últimos mensajes de un chat o grupo con autor, hora local, tipo y texto. `chatId`, `limit` (1-1000), `date` opcional |
| `check-group-status` | lectura | Separa a los participantes de un grupo en `reported` / `pending` según si enviaron mensaje en un día y rango de horas |

### `check-group-status`

| Parámetro | Por defecto | Descripción |
|---|---|---|
| `groupId` | — | Id del grupo (de `list-groups`) |
| `date` | hoy | `YYYY-MM-DD` |
| `timezone` | `America/Guatemala` | Zona horaria IANA |
| `startTime` / `endTime` | `00:00` / `23:59` | Rango de horas local que cuenta |
| `keyword` | — | Si se indica, solo cuentan mensajes que la contengan (p. ej. `#status`) |
| `countMedia` | `true` | Sin keyword: si audios, imágenes o stickers cuentan como status |
| `exclude` | `[]` | Números a ignorar (p. ej. admins). Tu propio número se excluye siempre |

Devuelve `pending` (con el `chatId` listo para `send-message`), `reported` (hora y vista previa del primer mensaje),
`unmatchedAuthors` (autores que no coinciden con participantes, p. ej. ids `@lid`) y `warnings` (p. ej. si los últimos
1000 mensajes no alcanzan a cubrir la ventana).

### Ejemplo de tarea programada para Claude

> Todos los días de lunes a viernes a las 10:00: revisa el grupo "Desarrollo Reducido" con `check-group-status`
> (ventana 00:00–10:00, keyword `#status`, excluye +502XXXXXXXX). A cada persona en `pending` envíale por privado:
> "Hola 👋, recuerda enviar tu status del día en el grupo Desarrollo Reducido." Al final dame un resumen.

## Requisitos

- Node.js 20 o superior
- Una instancia de UltraMsg **conectada** (QR escaneado) con su `instance_id` y `token`

## Instalación

```bash
npm install
npm run build
cp .env.example .env   # y completa ULTRAMSG_INSTANCE_ID y ULTRAMSG_TOKEN
```

## Uso con Claude Code

```bash
claude mcp add ultramsg -- node /ruta/absoluta/mcp-ultramsg/dist/index.js
```

También puedes pasar las credenciales en la configuración en lugar de usar `.env`:

```bash
claude mcp add ultramsg \
  -e ULTRAMSG_INSTANCE_ID=instance00000 \
  -e ULTRAMSG_TOKEN=tu_token \
  -- node /ruta/absoluta/mcp-ultramsg/dist/index.js
```

Luego, dentro de Claude: *"Envía un WhatsApp a +5215512345678 diciendo que la reunión es a las 5"*.

## Uso con Claude Desktop

En `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ultramsg": {
      "command": "node",
      "args": ["/ruta/absoluta/mcp-ultramsg/dist/index.js"],
      "env": {
        "ULTRAMSG_INSTANCE_ID": "instance00000",
        "ULTRAMSG_TOKEN": "tu_token"
      }
    }
  }
}
```

## Despliegue en Cloudflare Workers (MCP remoto)

El mismo servidor se expone por HTTP (Streamable HTTP, sin estado) desde `src/worker.ts`.

```bash
npx wrangler login
npx wrangler secret put ULTRAMSG_INSTANCE_ID
npx wrangler secret put ULTRAMSG_TOKEN
openssl rand -hex 32 | npx wrangler secret put MCP_AUTH_TOKEN   # opcional, recomendado
npm run deploy
```

Rutas del Worker (`https://mcp-ultramsg.<tu-subdominio>.workers.dev`):

| Ruta | Auth | Uso |
|---|---|---|
| `GET /` | No | Health check |
| `POST /mcp` | `Authorization: Bearer <MCP_AUTH_TOKEN>` | Claude Code y clientes que permiten headers |
| `POST /mcp/<MCP_AUTH_TOKEN>` | Token en la ruta | Conector personalizado de claude.ai / Claude Desktop |

La autenticación es **opcional**: si `MCP_AUTH_TOKEN` no está configurado, `/mcp` queda **abierto** y
cualquiera con la URL puede enviar mensajes desde tu número. Configúralo (≥ 32 caracteres) para exigir el token;
si es más corto, el Worker responde 500. `GET /` indica en `auth` si está activa.

**Claude Code:**

```bash
claude mcp add --transport http ultramsg https://mcp-ultramsg.<tu-subdominio>.workers.dev/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

**claude.ai / Claude Desktop:** Settings → Connectors → *Add custom connector* → URL
`https://mcp-ultramsg.<tu-subdominio>.workers.dev/mcp/<MCP_AUTH_TOKEN>`.
Trata esa URL como una contraseña: quien la tenga puede enviar mensajes desde tu número.
Para revocarla, cambia el secret (`wrangler secret put MCP_AUTH_TOKEN`).

Desarrollo local del Worker: `cp .dev.vars.example .dev.vars` y `npm run dev:worker`.

## Pruebas

```bash
npm test          # e2e stdio + Worker: cliente MCP real + UltraMsg simulado (no envía mensajes reales)
npm run inspect   # abre MCP Inspector para invocar la tool manualmente
```

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `ULTRAMSG_INSTANCE_ID` | Sí | ID de la instancia (p. ej. `instance12345`) |
| `ULTRAMSG_TOKEN` | Sí | Token de la instancia |
| `ULTRAMSG_BASE_URL` | No | URL base de la API (por defecto `https://api.ultramsg.com`) |

## Estructura

```
src/
├── index.ts             # arranque del servidor MCP (stdio, local)
├── worker.ts            # entrypoint Cloudflare Workers (HTTP, remoto)
├── server.ts            # crea el McpServer con sus tools (compartido)
├── config.ts            # validación de variables de entorno
├── util.ts              # validaciones, zonas horarias y helpers compartidos
├── ultramsg.client.ts   # cliente HTTP de UltraMsg
└── tools/
    ├── send-message.ts        # send-message
    ├── groups.ts              # list-groups, get-group
    ├── messages.ts            # get-chat-messages
    └── check-group-status.ts  # check-group-status
test/
├── e2e.test.mjs       # stdio
├── tools.test.mjs     # tools de lectura
└── worker.test.mjs    # Worker y autenticación
```

> UltraMsg es una API **no oficial** de WhatsApp. Un volumen alto de mensajes o mensajes no solicitados pueden provocar el bloqueo del número.
