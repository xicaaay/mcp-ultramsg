# mcp-ultramsg

Servidor [MCP](https://modelcontextprotocol.io) que conecta Claude con [UltraMsg](https://ultramsg.com) para enviar mensajes de WhatsApp.

## Herramientas

| Tool | Descripción | Parámetros |
|---|---|---|
| `send-message` | Envía un mensaje de texto por WhatsApp | `to`: número con código de país (`+5215512345678`) o chat id (`...@c.us` / `...@g.us`)<br>`body`: texto del mensaje |

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
openssl rand -hex 32 | npx wrangler secret put MCP_AUTH_TOKEN   # guarda este valor
npm run deploy
```

Rutas del Worker (`https://mcp-ultramsg.<tu-subdominio>.workers.dev`):

| Ruta | Auth | Uso |
|---|---|---|
| `GET /` | No | Health check |
| `POST /mcp` | `Authorization: Bearer <MCP_AUTH_TOKEN>` | Claude Code y clientes que permiten headers |
| `POST /mcp/<MCP_AUTH_TOKEN>` | Token en la ruta | Conector personalizado de claude.ai / Claude Desktop |

Si `MCP_AUTH_TOKEN` no está configurado (o tiene menos de 32 caracteres) el Worker responde 500 y no envía nada.

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
├── ultramsg.client.ts   # cliente HTTP de UltraMsg
└── tools/
    └── send-message.ts  # tool send-message
test/
├── e2e.test.mjs
└── worker.test.mjs
```

> UltraMsg es una API **no oficial** de WhatsApp. Un volumen alto de mensajes o mensajes no solicitados pueden provocar el bloqueo del número.
