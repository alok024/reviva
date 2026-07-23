import { createOrder, verifyPaymentSignature, mockSignature, RAZORPAY_MOCK } from './razorpay';

export type PlanKind = 'one-time' | 'sub';

export interface Plan {
  amount: number; // smallest currency unit (cents)
  currency: string;
  label: string;
  kind: PlanKind;
}

export const PLANS: Record<string, Plan> = {
  pack20: { amount: 499, currency: 'USD', label: '$4.99 - 20 photos', kind: 'one-time' },
  unlimited_month: { amount: 900, currency: 'USD', label: '$9/mo - unlimited', kind: 'sub' },
};

export function listPlans(): Array<{ id: string } & Plan> {
  return Object.entries(PLANS).map(([id, p]) => ({ id, ...p }));
}

export async function createCheckoutOrder(planId: string) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const order = await createOrder(plan.amount, plan.currency, { planId });

  if (order.mock) {
    // Precompute the mock payment so the browser can complete without a real Razorpay modal.
    const paymentId = 'pay_mock_' + order.order_id.slice(-8);
    const signature = mockSignature(order.order_id, paymentId);
    return {
      ...order,
      planId,
      label: plan.label,
      mock_payment: { payment_id: paymentId, signature },
    };
  }

  return { ...order, planId, label: plan.label };
}

export function confirmPurchase(order_id: string, payment_id: string, signature: string): boolean {
  return verifyPaymentSignature(order_id, payment_id, signature);
}

export { RAZORPAY_MOCK };
