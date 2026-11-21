export type Channel = "whatsapp" | "email" | "voice";
export interface ContactState { normalizedAddress: string; optedOut: boolean; lastContactAt?: string; contactCount30d: number; activeConversation: boolean; }
export interface OutreachDecision { allowed: boolean; reason: string; requiresHumanApproval: boolean; }
const DAY = 86_400_000;
export function evaluateOutreach(state: ContactState, channel: Channel, now = new Date()): OutreachDecision {
  if (!state.normalizedAddress.trim()) return { allowed: false, reason: "Missing verified recipient address.", requiresHumanApproval: true };
  if (state.optedOut) return { allowed: false, reason: "Recipient is on the global suppression list.", requiresHumanApproval: false };
  if (state.activeConversation) return { allowed: false, reason: "Continue the existing conversation; do not restart outreach.", requiresHumanApproval: false };
  if (state.contactCount30d >= 3) return { allowed: false, reason: "Frequency cap reached: three contacts in 30 days.", requiresHumanApproval: false };
  if (state.lastContactAt) { const elapsed = now.getTime() - new Date(state.lastContactAt).getTime(); if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed < 5 * DAY) return { allowed: false, reason: "Five-day minimum contact interval has not elapsed.", requiresHumanApproval: false }; }
  return { allowed: true, reason: `Eligible for reviewed ${channel} outreach; consent and provider rules must also pass.`, requiresHumanApproval: true };
}
