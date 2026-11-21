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
