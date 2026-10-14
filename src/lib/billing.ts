import { Capacitor } from '@capacitor/core';
import { api } from './client';
import type { Entitlement, Plan } from '../types';
type ProductOffer = CdvPurchase.Offer;
const productId = import.meta.env.VITE_PLAY_PRODUCT_ID || 'voice_plus';
const planIds = { weekly: import.meta.env.VITE_PLAY_WEEKLY_PLAN_ID || 'weekly', monthly: import.meta.env.VITE_PLAY_MONTHLY_PLAN_ID || 'monthly' };
export const isAndroid = Capacitor.getPlatform() === 'android';
export const manageSubscriptionUrl = `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(productId)}&package=com.rizzmaster.voice`;
function purchaseToken(receipt: unknown, depth = 0): string | null {
  if (!receipt || depth > 6 || typeof receipt !== 'object') return null;
  const object = receipt as Record<string, unknown>;
  if (typeof object.purchaseToken === 'string') return object.purchaseToken;
  if (object.nativePurchase && typeof object.nativePurchase === 'object') {
    const native = object.nativePurchase as Record<string, unknown>;
    if (typeof native.token === 'string') return native.token;
  }
  for (const key of ['nativePurchase', 'receipt', 'parentReceipt', 'transactions', 'transaction']) {
    const value = object[key];
    if (Array.isArray(value)) { for (const item of value) { const token = purchaseToken(item, depth + 1); if (token) return token; } }
    else { const token = purchaseToken(value, depth + 1); if (token) return token; }
  }
  return null;
}
let initialized = false;
let preparing: Promise<void> | null = null;
let userHash = '';
let onChange: (value: Entitlement) => void = () => {};
let onProblem: (message: string) => void = () => {};
const verifying = new Set<string>();
export function setBillingCallbacks(change: typeof onChange, problem: typeof onProblem) { onChange = change; onProblem = problem; }
export async function initializeBilling(userId: string) {
  if (!isAndroid) return;
  userHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId)))).map(x => x.toString(16).padStart(2, '0')).join('');
  if (initialized) return;
  if (preparing) return preparing;
  preparing = (async () => {
    await import('cordova-plugin-purchase/www/store.js');
    const store = CdvPurchase.store;
    // Already SHA-256 obfuscated, so native code must not transform it a second time.
    store.obfuscator = 'disabled'; store.applicationUsername = () => userHash;
    store.register({ id: productId, type: CdvPurchase.ProductType.PAID_SUBSCRIPTION, platform: CdvPurchase.Platform.GOOGLE_PLAY });
    store.when().approved(transaction => { void verifyTransaction(transaction); });
    store.error(error => { if (error.code !== CdvPurchase.ErrorCode.PAYMENT_CANCELLED) onProblem(error.message || 'Google Play couldn’t complete the purchase.'); });
    const errors = await store.initialize([CdvPurchase.Platform.GOOGLE_PLAY]);
    if (errors?.length) throw new Error(errors[0].message);
    initialized = true;
  })();
  try { await preparing; } finally { preparing = null; }
}
async function verifyTransaction(transaction: CdvPurchase.Transaction) {
  const token = purchaseToken(transaction.parentReceipt);
  if (!token || verifying.has(token)) { if (!token) onProblem('Google Play purchase details were incomplete. Please use Restore purchases.'); return; }
  verifying.add(token);
  const account = userHash;
  try {
    const result = await api<{ entitlement: Entitlement }>('billing/verify', { purchase_token: token });
    if (account && account === userHash) onChange(result.entitlement);
    // Server acknowledges only verified, correctly bound purchases before finishing.
    await transaction.finish();
  } catch (error) { onProblem(error instanceof Error ? error.message : 'Purchase verification needs a retry.'); }
  finally { verifying.delete(token); }
}
function offerFor(plan: Plan): ProductOffer | undefined {
  if (!initialized) return undefined;
  const product = CdvPurchase.store.get(productId, CdvPurchase.Platform.GOOGLE_PLAY);
  return product?.offers.find(offer => offer.id === `${productId}@${planIds[plan]}` || offer.id === planIds[plan]);
}
export function priceFor(plan: Plan) {
  const offer = offerFor(plan);
  // Only sell the normal recurring base plan, never silently pick a trial offer.
  const phase = offer?.pricingPhases.at(-1);
  return phase?.price || null;
}
export async function subscribe(plan: Plan, userId: string) {
  if (!isAndroid) throw new Error('Subscribe securely in the Rizzmaster Voice Android app through Google Play.');
  await initializeBilling(userId);
  const offer = offerFor(plan);
  if (!offer || !priceFor(plan)) throw new Error('This subscription is not available from Google Play yet. Please try again later.');
  const error = await offer.order();
  if (error && error.code !== CdvPurchase.ErrorCode.PAYMENT_CANCELLED) throw new Error(error.message || 'Purchase could not start.');
}
export async function restorePurchases(userId: string) {
  if (!isAndroid) throw new Error('Restore purchases in the Android app using the Google account that subscribed.');
  await initializeBilling(userId);
  const error = await CdvPurchase.store.restorePurchases();
  if (error) throw new Error(error.message);
  // Purchased transactions may already be acknowledged, so explicitly verify receipts too.
  let count = 0;
  for (const receipt of CdvPurchase.store.localReceipts) {
    const token = purchaseToken(receipt);
    if (token) { const result = await api<{ entitlement: Entitlement }>('billing/verify', { purchase_token: token }); onChange(result.entitlement); count++; }
  }
  if (!count) throw new Error('No subscription was found. Check the Google account used to subscribe.');
}
export function clearBillingAccount() { userHash = ''; }
