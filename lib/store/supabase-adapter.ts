
import type { Store, Identity, PendingOrderIntent, PurchaseRecord } from './index';

function notConfigured(method: string): never {
  const hasEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  throw new Error(
    `Supabase store adapter is a stub: ${method}() is not implemented ` +
      (hasEnv ? '(env is set, but no client code exists yet). ' : '(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are also unset). ') +
      'Finish lib/store/supabase-adapter.ts before calling createSupabaseStore().',
  );
}

class SupabaseStore implements Store {
  resolveIdentity(_hint: { cookieId?: string; ip?: string }): Identity {
    return notConfigured('resolveIdentity');
  }

  getCredits(_identityId: string): number {
    return notConfigured('getCredits');
  }

  grantCredits(_identityId: string, _n: number): number {
    return notConfigured('grantCredits');
  }

  consumeCredit(_identityId: string): boolean {
    return notConfigured('consumeCredit');
  }

  getFreeUsed(_identityId: string): number {
    return notConfigured('getFreeUsed');
  }

  incFreeUsed(_identityId: string): number {
    return notConfigured('incFreeUsed');
  }

  putPendingOrder(_orderId: string, _intent: PendingOrderIntent): void {
    notConfigured('putPendingOrder');
  }

  getPendingOrder(_orderId: string): PendingOrderIntent | null {
    return notConfigured('getPendingOrder');
  }

  recordPurchase(_p: PurchaseRecord): boolean {
    return notConfigured('recordPurchase');
  }

  hitRateLimit(_key: string, _limit: number, _windowMs: number): boolean {
    return notConfigured('hitRateLimit');
  }

  addSpend(_units: number): number {
    return notConfigured('addSpend');
  }

  getSpendToday(): number {
    return notConfigured('getSpendToday');
  }

  recordLead(_identityId: string, _contact: { email?: string; whatsapp?: string }): void {
    notConfigured('recordLead');
  }

  recordResultOwner(_resultId: string, _identityId: string): void {
    notConfigured('recordResultOwner');
  }

  ownsResult(_resultId: string, _identityId: string): boolean {
    return notConfigured('ownsResult');
  }
}

export function createSupabaseStore(): Store {
  return new SupabaseStore();
}
