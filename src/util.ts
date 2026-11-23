import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ---------- Identificadores de WhatsApp ----------

/** Número internacional (+5215512345678) o chat id (5215512345678@c.us, ...@g.us). */
export const RECIPIENT = /^(\+?\d{8,15}|\d{8,30}(-\d+)?@(c|g)\.us)$/;
const GROUP_ID = /^\d{8,30}(-\d+)?@g\.us$/;

const stripFormatting = (v: string) => v.replace(/[\s()-]/g, '');

export const recipientSchema = z
  .string()
  .transform(stripFormatting)
  .refine((v) => RECIPIENT.test(v), {
    message: 'Destinatario inválido: usa formato internacional (+5215512345678) o un chat id (...@c.us / ...@g.us)',
  });

export const groupIdSchema = z
  .string()
  .trim()
  .refine((v) => GROUP_ID.test(v), { message: 'groupId inválido: debe terminar en @g.us (usa list-groups para obtenerlo)' })
  .describe('Id del grupo, p. ej. 120363412480561558@g.us (obtenlo con list-groups)');

/** 50212345678@c.us → +50212345678. Otros formatos (p. ej. @lid) se devuelven tal cual. */
export function phoneOf(waId: string | undefined): string | undefined {
  if (!waId) return undefined;
  const m = waId.match(/^(\d+)@c\.us$/);
  return m ? `+${m[1]}` : waId;
}

/** +502 1234-5678 / 50212345678 / 50212345678@c.us → 50212345678@c.us */
export function toContactId(v: string): string {
  const s = stripFormatting(v);
  if (s.includes('@')) return s;
  return `${s.replace(/^\+/, '')}@c.us`;
}

// ---------- Fechas y zonas horarias ----------

export const DEFAULT_TZ = 'America/Guatemala';

export const timezoneSchema = z
  .string()
  .trim()
  .default(DEFAULT_TZ)
  .refine(isValidTimeZone, { message: 'Zona horaria IANA inválida (p. ej. America/Guatemala)' })
  .describe(`Zona horaria IANA (por defecto ${DEFAULT_TZ})`);

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa formato YYYY-MM-DD')
  .describe('Día en formato YYYY-MM-DD (por defecto: hoy en la zona horaria indicada)');

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa formato HH:MM (24 h)');

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

function offsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC (ms) de una fecha/hora local en `tz`. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = offsetMs(guess, tz);
  const t = guess - off;
  const off2 = offsetMs(t, tz);
  return off2 === off ? t : guess - off2;
}

/** Fecha de hoy (YYYY-MM-DD) en `tz`. */
export function todayIn(tz: string, now = Date.now()): string {
  const p = zonedParts(now, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Unix (segundos) → "YYYY-MM-DD HH:MM" en `tz`. */
export function formatLocal(unixSeconds: number, tz: string): string {
  const p = zonedParts(unixSeconds * 1000, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

/** Rango [inicio, fin) en segundos Unix para un día local entre dos horas. `end` "23:59" cubre hasta medianoche. */
export function dayWindow(date: string, start: string, end: string, tz: string): { from: number; to: number } {
  const from = zonedToUtc(date, start, tz) / 1000;
  const to = (zonedToUtc(date, end, tz) + 60_000) / 1000;
  return { from, to };
}

const pad = (n: number) => String(n).padStart(2, '0');

// ---------- Respuestas de tools ----------

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function fail(prefix: string, err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: `${prefix}: ${message}` }] };
}
