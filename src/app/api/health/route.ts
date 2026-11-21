import { NextResponse } from "next/server";
import { getProviderConfiguration } from "@/lib/ai/provider-config";
export const runtime = "nodejs";
export async function GET() {
  const providers = getProviderConfiguration();
  const configuredCount = providers.filter((provider) => provider.configured).length;
  return NextResponse.json({ status: "foundation", providers: providers.map(({ slot, provider, model, configured }) => ({ slot, provider: provider || null, model: model || null, configured })), aiReady: configuredCount === 3, supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), outboundMode: "approval_only", outboundEnabled: false }, { headers: { "Cache-Control": "no-store" } });
}
