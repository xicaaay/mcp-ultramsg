// Sin dependencias de Node: se usa tanto en el servidor stdio (process.env)
// como en el Worker de Cloudflare (bindings `env`).

export interface UltraMsgConfig {
  instanceId: string;
  token: string;
  baseUrl: string;
}

export type EnvSource = Record<string, unknown>;

export function loadConfig(env: EnvSource): UltraMsgConfig {
  const instanceId = str(env.ULTRAMSG_INSTANCE_ID);
  const token = str(env.ULTRAMSG_TOKEN);

  const missing = [
    !instanceId && 'ULTRAMSG_INSTANCE_ID',
    !token && 'ULTRAMSG_TOKEN',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(', ')}. Configúralas en .env, en la config del servidor MCP o como secrets del Worker.`,
    );
  }

  return {
    instanceId: instanceId!,
    token: token!,
    baseUrl: (str(env.ULTRAMSG_BASE_URL) || 'https://api.ultramsg.com').replace(/\/+$/, ''),
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() || undefined : undefined;
}
