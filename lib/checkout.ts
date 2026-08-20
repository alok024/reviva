import { createOrder, verifyPaymentSignature, mockSignature, RAZORPAY_MOCK } from './razorpay';
import { getStore } from './store';

export type PlanKind = 'one-time';

export interface Plan {
  amount: number;
  currency: 'INR';
  label: string;
  kind: PlanKind;
  credits: number;
}

export const PLANS: Record<'single' | 'album', Plan> = {
  single: {
    amount: 59900,
    currency: 'INR',
    label: 'One memorial photo - full restoration + human QA',
    kind: 'one-time',
    credits: 1,
  },
  album: {
    amount: 299900,
    currency: 'INR',
    label: 'Memorial album, up to 15 photos - full restoration + human QA',
    kind: 'one-time',
    credits: 15,
  },
};

const LEGACY_PLAN_IDS: Record<string, keyof typeof PLANS> = {
  pack20: 'single',
};

function resolvePlanId(planId: string): (keyof typeof PLANS) | undefined {
  if (Object.hasOwn(PLANS, planId)) return planId as keyof typeof PLANS;
  if (Object.hasOwn(LEGACY_PLAN_IDS, planId)) return LEGACY_PLAN_IDS[planId];
  return undefined;
}

export function listPlans(): Array<{ id: string } & Plan> {
  return Object.entries(PLANS).map(([id, p]) => ({ id, ...p }));
}

export async function createCheckoutOrder(planId: string, identityId: string) {
  const resolvedId = resolvePlanId(planId);
  if (!resolvedId) throw new Error(`Unknown plan: ${planId}`);
  const plan = PLANS[resolvedId];

  const order = await createOrder(plan.amount, plan.currency, { planId: resolvedId });
  getStore().putPendingOrder(order.order_id, { planId: resolvedId, amount: plan.amount, identityId });

  if (order.mock) {
    const paymentId = 'pay_mock_' + order.order_id.slice(-8);
    const signature = mockSignature(order.order_id, paymentId);
    return {
      ...order,
      planId: resolvedId,
      label: plan.label,
      mock_payment: { payment_id: paymentId, signature },
    };
  }

  return { ...order, planId: resolvedId, label: plan.label };
}

export function confirmPurchase(order_id: string, payment_id: string, signature: string): boolean {
  return verifyPaymentSignature(order_id, payment_id, signature);
}

function grantFromPendingOrder(order_id: string, payment_id: string): { ok: boolean; credited: number } {
  const store = getStore();
  const intent = store.getPendingOrder(order_id);
  if (!intent) return { ok: false, credited: 0 };

  const plan = Object.hasOwn(PLANS, intent.planId) ? PLANS[intent.planId as keyof typeof PLANS] : undefined;
  if (!plan || intent.amount !== plan.amount) return { ok: false, credited: 0 };

  const recorded = store.recordPurchase({
    orderId: order_id,
    paymentId: payment_id,
    planId: intent.planId,
    amount: intent.amount,
    identityId: intent.identityId,
    createdAt: Date.now(),
  });
  if (!recorded) return { ok: false, credited: 0 };

  store.grantCredits(intent.identityId, plan.credits);
  return { ok: true, credited: plan.credits };
}

export function finalizePurchase(
  order_id: string,
  payment_id: string,
  signature: string
): { ok: boolean; credited: number } {
  if (!confirmPurchase(order_id, payment_id, signature)) return { ok: false, credited: 0 };
  return grantFromPendingOrder(order_id, payment_id);
}

export function finalizePurchaseFromWebhook(
  order_id: string,
  payment_id: string,
  capturedAmount: number
): { ok: boolean; credited: number } {
  const intent = getStore().getPendingOrder(order_id);
  if (!intent || intent.amount !== capturedAmount) return { ok: false, credited: 0 };
  return grantFromPendingOrder(order_id, payment_id);
}

export { RAZORPAY_MOCK };
