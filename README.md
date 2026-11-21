# Samzy Business Command Centre

A modular operating system for Samzy Technology. The command centre coordinates independent products through explicit integrations; it does not absorb or rebuild their internal applications.

## Engineering baseline
- Next.js App Router and TypeScript.
- Three-provider AI orchestration interface: all configured models receive the same objective and context, contribute concurrently, and return into one shared workflow.
- Pricing policy engine with service floors and a separate negotiable asking-price calculation.
- Anti-spam policy primitives: suppression, deduplication, contact history and approval-first outbound mode.
- Supabase client placeholders for the dedicated Business Command Centre project only. Never connect the School Cloud database.

## Safety defaults
- External email delivery remains disabled until the server-side Resend credentials are configured and an owner/admin explicitly clicks Send. WhatsApp first-contact delivery remains blocked until approved Meta templates and credentials are configured.
- No autonomous commitments, contracts, payment actions or final price approvals.
- Never store provider API keys in browser code or commit secrets.
- Research claims must retain source evidence and timestamps.

## Setup
1. Install Node.js 20+.
2. Copy `.env.example` to `.env.local` and add server-side secrets.
3. Run `npm install` and `npm run dev`.

Database migrations and live AI providers still require configuration. Resend email delivery code is implemented but requires credentials and live verification. WhatsApp first-contact templates, provider credentials, database migration application and deployment remain pending.

## Live prospect research
- Authenticated company users can request live web research through the server-side Brave Search adapter.
- Prospect discovery, company research, lead qualification and outreach drafting tasks trigger one bounded search request; up to eight source-linked results are passed into the AI context as untrusted evidence.
- The AI must distinguish source-backed facts from inference, cite source URLs and state unknowns. Search snippets do not independently verify a company's claims or guarantee buyer intent.
- Configure `BRAVE_SEARCH_API_KEY` as a server-only environment variable. The browser never receives this key. Without it, the AI continues using connected company records and explicitly warns that live research was unavailable.
- Brave Search API usage may incur provider charges according to the selected plan; keep the result count and number of searches bounded.

## AI General Manager and chat persistence
- The dashboard includes an AI General Manager chat surface.
- Authenticated chat requests are scoped to an organization and an owner/admin/manager membership.
- Conversations and messages are persisted in `ai_conversations` and `ai_messages`; the dashboard opens one shared active company conversation for authorised owner/admin/manager users, so the General Manager history is company-wide rather than fragmented by user. Older personal conversations remain private.
- AI runs retain the initiating user, model contributions, synthesis, warnings and conversation reference.
- The server enforces an atomic shared limit of 30 AI and live-research requests per user per organization per hour. Adjust only after measuring provider quotas and cost.
- The browser never receives provider credentials. The server uses the Supabase service-role key only after verifying the user's bearer token and organization membership.

## Database migration order
Apply these migrations, in order, only to the new dedicated Business Command Centre Supabase project:
1. `supabase/migrations/20261121000100_command_centre_core.sql`
2. `supabase/migrations/20261121000200_ai_manager_persistence_and_limits.sql`
3. `supabase/migrations/20261121000300_dashboard_operational_records.sql`
4. `supabase/migrations/20261121000400_finance_summary_rpc.sql`
5. `supabase/migrations/20261121000500_crm_prospect_conversion.sql`
6. `supabase/migrations/20261121000600_shared_company_ai_conversation.sql`
7. `supabase/migrations/20261121000700_ai_action_approval_engine.sql`
8. `supabase/migrations/20261121000800_task_management.sql`
9. `supabase/migrations/20261121000900_service_role_data_api_grants.sql`

Do not apply these migrations to Samzy School Cloud. The current repository is prepared for later Supabase connection; migrations have not been applied to a live database.

## Dashboard operational modules
The authenticated dashboard workspace API provides organisation-scoped reads and writes for prospects, clients, projects, finance transactions and approval requests; CRM and project records support audited status updates, and projects can be linked to same-organisation clients and prospects and assigned to registered Samzy products. Prospects have a fit score, canonical website duplicate checks, transactional prospect-to-client conversion with source linkage and audit history, and organisation-scoped contact-point capture. Contact points are unverified by default; email addresses are normalised, and the AI context receives contact-channel verification counts without receiving the stored contact addresses. Product registry supports product registration. Sales & Outreach stores eligible drafts and supports owner/admin-initiated email delivery through the guarded Resend adapter; WhatsApp first-contact sending is not enabled. Approval decisions are restricted to owners and administrators. Finance totals use a database aggregate function rather than summing only the visible transaction page. The dashboard requires migrations 003, 004 and 005 before the latest CRM and AI Manager features can load. The AI General Manager uses a single organisation-wide conversation and receives a bounded, read-only snapshot of recent prospects, clients, projects, approvals, outreach events, financial aggregates, recent AI runs and audit events, alongside approved company memory, current conversation and source-linked live research when configured. Snapshot records are organisation-scoped and timestamped; the assistant must distinguish loaded recent records from all-time totals and cannot claim access to activity outside connected systems.

