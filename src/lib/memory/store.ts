import { createServerSupabaseClient } from "../supabase/server";
export type MemoryCategory = "policy" | "decision" | "client_context" | "project_context" | "lesson" | "preference" | "temporary_instruction";
export interface MemoryInput { organizationId: string; category: MemoryCategory; title: string; content: string; sourceType?: string; sourceReference?: string; confidence?: number; approved?: boolean; expiresAt?: string | null; createdBy?: string; }
export async function saveCompanyMemory(input: MemoryInput) {
  if (!input.organizationId || !input.title.trim() || !input.content.trim()) throw new Error("Organization, title and memory content are required.");
  const confidence = input.confidence ?? 1;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Memory confidence must be between 0 and 1.");
  const db = createServerSupabaseClient();
  const { data, error } = await db.from("company_memory").insert({ organization_id: input.organizationId, category: input.category, title: input.title.trim(), content: input.content.trim(), source_type: input.sourceType ?? "user_instruction", source_reference: input.sourceReference ?? null, confidence, is_approved: input.approved ?? false, expires_at: input.expiresAt ?? null, created_by: input.createdBy ?? null }).select("id, category, title, content, confidence, is_approved, expires_at, created_at").single();
  if (error) throw new Error(`Could not save company memory: ${error.message}`);
  return data;
}
export async function retrieveCompanyMemory(organizationId: string, query: string, limit = 12) {
  if (!organizationId) throw new Error("Organization ID is required.");
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const db = createServerSupabaseClient();
  let request = db.from("company_memory").select("id, category, title, content, source_type, source_reference, confidence, is_approved, expires_at, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(safeLimit);
  if (query.trim()) request = request.or(`title.ilike.%${query.replace(/[%,()]/g, " ")}%,content.ilike.%${query.replace(/[%,()]/g, " ")}%`);
  const { data, error } = await request;
  if (error) throw new Error(`Could not retrieve company memory: ${error.message}`);
  const now = Date.now();
  return (data ?? []).filter((item) => !item.expires_at || new Date(item.expires_at).getTime() > now);
}
