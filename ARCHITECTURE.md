# Forkless Service — Architecture

## Overview

Multi-tenant serverless wrapper around the Forkless pattern library. A business drops a `<script>` tag on their site and gets a three-layer AI stack: Agent (chat), Planning (Driftboard kanban), Transaction (artifacts).

**Domain:** `api.agentintake.io`

## Stack

- **Runtime:** Node.js 20.x, ESM
- **Infrastructure:** AWS SAM — Lambda + API Gateway + DynamoDB + SES + S3
- **AI:** Claude via Anthropic SDK (through forkless/lib/agent/)
- **Auth:** JWT (HMAC-SHA256, no deps) + OTP via SES
- **UI:** Vanilla JS widget (iframe chat + DOM board overlay)
- **Pattern Library:** `forkless/lib/` (CommonJS, loaded via `createRequire`)

## Architecture Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Single Router Lambda | Proven pattern from aip-registry. One cold start, simpler IAM. | 2026-03-19 |
| Copy-adapt auth from aip-registry | Lambda needs co-located files. Cross-project imports don't work in SAM packaging. | 2026-03-19 |
| ESM + createRequire for forkless lib | Service is ESM (.mjs). Forkless lib is CJS. createRequire bridges them. | 2026-03-19 |
| Full board state persist/load | Lambda invocations are short-lived. Load full state, mutate, persist diff. | 2026-03-19 |
| iframe chat + DOM board | Chat iframe avoids CSS conflicts. Board overlay is transparent over host site. | 2026-03-19 |
| PAY_PER_REQUEST DynamoDB | No traffic predictions for v1. Scale to zero when unused. | 2026-03-19 |

## DynamoDB Tables

| Table | PK | SK | GSI | Purpose |
|-------|----|----|-----|---------|
| tenants | tenant_id | — | — | Tenant config, system prompt, settings |
| conversations | tenant_id | conversation_id | — | Message history per conversation |
| board-items | tenant_id | item_id | stage-index (tenant_id + stage) | Driftboard cards |
| board-comments | tenant_id | comment_id | — | Card comments |
| board-decisions | tenant_id | decision_id | — | Decision audit log |
| journey-states | tenant_id | journey_id | — | User journey state machines |
| scheduler-events | tenant_id | event_id | fire-at-index (tenant_id + fire_at) | Scheduled callbacks |
| faq-cache | tenant_id | question_hash | — | Crystallized FAQ answers |
| users | tenant_id | email | — | User records |
| otp | tenant_id | email | — | OTP codes (TTL enabled) |
| artifacts | tenant_id | artifact_id | — | Pre-rendered HTML artifacts |
| connections | connection_id | — | — | WebSocket connections (TTL enabled) |

## Feature Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 0 | Project scaffold (SAM, router, tables) | COMPLETE |
| 1A | Foundation libs (dynamo, auth, ses, tenant) | COMPLETE |
| 1B | Auth handlers (send-otp, verify-otp, logout) | COMPLETE |
| 1C | Chat handler (conversation, FAQ, tools, prompts) | COMPLETE |
| 1D | Phase 1 tests (44/44 pass) | COMPLETE |
| 2A | Board (DynamoDB adapter + handler) | COMPLETE |
| 2B | Artifacts, journey, scheduler, admin | COMPLETE |
| 2C | WebSocket handlers | COMPLETE |
| 2D | Phase 2 tests (15/15 pass) | COMPLETE |
| 3A | Widget (chat iframe + board overlay) | COMPLETE |
| 3B | Seed scripts + local e2e | COMPLETE |
| 4 | Deploy + DNS + go live | READY |

## Source Map

```
forkless-service/
  src/
    router.mjs              — Single Lambda entry point
    handlers/
      auth/
        send-otp.mjs        — OTP email dispatch
        verify-otp.mjs      — OTP verification + JWT
        logout.mjs           — Session teardown
      chat.mjs               — Main chat engine
      board.mjs              — Board API (GET/POST)
      artifacts.mjs          — Artifact serving
      scheduler.mjs          — EventBridge handler
      admin.mjs              — Admin API
      ws-connect.mjs         — WebSocket $connect
      ws-disconnect.mjs      — WebSocket $disconnect
      ws-message.mjs         — WebSocket $default
    lib/
      dynamo.mjs             — DynamoDB adapter (from aip-registry)
      auth.mjs               — JWT + OTP (from aip-registry, tenant-scoped)
      ses.mjs                — Email (from aip-registry, rebranded)
      tenant.mjs             — Tenant config loader + cache
      conversation-store.mjs — Conversation CRUD
      faq.mjs                — FAQ cache + crystallization
      tools.mjs              — Claude tool definitions
      dynamo-board.mjs       — Board DynamoDB adapter
      dynamo-artifacts.mjs   — Artifacts DynamoDB adapter
      dynamo-journey.mjs     — Journey DynamoDB adapter
      dynamo-scheduler.mjs   — Scheduler DynamoDB adapter
      ws-push.mjs            — WebSocket broadcast
    prompts/
      system.mjs             — System prompt builder (wraps forkless lib)
  widget/
    widget.js                — Three-layer UI injector
    chat-ui.html             — iframe chat UI
  scripts/
    seed-tenant.mjs          — Create paul-brand tenant
    build-tenant-prompt.mjs  — Build system prompt from GitHub repos
    seed-board.mjs           — Seed board cards
    seed-faqs.mjs            — Seed FAQ cache
  test/
    lib/                     — Unit tests for libs
    handlers/                — Handler tests
    integration/             — Integration tests
  template.yaml              — SAM template
  ARCHITECTURE.md            — This file
```
