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
- Conversations and messages are persisted in `ai_conversations` and `ai_messages`; the dashboard opens one shared active company conversation for authorised owner/admin/manager users, so the General Manager history is company-wide rather than fragmented by user. Older personal conversations remain private.
- AI runs retain the initiating user, model contributions, synthesis, warnings and conversation reference.
- The server enforces an atomic limit of 30 AI requests per user per organization per hour. Adjust only after measuring provider quotas and cost.
- The browser never receives provider credentials. The server uses the Supabase service-role key only after verifying the user's bearer token and organization membership.

## Database migration order
Apply these migrations, in order, only to the new dedicated Business Command Centre Supabase project:
1. `supabase/migrations/20261121000100_command_centre_core.sql`
2. `supabase/migrations/20261121000200_ai_manager_persistence_and_limits.sql`
3. `supabase/migrations/20261121000300_dashboard_operational_records.sql`
4. `supabase/migrations/20261121000400_finance_summary_rpc.sql`
5. `supabase/migrations/20261121000500_crm_prospect_conversion.sql`
6. `supabase/migrations/20261121000600_shared_company_ai_conversation.sql`

Do not apply these migrations to Samzy School Cloud. The current repository is prepared for later Supabase connection; migrations have not been applied to a live database.

## Dashboard operational modules
The authenticated dashboard workspace API provides organisation-scoped reads and writes for prospects, clients, projects, finance transactions and approval requests; CRM and project records support audited status updates, and projects can be linked to same-organisation clients and prospects and assigned to registered Samzy products. Prospects have a fit score, canonical website duplicate checks, transactional prospect-to-client conversion with source linkage and audit history, and organisation-scoped contact-point capture. Contact points are unverified by default; email addresses are normalised, and the AI context receives contact-channel verification counts without receiving the stored contact addresses. Product registry supports product registration and outreach history is read-only in the current dashboard UI. Approval decisions are restricted to owners and administrators. Finance totals use a database aggregate function rather than summing only the visible transaction page. The dashboard requires migrations 003, 004 and 005 before the latest CRM and AI Manager features can load. The AI General Manager uses a single organisation-wide conversation and receives a bounded, read-only snapshot of recent prospects, clients, projects, approvals, outreach events, financial aggregates, recent AI runs and audit events, alongside approved company memory and the current conversation. Snapshot records are organisation-scoped and timestamped; the assistant must distinguish loaded recent records from all-time totals and cannot claim access to activity outside connected systems.

## Deployment boundary
Vercel deployment and production environment configuration are intentionally deferred until the application code and verification pass are complete. At deployment time, add server-side provider keys and `SUPABASE_SERVICE_ROLE_KEY` as protected Vercel environment variables. Only the Supabase URL and anon/public key may be exposed to the browser.

## Dashboard interaction tests
- Install dependencies with `npm install`.
- Build the production app with `npm run build`.
- Install the Playwright Chromium browser with `npx playwright install chromium`.
- Run dashboard browser tests with `npm run test:e2e`.
- The current 19-test browser suite covers primary navigation and workspace gating, AI Manager controls, secure sign-in/sign-out, mocked authenticated workspace access, and create, status-update and approval workflows for prospects, clients, projects, products, finance and approval requests, including project-to-CRM and product assignment, prospect-to-client conversion, live overview metrics contact-point capture safeguards and shared AI conversation history attribution.
- Authenticated browser tests use a mocked Supabase sign-in and mocked workspace API. They verify front-end request/response behavior, not live database persistence, real provider API calls, external message delivery or production deployment.
