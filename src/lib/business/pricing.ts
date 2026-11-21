export type ServiceKey = "landing_page" | "ecommerce" | "school_management" | "other";
export const MINIMUM_PRICES_NGN: Record<ServiceKey, number> = { landing_page: 100_000, ecommerce: 150_000, school_management: 350_000, other: 0 };
export interface PriceQuote { service: ServiceKey; scopeValueNgn: number; minimumNgn: number; askingPriceNgn: number; negotiable: true; requiresApproval: true; belowFloor: boolean; }
/** A configurable negotiation margin is added to the scoped target. Never invent a former price or discount. */
export function calculateAskingPrice(service: ServiceKey, scopeValueNgn: number, negotiationMarginNgn = 100_000): PriceQuote {
  for (const [name, value] of Object.entries({ scopeValueNgn, negotiationMarginNgn })) if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number.`);
  const minimumNgn = MINIMUM_PRICES_NGN[service];
  const askingPriceNgn = Math.max(scopeValueNgn, minimumNgn) + negotiationMarginNgn;
  return { service, scopeValueNgn, minimumNgn, askingPriceNgn, negotiable: true, requiresApproval: true, belowFloor: scopeValueNgn < minimumNgn };
}
export function isAllowedFinalPrice(service: ServiceKey, finalPriceNgn: number): boolean { return Number.isFinite(finalPriceNgn) && finalPriceNgn >= MINIMUM_PRICES_NGN[service]; }
