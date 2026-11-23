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

## Pruebas

```bash
npm test          # e2e: cliente MCP real + UltraMsg simulado en localhost (no envía mensajes reales)
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
├── index.ts             # arranque del servidor MCP (stdio)
├── config.ts            # carga y validación de variables de entorno
├── ultramsg.client.ts   # cliente HTTP de UltraMsg
└── tools/
    └── send-message.ts  # tool send-message
test/
└── e2e.test.mjs
```

> UltraMsg es una API **no oficial** de WhatsApp. Un volumen alto de mensajes o mensajes no solicitados pueden provocar el bloqueo del número.
