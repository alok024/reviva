import crypto from 'crypto';
import { getStore, type Identity } from '@/lib/store';

const IDENTITY_COOKIE = 'reviva_id';
const IDENTITY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const RESTORE_RATE_LIMIT = 12;
const RESTORE_RATE_WINDOW_MS = 60_000;

// Global (not per-identity) circuit breaker, bounding worst-case model spend
const DAILY_SPEND_CAP = 200;

export const FREE_LIMIT = 2;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? undefined;
}

export function resolveIdentityFromRequest(req: Request): { identity: Identity; cookieHeader: string } {
  const token = readCookie(req, IDENTITY_COOKIE) || crypto.randomUUID();
  const identity = getStore().resolveIdentity({ cookieId: token });
  const cookieHeader =
    `${IDENTITY_COOKIE}=${encodeURIComponent(token)}; Path=/; ` +
    `Max-Age=${IDENTITY_COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`;
  return { identity, cookieHeader };
}

export function checkRestoreRateLimit(identityId: string): boolean {
  return getStore().hitRateLimit(`restore:${identityId}`, RESTORE_RATE_LIMIT, RESTORE_RATE_WINDOW_MS);
}

export function isDailySpendCapped(): boolean {
  return getStore().getSpendToday() >= DAILY_SPEND_CAP;
}

export function recordSpend(units = 1): number {
  return getStore().addSpend(units);
}
