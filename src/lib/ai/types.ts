export type ModelSlot = "A" | "B" | "C";
export type ModelTask = "prospect_discovery" | "company_research" | "lead_qualification" | "outreach_draft" | "reply_analysis" | "business_advice";
export interface ModelRequest { task: ModelTask; objective: string; context: Record<string, unknown>; evidence?: Array<{ url: string; title?: string; excerpt?: string }>; }
export interface ModelContribution { slot: ModelSlot; provider: string; model: string; content: string; confidence?: number; evidence?: Array<{ url: string; claim: string }>; usage?: { inputTokens?: number; outputTokens?: number }; }
export interface ModelAdapter { readonly slot: ModelSlot; readonly provider: string; readonly model: string; generate(request: ModelRequest): Promise<ModelContribution>; }
export interface CoordinatedResult { objective: string; contributions: ModelContribution[]; synthesis: string; warnings: string[]; completedAt: string; }
