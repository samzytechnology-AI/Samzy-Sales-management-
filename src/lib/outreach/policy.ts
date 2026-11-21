export type Channel = "whatsapp" | "email" | "voice";
export interface ContactState {
  normalizedAddress: string;
  optedOut: boolean;
  lastContactAt?: string;
  contactCount30d: number;
  totalOutboundCount?: number;
  activeConversation: boolean;
}
export interface OutreachDecision { allowed: boolean; reason: string; requiresHumanApproval: boolean; }
const DAY = 86_400_000;

function businessDaysElapsed(fromValue: string, to: Date): number {
  const from = new Date(fromValue);
  if (!Number.isFinite(from.getTime()) || to.getTime() < from.getTime()) return -1;
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1);
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let days = 0;
  while (cursor <= end) {
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
    cursor += DAY;
  }
  return days;
}

/**
 * Three-touch maximum: first researched contact, one follow-up after five
 * business days, and a final follow-up after seven more business days.
 * No further cold outreach is allowed unless the recipient engages.
 */
export function evaluateOutreach(state: ContactState, channel: Channel, now = new Date()): OutreachDecision {
  if (!state.normalizedAddress.trim()) return { allowed: false, reason: "Missing verified recipient address.", requiresHumanApproval: true };
  if (state.optedOut) return { allowed: false, reason: "Recipient is on the global suppression list.", requiresHumanApproval: false };
  if (state.activeConversation) return { allowed: false, reason: "Continue the existing conversation; do not restart outreach.", requiresHumanApproval: false };

  const totalOutbound = state.totalOutboundCount ?? state.contactCount30d;
  if (totalOutbound >= 3) return { allowed: false, reason: "The three-message sequence is complete. Stop cold outreach unless the recipient engages.", requiresHumanApproval: false };
  if (state.contactCount30d >= 3) return { allowed: false, reason: "Frequency cap reached: three outbound attempts in 30 days.", requiresHumanApproval: false };

  if (totalOutbound > 0) {
    if (!state.lastContactAt) return { allowed: false, reason: "Previous outreach exists but its last-send time is unavailable.", requiresHumanApproval: false };
    const requiredBusinessDays = totalOutbound === 1 ? 5 : 7;
    const elapsedBusinessDays = businessDaysElapsed(state.lastContactAt, now);
    if (elapsedBusinessDays < 0 || elapsedBusinessDays < requiredBusinessDays) {
      return {
        allowed: false,
        reason: totalOutbound === 1
          ? "The first follow-up must wait at least five business days after the initial message."
          : "The final follow-up must wait at least seven business days after the first follow-up.",
        requiresHumanApproval: false,
      };
    }
  }

  return { allowed: true, reason: `Eligible for the ${totalOutbound === 0 ? "initial" : totalOutbound === 1 ? "first follow-up" : "final follow-up"} ${channel} message; owner/admin send action and channel rules still apply.`, requiresHumanApproval: true };
}