## Deployment boundary
Vercel deployment and production environment configuration are intentionally deferred until the application code and verification pass are complete. At deployment time, add server-side provider keys and `SUPABASE_SERVICE_ROLE_KEY` as protected Vercel environment variables. Only the Supabase URL and anon/public key may be exposed to the browser.

## Dashboard interaction tests
- Install dependencies with `npm install`.
- Build the production app with `npm run build`.
- Install the Playwright Chromium browser with `npx playwright install chromium`.
- Run dashboard browser tests with `npm run test:e2e`.
- The automated suite covers primary navigation and workspace gating, AI Manager controls, secure sign-in/sign-out, mocked authenticated workspace access, CRM and finance workflows, shared AI conversation history, controlled action execution, sales drafts, email-send UI behaviour and Resend adapter idempotency/error handling.
- Authenticated browser tests use a mocked Supabase sign-in and mocked workspace API. They verify front-end request/response behavior, not live database persistence, real provider API calls, external message delivery or production deployment.


## Controlled AI action engine
- The AI action API accepts only a fixed whitelist of structured actions: create prospect, update prospect status, create project, update project status, and create an approval request.
- Proposals are stored separately from operational records with organisation scope, requester, idempotency key, 24-hour expiry, status and execution outcome.
- The model can only propose a fixed, validated action after an explicit user instruction. Low-risk internal records may auto-execute for owners/admins; manager proposals remain in the review queue. The system does not auto-send outreach or make external commercial commitments.
- Approval calls a database transaction that rechecks the approver's organisation role, locks the pending request, validates organisation ownership of linked records, performs the whitelisted operation, and writes an audit event. External messaging, payments, contracts, final pricing and deletions are not executable actions.
- The Approvals screen includes an AI-assisted prospect proposal form and a queue for reviewing and executing action requests.
- The automated browser suite tests owner auto-execution of an explicit low-risk prospect action and the manager/owner review queue. Browser tests mock the API; they do not prove live PostgreSQL transaction behaviour.
- Apply migration 007 after migrations 001–006. It has not been applied to a live database.


## Task management
- Organisation-scoped tasks support priorities, due dates, statuses and optional links to same-organisation projects, clients and prospects.
- Task creation validates linked records server-side; status changes are audited.
- Apply migration 008 after migrations 001–007. It has not been applied to a live database.


## Outreach draft safety
- The Sales & Outreach screen can save outbound drafts only; it never sends messages.
- Draft creation requires an organisation-owned, verified contact point with a recorded consent basis.
- The server checks suppression records, recent contact frequency and recent inbound conversations before saving a draft.
- Drafts are excluded from the contact-frequency calculation because they have not been sent. Actual delivery remains disabled pending official provider configuration, approval workflow and channel-specific compliance.


Contact-point verification is a recorded manual attestation by an owner or administrator, not an automated mailbox or telephone verification. The audit event stores the operator's verification note and method. Do not describe a contact as independently verified unless an external verification process was actually completed.


## AI-to-approval handoff
- The three-model synthesis may emit one structured proposal only when the user explicitly requests a supported company operation and the required details are present.
- The server strips the marker from the visible answer, validates the proposal against strict Zod schemas, links it to the originating AI run, and saves it as `pending_approval`.
- A malformed, ambiguous or unsupported proposal is discarded with a warning. The AI cannot approve or execute its own proposal.
- An owner or administrator must approve the request; the database transaction then rechecks role and organisation scope before executing the whitelisted operation.
- The current safe whitelist does not include outbound delivery, payments, contracts, final pricing, deletions or other irreversible actions.
- Migrations 007 and 008 include explicit least-privilege grants for new public tables. This is required on current Supabase projects where new tables are not automatically exposed through the Data API.


Migration 009 explicitly grants the server-only `service_role` access to the existing public-schema tables, sequences and functions created by migrations 001–008, and establishes matching defaults for future migrations. It grants no `anon` access and does not weaken RLS for authenticated users. Keep the service-role key exclusively on the server.
