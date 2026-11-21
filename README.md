# Samzy Business Command Centre

A modular operating system for Samzy Technology. The command centre coordinates independent products through explicit integrations; it does not absorb or rebuild their internal applications.

## Engineering baseline
- Next.js App Router and TypeScript.
- Three-provider AI orchestration interface: all configured models receive the same objective and context, contribute concurrently, and return into one shared workflow.
- Pricing policy engine with service floors and a separate negotiable asking-price calculation.
- Anti-spam policy primitives: suppression, deduplication, contact history and approval-first outbound mode.
- Supabase client placeholders for the dedicated Business Command Centre project only. Never connect the School Cloud database.

## Safety defaults
- Outbound communication stays disabled until configured and approved.
- No autonomous commitments, contracts, payment actions or final price approvals.
- Never store provider API keys in browser code or commit secrets.
- Research claims must retain source evidence and timestamps.

## Setup
1. Install Node.js 20+.
2. Copy `.env.example` to `.env.local` and add server-side secrets.
3. Run `npm install` and `npm run dev`.

Database migrations, provider adapters, messaging delivery and deployment require configuration and testing before production use.

## AI General Manager and chat persistence
- The dashboard includes an AI General Manager chat surface.
- Authenticated chat requests are scoped to an organization and an owner/admin/manager membership.
- Conversations and messages are persisted in `ai_conversations` and `ai_messages`; the dashboard restores the latest active conversation for the signed-in user.
- AI runs retain the initiating user, model contributions, synthesis, warnings and conversation reference.
- The server enforces an atomic limit of 30 AI requests per user per organization per hour. Adjust only after measuring provider quotas and cost.
- The browser never receives provider credentials. The server uses the Supabase service-role key only after verifying the user's bearer token and organization membership.

## Database migration order
Apply these migrations, in order, only to the new dedicated Business Command Centre Supabase project:
1. `supabase/migrations/20261121000100_command_centre_core.sql`
2. `supabase/migrations/20261121000200_ai_manager_persistence_and_limits.sql`

Do not apply these migrations to Samzy School Cloud. The current repository is prepared for later Supabase connection; migrations have not been applied to a live database.

## Deployment boundary
Vercel deployment and production environment configuration are intentionally deferred until the application code and verification pass are complete. At deployment time, add server-side provider keys and `SUPABASE_SERVICE_ROLE_KEY` as protected Vercel environment variables. Only the Supabase URL and anon/public key may be exposed to the browser.
