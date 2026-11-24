import { NextResponse } from "next/server";
import { getProviderConfiguration } from "@/lib/ai/provider-config";

export const runtime = "nodejs";

export async function GET() {
  const providers = getProviderConfiguration();
  const configuredCount = providers.filter((provider) => provider.configured).length;
  const emailOutreachReady = Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const researchReady = Boolean(process.env.TAVILY_API_KEY);
  const whatsappOutreachReady = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME);
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return NextResponse.json({
    status: "foundation",
    providers: providers.map(({ slot, provider, model, configured }) => ({ slot, provider: provider || null, model: model || null, configured })),
    aiReady: configuredCount > 0,
    configuredProviderCount: configuredCount,
    supabaseConfigured,
    researchReady,
    emailOutreachReady,
    gmailOAuthReady: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET),
    whatsappOutreachReady,
    outboundMode: "owner_admin_explicit_send",
    outboundEnabled: emailOutreachReady && supabaseConfigured,
  }, { headers: { "Cache-Control": "no-store" } });
}
