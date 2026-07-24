// Process-wide store contract for Reviva. Backs identity resolution, a credit ledger, a
// server-side free-tier counter, pending-order intent (so payment verify reconstructs what
// was bought instead of trusting a client-supplied amount), single-use purchase records, a
// windowed rate limiter, a daily spend circuit-breaker counter, and lead capture.
//
// getStore() returns a zero-dependency in-memory singleton — the only default this app ships
// with, so local dev/CI never need a real datastore. A durable backend is a separate opt-in
// adapter; see ./supabase-adapter (never wired in here).

import crypto from 'crypto';

export interface Identity {
  id: string;
}

export interface PurchaseRecord {
  orderId: string;
  paymentId: string;
  planId: string;
  amount: number;
  identityId: string;
  createdAt: number;
}

export interface Store {
  resolveIdentity(hint: { cookieId?: string; ip?: string }): Identity;
  getCredits(identityId: string): number;
  grantCredits(identityId: string, n: number): number;
  consumeCredit(identityId: string): boolean;
  getFreeUsed(identityId: string): number;
  incFreeUsed(identityId: string): number;
  putPendingOrder(orderId: string, intent: { planId: string; amount: number }): void;
  getPendingOrder(orderId: string): { planId: string; amount: number } | null;
  recordPurchase(p: PurchaseRecord): boolean;
  hitRateLimit(key: string, limit: number, windowMs: number): boolean;
  addSpend(units: number): number;
  getSpendToday(): number;
  recordLead(identityId: string, contact: { email?: string; whatsapp?: string }): void;
  recordResultOwner(resultId: string, identityId: string): void;
  ownsResult(resultId: string, identityId: string): boolean;
}

interface RateBucket {
  windowStart: number;
  count: number;
}

interface Lead {
  identityId: string;
  email?: string;
  whatsapp?: string;
  createdAt: number;
}

// Zero-dependency in-memory Store. State lives only for the process lifetime, which is fine
// for mock mode, tests, and single-instance deploys; swap in a real adapter to survive restarts
// or run more than one instance.
class MemoryStore implements Store {
  private credits = new Map<string, number>();
  private freeUsed = new Map<string, number>();
  private pendingOrders = new Map<string, { planId: string; amount: number }>();
  private purchases = new Set<string>();
  private rateBuckets = new Map<string, RateBucket>();
  private leads: Lead[] = [];
  private resultOwners = new Map<string, string>();
  private spendDay = '';
  private spendTotal = 0;

  resolveIdentity(hint: { cookieId?: string; ip?: string }): Identity {
    // Hash so the same cookie/IP always resolves to the same bucket without storing raw PII.
    const raw = hint.cookieId || hint.ip || 'anon';
    return { id: 'id_' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24) };
  }

  getCredits(identityId: string): number {
    return this.credits.get(identityId) ?? 0;
  }

  grantCredits(identityId: string, n: number): number {
    const next = this.getCredits(identityId) + n;
    this.credits.set(identityId, next);
    return next;
  }

  consumeCredit(identityId: string): boolean {
    const bal = this.getCredits(identityId);
    if (bal <= 0) return false;
    this.credits.set(identityId, bal - 1);
    return true;
  }

  getFreeUsed(identityId: string): number {
    return this.freeUsed.get(identityId) ?? 0;
  }

  incFreeUsed(identityId: string): number {
    const next = this.getFreeUsed(identityId) + 1;
    this.freeUsed.set(identityId, next);
    return next;
  }

  putPendingOrder(orderId: string, intent: { planId: string; amount: number }): void {
    this.pendingOrders.set(orderId, intent);
  }

  getPendingOrder(orderId: string): { planId: string; amount: number } | null {
    return this.pendingOrders.get(orderId) ?? null;
  }

  recordPurchase(p: PurchaseRecord): boolean {
    // Keyed by orderId+paymentId (not orderId alone) so a retried/replayed verify can't double-grant.
    const key = `${p.orderId}:${p.paymentId}`;
    if (this.purchases.has(key)) return false;
    this.purchases.add(key);
    return true;
  }

  hitRateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      this.rateBuckets.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  addSpend(units: number): number {
    this.rolloverSpendDay();
    this.spendTotal += units;
    return this.spendTotal;
  }

  getSpendToday(): number {
    this.rolloverSpendDay();
    return this.spendTotal;
  }

  // Spend resets on UTC date change — a plain day-key avoids a timer/cron for a single counter.
  private rolloverSpendDay(): void {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.spendDay) {
      this.spendDay = key;
      this.spendTotal = 0;
    }
  }

  recordLead(identityId: string, contact: { email?: string; whatsapp?: string }): void {
    this.leads.push({ identityId, ...contact, createdAt: Date.now() });
  }

  recordResultOwner(resultId: string, identityId: string): void {
    if (this.resultOwners.has(resultId)) return; // first record wins; ownership is immutable once set
    this.resultOwners.set(resultId, identityId);
  }

  ownsResult(resultId: string, identityId: string): boolean {
    return this.resultOwners.get(resultId) === identityId;
  }
}

let singleton: Store | null = null;

// Process-wide in-memory default. Keyless: works with zero env and zero external services.
export function getStore(): Store {
  if (!singleton) singleton = new MemoryStore();
  return singleton;
}
