import { NextResponse } from "next/server";
import { getProviderConfiguration } from "@/lib/ai/provider-config";

export const runtime = "nodejs";

export async function GET() {
  const providers = getProviderConfiguration();
  const configuredCount = providers.filter((provider) => provider.configured).length;
  const emailOutreachReady = Boolean(process.env.RESEND_API_KEY && process.env.OUTREACH_FROM_EMAIL);
  const researchReady = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return NextResponse.json({
    status: "foundation",
    providers: providers.map(({ slot, provider, model, configured }) => ({ slot, provider: provider || null, model: model || null, configured })),
    aiReady: configuredCount === 3,
    supabaseConfigured,
    researchReady,
    emailOutreachReady,
    whatsappOutreachReady: false,
    outboundMode: "owner_admin_explicit_send",
    outboundEnabled: emailOutreachReady && supabaseConfigured,
  }, { headers: { "Cache-Control": "no-store" } });
}
