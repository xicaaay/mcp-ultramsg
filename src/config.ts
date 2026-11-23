import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude lanza el servidor desde cualquier directorio, así que el .env se
// busca en la raíz del proyecto y no en el cwd.
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export interface UltraMsgConfig {
  instanceId: string;
  token: string;
  baseUrl: string;
}

export function loadConfig(): UltraMsgConfig {
  const instanceId = process.env.ULTRAMSG_INSTANCE_ID?.trim();
  const token = process.env.ULTRAMSG_TOKEN?.trim();

  const missing = [
    !instanceId && 'ULTRAMSG_INSTANCE_ID',
    !token && 'ULTRAMSG_TOKEN',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(', ')}. Configúralas en .env o en la config del servidor MCP.`,
    );
  }

  return {
    instanceId: instanceId!,
    token: token!,
    baseUrl: (process.env.ULTRAMSG_BASE_URL?.trim() || 'https://api.ultramsg.com').replace(/\/+$/, ''),
  };
}
