# Forkless Service — Build Handoff

**Location:** `aip/forkless-service/`
**Domain:** `api.agentintake.io`
**Purpose:** Multi-tenant, serverless Forkless — any website gets the full three-layer stack (Agent + Planning + Transaction) via a JS snippet.
**Pattern library:** `forkless/lib/` (the code this service wraps)

---

## What This Is

Forkless Service is the **serverless, multi-tenant deployment** of the Forkless pattern library. A business drops a `<script>` tag on their site and gets:

1. **Agent Layer** — conversational chat overlay (Forkless)
2. **Planning Layer** — transparent Driftboard card overlay
3. **Transaction Layer** — readonly artifacts, one-click fulfillment

No server to manage, no code to deploy. The first customer is Paul's brand (pauldiehl.github.io).

### Forkless Core vs. Forkless Service

| | Forkless Core (lib/) | Forkless Service |
|---|---|---|
| **Runtime** | Express process, DIAB node | Lambda functions |
| **Database** | SQLite (local file) | DynamoDB (serverless) |
| **Tenancy** | Single-tenant per node | Multi-tenant, isolated by `tenant_id` |
| **Deploy** | Part of DIAB node | SAM template, independent |
| **Auth** | Per-node identity | Email OTP + JWT (from aip-registry) |
| **Client** | Direct integration | JS widget overlay |
| **Domain** | Per-dream | api.agentintake.io |
| **Planning Layer** | forkless/lib/planning/ (in-memory) | DynamoDB-backed board state |

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Client Website (e.g. pauldiehl.github.io)       │
│                                                    │
│  <script src="https://api.agentintake.io/         │
│          widget.js?tenant=paul-brand">             │
│  </script>                                         │
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │  THREE-LAYER OVERLAY (injected)          │     │
│  │                                          │     │
│  │  ┌──── Agent Layer ──────────────────┐   │     │
│  │  │  Chat bubble → expandable panel   │   │     │
│  │  └──────────────────────────────────-┘   │     │
│  │  ┌──── Planning Layer ───────────────┐   │     │
│  │  │  Transparent card overlay         │   │     │
│  │  │  6-column board (when shown)      │   │     │
│  │  └──────────────────────────────────-┘   │     │
│  │  ┌──── Transaction Layer ────────────┐   │     │
│  │  │  Readonly artifact viewer         │   │     │
│  │  │  One-click fulfillment actions    │   │     │
│  │  └──────────────────────────────────-┘   │     │
│  └──────────────────────────────────────────┘     │
└─────────────────────│─────────────────────────────┘
                      │ HTTPS + WebSocket
                      ▼
┌──────────────────────────────────────────────────┐
│  api.agentintake.io                               │
│  (API Gateway + Custom Domain + ACM cert)         │
│                                                    │
│  Routes:                                           │
│  POST /chat            → chat-handler Lambda       │
│  POST /auth/send-otp   → auth-handler Lambda       │
│  POST /auth/verify-otp → auth-handler Lambda       │
│  POST /auth/logout     → auth-handler Lambda       │
│  GET  /widget.js       → S3 (static asset)         │
│  GET  /artifacts/:id   → artifact-handler Lambda    │
│  GET  /board           → board-handler Lambda       │
│  POST /board/comment   → board-handler Lambda       │
│  GET  /admin/:tid      → admin-handler Lambda       │
│  POST /admin/config    → admin-handler Lambda       │
│  WS   /ws              → WebSocket API (board +     │
│                           agent real-time events)   │
└────────────────────│──────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────┐
│  DynamoDB Tables                                  │
│                                                    │
│  tenants           │ tenant config, products       │
│  conversations     │ per-tenant, per-session msgs  │
│  journey_states    │ JM state machine rows         │
│  board_items       │ Driftboard cards + stages     │
│  board_comments    │ Comment-as-interface entries   │
│  board_decisions   │ Coordinator decision log       │
│  scheduler_events  │ future-dated actions           │
│  artifacts         │ generated readonly pages       │
│  aip-otp           │ OTP codes (TTL auto-delete)   │
│  aip-users         │ user sessions + JWT tracking   │
│  faq_cache         │ crystallized Q&A pairs         │
└──────────────────────────────────────────────────┘
```

---

## Auth — Use aip-registry (Don't Rebuild)

The auth layer already exists in `aip/aip-registry/src/lib/`. Import it directly. Do not write new auth code.

### What exists (in aip-registry)

| File | What It Does |
|------|-------------|
| `src/lib/auth.mjs` | `generateOtp()`, `storeOtp()`, `verifyOtp()`, `createJwt()`, `verifyJwt()`, `createSession()`, `authenticateRequest()` |
| `src/lib/ses.mjs` | `sendOtpEmail()` — SES in prod, console.log in dev. Styled HTML email with 36px monospace code. |
| `src/lib/db.mjs` | `getItem()`, `putItem()`, `updateItem()` — DynamoDB or local JSON. |
| `src/handlers/auth/send-otp.mjs` | POST handler: validate email → generate OTP → store → send via SES |
| `src/handlers/auth/verify-otp.mjs` | POST handler: verify code → create session → set httpOnly cookie → return JWT |
| `src/handlers/auth/logout.mjs` | POST handler: null sessionId → clear cookie |

### Auth flow (already implemented)

1. User enters email → POST `/auth/send-otp` → 6-digit code via SES
2. User enters code → POST `/auth/verify-otp` → JWT in httpOnly cookie (24hr, SameSite=Strict)
3. All subsequent requests carry the cookie → `authenticateRequest()` extracts user
4. Logout → POST `/auth/logout` → session invalidated, cookie cleared

### Integration approach

```javascript
// forkless-service/src/handlers/auth.mjs
// Just re-export the aip-registry handlers with tenant_id awareness

import { generateOtp, storeOtp, verifyOtp, createSession, authenticateRequest } from '../../aip-registry/src/lib/auth.mjs';
import { sendOtpEmail } from '../../aip-registry/src/lib/ses.mjs';

// Add tenant_id scoping to the existing patterns:
// - OTP table key: { email, tenant_id } instead of just { email }
// - JWT payload includes: { email, sessionId, tenant_id, trustLevel }
// - Session lookup scoped to tenant
```

### What forkless-service adds on top

- **tenant_id scoping** — OTP and sessions are per-tenant
- **trustLevel in JWT** — `viewer | registered | trusted | founder` (from the trust gradient)
- **Trust tier tracking** — contribution history determines trust level over time

### Environment variables (same as aip-registry)

```
JWT_SECRET=your-secret-key
SES_FROM_EMAIL=auth@agentintake.io
AWS_REGION=us-east-1
AIP_STORAGE=dynamodb
TABLE_PREFIX=forkless
```

---

## DynamoDB Schema

### `tenants` table

```
PK: tenant_id (string)    — e.g. "paul-brand"

{
  tenant_id: "paul-brand",
  display_name: "Paul Diehl",
  domain: "pauldiehl.github.io",
  products: [
    {
      product_id: "web4-intro",
      display_name: "Web 4.0 Explorer",
      description: "Learn about Web 4.0 and the trust economy",
      journey_type: "presentation",
      config: { /* journey block params */ }
    }
  ],
  admin_users: ["apollo.d.paradise@gmail.com"],
  settings: {
    widget_theme: "dark",
    accent_color: "#e8735a",
    position: "bottom-right",
    greeting: "Hey — I'm Paul's agent. Ask me anything about Web 4.0, or explore what I'm building.",
    board_default_mode: "minimized"
  },
  system_prompt: "...",
  created_at: "2026-03-18T00:00:00Z"
}
```

### `conversations` table

```
PK: tenant_id (string)
SK: conversation_id (string)  — ULID for sortability

{
  tenant_id: "paul-brand",
  conversation_id: "01JFXYZ...",
  session_token: "jwt-token-hash",
  product_id: "web4-intro",
  messages: [
    { role: "assistant", content: "...", timestamp: "..." },
    { role: "user", content: "...", timestamp: "..." }
  ],
  journey_state_id: "...",
  user_email: null,
  created_at: "...",
  updated_at: "..."
}
```

### `board_items` table (Planning Layer)

```
PK: tenant_id (string)
SK: item_id (number)

{
  tenant_id: "paul-brand",
  item_id: 1247,
  title: "Apple Pay checkout flow",
  description: "Add Apple Pay as payment option in checkout block",
  stage: "building",
  background: "active",
  merit_score: 0.87,
  assigned_to: "builder-1",
  artifact_url: null,
  parent_id: null,
  project_id: "default",
  created_at: "...",
  stage_entered_at: "..."
}

GSI: stage-index
  PK: tenant_id, SK: stage
  → column queries: "get all items in BUILDING for paul-brand"
```

### `board_comments` table

```
PK: item_id (number)
SK: created_at (string)

{
  item_id: 1247,
  author: "user@example.com",
  body: "Tested this and it looks good",
  intent: "validation",
  trust_tier: "contributor",
  created_at: "..."
}
```

### `board_decisions` table

```
PK: item_id (number)
SK: created_at (string)

{
  item_id: 1247,
  from_stage: "qualified",
  to_stage: "building",
  reason: "Merit score 0.87 exceeds threshold. No dependencies. Dispatched.",
  decided_by: "coordinator",
  created_at: "..."
}
```

### `journey_states` table

```
PK: tenant_id (string)
SK: journey_id (string)

{
  tenant_id: "paul-brand",
  journey_id: "01JFXYZ...",
  journey_type: "presentation",
  current_stage: "viewing",
  conversation_id: "01JFXYZ...",
  data: { /* accumulated intake data */ },
  created_at: "...",
  updated_at: "..."
}
```

### `scheduler_events` table

```
PK: tenant_id (string)
SK: event_id (string)

GSI: fire_at_index
  PK: status ("pending"), SK: fire_at (ISO timestamp)

{
  tenant_id: "paul-brand",
  event_id: "evt_01JF...",
  event_type: "followup_nudge",
  fire_at: "2026-03-19T09:00:00Z",
  status: "pending",
  callback: {
    action: "send_message",
    conversation_id: "01JFXYZ...",
    message: "Hey — did you get a chance to check out the 48 Laws of Trust?"
  },
  created_at: "..."
}
```

### `faq_cache` table

```
PK: tenant_id (string)
SK: question_hash (string)  — SHA256 of normalized question

{
  tenant_id: "paul-brand",
  question_hash: "a1b2c3...",
  question_normalized: "what is web 4.0",
  answer: "Web 4.0 is a post-platform architecture where...",
  hit_count: 47,
  confidence: 0.96,
  source: "agentic",
  created_at: "...",
  last_hit_at: "..."
}
```

---

## Lambda Functions

### 1. `chat-handler`

The main conversation engine. Wraps `forkless/lib/agent/`.

```
POST /chat
Body: { tenant_id, conversation_id?, message, session_token? }
Response: { conversation_id, response, board_update?, artifacts?, journey_state? }
```

**Flow:**
1. Validate tenant exists
2. Check FAQ cache — if hit (confidence > 0.95), return cached answer (zero LLM cost)
3. Load conversation history (or create new)
4. Load tenant config + system prompt
5. Call `createConversation()` from forkless/lib/agent/ with tenant config
6. Parse response for: journey triggers, artifact generation, board card updates, display mode changes
7. If board update → push via WebSocket to connected clients
8. Update conversation, return response with any board/artifact changes

**FAQ Crystallization:** After responding, hash the normalized question. If a similar question has been answered 3+ times with consistent answers, promote to FAQ cache. Next time → zero LLM cost.

### 2. `auth-handler`

Wraps aip-registry auth with tenant scoping.

```
POST /auth/send-otp     — email + tenant_id → 6-digit code via SES
POST /auth/verify-otp   — email + code + tenant_id → JWT cookie (24hr)
POST /auth/logout        — clear session + cookie
```

See "Auth — Use aip-registry" section above. This handler adds `tenant_id` to the existing pattern.

### 3. `board-handler`

The Planning Layer API. Wraps `forkless/lib/planning/`.

```
GET  /board?tenant_id=X              → full board state (all columns)
GET  /board/:item_id                 → single card + comments + decisions
POST /board/comment                  → add comment (triggers coordinator eval)
```

**Board state** is served as columns grouped by stage. The widget renders them.

**Comment flow:** When a comment is posted, the coordinator evaluates intent:
- `validation` → check trust tier, possibly advance to DONE
- `grooming` → add context, possibly split card
- `unblock` → check trust tier, possibly resume stalled item
- `general` → record, no action

The coordinator is the same `createCoordinator()` from `forkless/lib/planning/coordinator.js`, but backed by DynamoDB instead of in-memory.

Only the **coordinator agent** and **founder** can move cards between stages. Regular users comment. This is enforced at the API level.

### 4. `artifact-handler`

Serves readonly artifacts.

```
GET /artifacts/:artifact_id → HTML page (self-contained, styled)
```

Pre-rendered HTML stored in DynamoDB. No server-side rendering at request time.

### 5. `admin-handler`

Tenant admin — but NOT a separate dashboard. Admin is the same three-layer stack with admin-context cards.

```
GET  /admin/:tenant_id        → admin context (requires admin JWT)
POST /admin/config             → update tenant settings
GET  /admin/:tenant_id/convos  → conversation list
GET  /admin/:tenant_id/faqs    → FAQ cache management
```

The admin "dashboard" is Planning Layer cards floating over the product:
- Conversations needing response → soft red cards
- Journeys pending review → soft blue cards
- Scheduler events → soft yellow cards
- FAQ cache stats → info cards

No separate admin page. Admin opens the same product URL. The agent detects admin auth and loads admin context. The board shows work queue cards.

### 6. `scheduler-handler`

Runs on a 5-minute EventBridge trigger (not API Gateway).

```
EventBridge Rule → scheduler-handler Lambda (every 5 min)
```

1. Query GSI: `status = "pending" AND fire_at <= now()`
2. For each event, evaluate callback
3. Execute action (send message, create artifact, chain next event)
4. Mark event as "completed"

---

## The Planning Layer (Driftboard) — What's Already Built

The Planning Layer architecture is **implemented as working code** in `forkless/lib/planning/`. This service wraps it with DynamoDB persistence and WebSocket delivery.

### What exists in forkless/lib/planning/

| Module | What It Does |
|--------|-------------|
| `cards.js` | Card model. Validates stages (intake→qualified→grooming→building→validate→done→rejected), backgrounds (default/urgent/active/done/info/journey), transition rules. |
| `board.js` | Board state. Columns, card CRUD, comments, decision log. Pluggable storage (in-memory default, DynamoDB for service). |
| `coordinator.js` | Triage pipeline. Merit scoring (alignment 0.3, feasibility 0.25, nonConflict 0.2, novelty 0.15, specificity 0.1). Governance checks. Full lifecycle: triage → qualify → groom → dispatch → validate → complete. Comment intent parsing. |
| `display-modes.js` | Five modes: full_board, focused_card, highlights, minimized, play_mode. Agent-driven switching based on conversation context. |

### What this service adds

- **DynamoDB storage adapter** for board.js (replaces in-memory default)
- **WebSocket push** for board events (card_added, card_moved, comment_added)
- **Tenant scoping** — each tenant gets its own board namespace
- **Trust tier tracking** in DynamoDB (contribution history → automatic tier promotion)
- **Bottleneck detection** — when a column has 5+ items, push alert to connected clients

### The six stages

```
INTAKE → QUALIFIED → GROOMING → BUILDING → VALIDATE → DONE
```

| Stage | Who Moves Items Here | What Happens |
|-------|---------------------|--------------|
| INTAKE | Anyone (crowd, founder, agent) | Raw idea. Just a title + description. |
| QUALIFIED | Coordinator agent | Passes merit threshold (≥0.6). Score visible on card. |
| GROOMING | Coordinator agent | Breaking down, refining, scoping. May split into children. |
| BUILDING | Coordinator agent (dispatch) | Subagent or builder actively working. |
| VALIDATE | Coordinator agent | Needs human eyes. Testing, review, approval. |
| DONE | Coordinator agent | Shipped. Artifact is live. |

Backward movement allowed: VALIDATE→GROOMING, BUILDING→GROOMING, QUALIFIED→INTAKE.

### Card formatting

Cards are **read-only** with one escape hatch — the link.

- **Markdown body** — bold, italic, headers, code blocks
- **Color backgrounds** — default (cream), urgent (red), active (blue), done (green), info (yellow), journey (purple)
- **Links** — the ONLY interactive element. Markdown `[text](url)` renders as clickable.
- **Dismiss X** — top-left. Always present. Removes from view, not from board state.
- **NO** buttons, dropdowns, forms, checkboxes, inline editing, drag handles

### Comment-as-interface

Users don't edit cards. They comment. The coordinator parses intent and acts. Comment patterns:
- Grooming: "I think we should split this into two parts..."
- Validation: "Tested this, looks good" / "LGTM"
- Unblocking: "I set up the config for this — here's the link"
- Priority: (founder only) "Move this to BUILDING, blocking the demo"

### Display modes

| Mode | What You See | When |
|------|-------------|------|
| Full Board | All columns, all cards | Desktop. Builder/founder reviewing state. |
| Focused Card | Single card expanded. Product visible beneath. | Demoing a feature. Mobile. |
| Highlights | Only cards matching a filter | Admin checking their queue. Customer journey steps. |
| Minimized | Cards hidden. Small status badge. | Customer in conversation mode. |
| Play Mode | Auto-cycling through cards | Stream narration. Demo walkthroughs. |

The agent controls mode switching: "Show me the board" → Full Board. "What's item #1247?" → Focused Card. "Just chatting" → Minimized.

---

## Widget JS

Served from S3 via API Gateway. The three-layer UI injector.

```html
<script src="https://api.agentintake.io/widget.js?tenant=paul-brand"></script>
```

The widget code exists in `forkless/widget/widget.js`. For the service, it's built and uploaded to S3.

**What it does:**
1. Creates Agent Layer — floating chat bubble (bottom-right) → expandable conversation panel
2. Creates Planning Layer — transparent board overlay (hidden by default, agent controls visibility)
3. Connects WebSocket for real-time board events and agent messages
4. Respects tenant theme settings (colors, greeting, position, default board mode)
5. Auth flow: agent prompts for email when needed → OTP → JWT cookie → session persists

**Key decisions:**
- Widget is an **iframe** for the chat panel — avoids CSS conflicts with host site
- Board overlay is **DOM injection** with high z-index — needs to be transparent over the host
- Chat state persists via cookie (JWT) + conversation_id in localStorage
- Mobile-responsive: full-screen chat on small viewports, focused card mode for board

---

## WebSocket Events

Real-time pushes via API Gateway v2 WebSocket API.

```json
// Board events
{ "channel": "board", "type": "card_added",   "card": { ... } }
{ "channel": "board", "type": "card_moved",   "cardId": 1247, "from": "qualified", "to": "building", "reason": "..." }
{ "channel": "board", "type": "comment_added", "cardId": 1247, "comment": { ... } }
{ "channel": "board", "type": "bottleneck",   "stage": "validate", "count": 8 }

// Agent events
{ "channel": "agent", "type": "agent_message", "text": "..." }
{ "channel": "agent", "type": "display_mode",  "mode": "focused_card", "cardId": 1247 }

// System events
{ "channel": "system", "type": "connected", "clientId": "ws-1" }
```

Clients subscribe to channels on connect. Board events trigger card re-renders. Agent events update the chat panel and can switch display modes.

---

## Training From Public Repos

### Phase 1: Static System Prompt (Day 1)

At tenant onboarding, a script crawls public repos and builds a system prompt:

```javascript
// scripts/build-tenant-prompt.js
async function buildPrompt(tenantId, repos) {
  const content = {};
  for (const repo of repos) {
    const readme = await fetchGitHub(`${repo}/README.md`);
    const docs = await fetchGitHub(`${repo}/docs/`);
    content[repo] = {
      readme: summarize(readme),          // LLM-summarized to ~500 tokens
      docs: docs.map(d => summarize(d))   // Each doc → ~200 token summary
    };
  }
  // Store on tenant record
  await dynamodb.update({
    TableName: 'forkless-tenants',
    Key: { tenant_id: tenantId },
    UpdateExpression: 'SET system_prompt = :p',
    ExpressionAttributeValues: { ':p': buildPromptString(tenant, content) }
  });
}

// For Paul's brand:
buildPrompt('paul-brand', [
  'pauldiehl/sovereign-streams',
  'pauldiehl/dream-in-a-box',
  'pauldiehl/forkless',
  'pauldiehl/protocol-explorer',
  'go-go-pump/milliprime-coop',
  'go-go-pump/1kh',
  'go-go-pump/god-mode'
]);
```

### Phase 2: FAQ Crystallization (Ongoing)

After 3+ consistent answers to similar questions → promote to cache → zero LLM cost next time. The Strangler Pattern: agentic (expensive) → deterministic (free).

### Phase 3: Vector Intelligence (When DIAB Intelligence Layer Ships)

Replace static prompt with semantic retrieval. DynamoDB + vector search or a small Pinecone instance. But Phase 1 is enough to ship.

---

## SAM Template Skeleton

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Forkless Service — multi-tenant three-layer conversational overlay

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 30
    MemorySize: 256
    Environment:
      Variables:
        CLAUDE_API_KEY: !Ref ClaudeApiKey
        JWT_SECRET: !Ref JwtSecret
        SES_FROM_EMAIL: auth@agentintake.io
        TENANTS_TABLE: !Ref TenantsTable
        CONVERSATIONS_TABLE: !Ref ConversationsTable
        JOURNEY_STATES_TABLE: !Ref JourneyStatesTable
        BOARD_ITEMS_TABLE: !Ref BoardItemsTable
        BOARD_COMMENTS_TABLE: !Ref BoardCommentsTable
        SCHEDULER_TABLE: !Ref SchedulerEventsTable
        FAQ_CACHE_TABLE: !Ref FaqCacheTable

Parameters:
  ClaudeApiKey:
    Type: String
    NoEcho: true
  JwtSecret:
    Type: String
    NoEcho: true
  CustomDomainName:
    Type: String
    Default: api.agentintake.io
  CertificateArn:
    Type: String
    Description: ACM certificate ARN for api.agentintake.io

Resources:

  # ── API Gateway ──
  ForklessApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: prod
      CorsConfiguration:
        AllowOrigins: ["*"]
        AllowMethods: [POST, GET, OPTIONS]
        AllowHeaders: [Content-Type, Authorization]
      Domain:
        DomainName: !Ref CustomDomainName
        CertificateArn: !Ref CertificateArn

  # ── Lambda Functions ──
  ChatHandler:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/chat.handler
      Events:
        Chat:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /chat
            Method: POST

  AuthHandler:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/auth.handler
      Events:
        SendOtp:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /auth/send-otp
            Method: POST
        VerifyOtp:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /auth/verify-otp
            Method: POST
        Logout:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /auth/logout
            Method: POST

  BoardHandler:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/board.handler
      Events:
        GetBoard:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /board
            Method: GET
        GetItem:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /board/{itemId}
            Method: GET
        AddComment:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /board/comment
            Method: POST

  ArtifactHandler:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/artifacts.handler
      Events:
        GetArtifact:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /artifacts/{artifactId}
            Method: GET

  AdminHandler:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/admin.handler
      Events:
        Dashboard:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /admin/{tenantId}
            Method: GET
        UpdateConfig:
          Type: HttpApi
          Properties:
            ApiId: !Ref ForklessApi
            Path: /admin/config
            Method: POST

  SchedulerHandler:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/scheduler.handler
      Events:
        SchedulerTick:
          Type: Schedule
          Properties:
            Schedule: rate(5 minutes)

  # ── DynamoDB Tables ──
  TenantsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: forkless-tenants
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: tenant_id
          AttributeType: S
      KeySchema:
        - AttributeName: tenant_id
          KeyType: HASH

  ConversationsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: forkless-conversations
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: tenant_id
          AttributeType: S
        - AttributeName: conversation_id
          AttributeType: S
      KeySchema:
        - AttributeName: tenant_id
          KeyType: HASH
        - AttributeName: conversation_id
          KeyType: RANGE

  BoardItemsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: forkless-board-items
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: tenant_id
          AttributeType: S
        - AttributeName: item_id
          AttributeType: N
        - AttributeName: stage
          AttributeType: S
      KeySchema:
        - AttributeName: tenant_id
          KeyType: HASH
        - AttributeName: item_id
          KeyType: RANGE
      GlobalSecondaryIndexes:
        - IndexName: stage-index
          KeySchema:
            - AttributeName: tenant_id
              KeyType: HASH
            - AttributeName: stage
              KeyType: RANGE
          Projection:
            ProjectionType: ALL

  BoardCommentsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: forkless-board-comments
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: item_id
          AttributeType: N
        - AttributeName: created_at
          AttributeType: S
      KeySchema:
        - AttributeName: item_id
          KeyType: HASH
        - AttributeName: created_at
          KeyType: RANGE

  JourneyStatesTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: forkless-journey-states
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: tenant_id
          AttributeType: S
        - AttributeName: journey_id
          AttributeType: S
      KeySchema:
        - AttributeName: tenant_id
          KeyType: HASH
        - AttributeName: journey_id
          KeyType: RANGE

  SchedulerEventsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: forkless-scheduler-events
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: tenant_id
          AttributeType: S
        - AttributeName: event_id
          AttributeType: S
        - AttributeName: status
          AttributeType: S
        - AttributeName: fire_at
          AttributeType: S
      KeySchema:
        - AttributeName: tenant_id
          KeyType: HASH
        - AttributeName: event_id
          KeyType: RANGE
      GlobalSecondaryIndexes:
        - IndexName: fire-at-index
          KeySchema:
            - AttributeName: status
              KeyType: HASH
            - AttributeName: fire_at
              KeyType: RANGE
          Projection:
            ProjectionType: ALL

  FaqCacheTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: forkless-faq-cache
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: tenant_id
          AttributeType: S
        - AttributeName: question_hash
          AttributeType: S
      KeySchema:
        - AttributeName: tenant_id
          KeyType: HASH
        - AttributeName: question_hash
          KeyType: RANGE

Outputs:
  ApiUrl:
    Value: !Sub "https://${CustomDomainName}"
  WidgetUrl:
    Value: !Sub "https://${CustomDomainName}/widget.js"
```

---

## Custom Domain Setup (api.agentintake.io)

1. **ACM Certificate** (must be in `us-east-1` for API Gateway):
   ```bash
   aws acm request-certificate \
     --domain-name api.agentintake.io \
     --validation-method DNS \
     --region us-east-1
   ```

2. **DNS Validation:** Add the CNAME record ACM gives you to your agentintake.io DNS

3. **SAM Deploy:**
   ```bash
   sam deploy \
     --parameter-overrides \
       ClaudeApiKey=sk-ant-... \
       JwtSecret=your-secret \
       CertificateArn=arn:aws:acm:us-east-1:...:certificate/... \
       CustomDomainName=api.agentintake.io
   ```

4. **DNS CNAME:** Point `api.agentintake.io` to the API Gateway domain name output

5. **Test:**
   ```bash
   curl https://api.agentintake.io/chat \
     -H "Content-Type: application/json" \
     -d '{"tenant_id": "paul-brand", "message": "What is Web 4.0?"}'
   ```

---

## Onboarding a New Tenant

### Step 1: Create tenant config
Write tenant record to DynamoDB with: `tenant_id`, `display_name`, `domain`, `products`, `admin_users`, `settings`.

### Step 2: Build the system prompt
Run `scripts/build-tenant-prompt.js` against tenant's public repos. Summarizes READMEs and docs into a ~8K token system prompt.

### Step 3: Deploy widget
Add to target site:
```html
<script src="https://api.agentintake.io/widget.js?tenant=paul-brand"></script>
```

### Step 4: Seed FAQ cache (optional)
Pre-populate common Q&A pairs to reduce initial LLM costs.

---

## File Structure

```
aip/forkless-service/
├── HANDOFF.md              ← this file (THE handoff)
├── template.yaml           ← SAM template
├── src/
│   ├── handlers/
│   │   ├── chat.js         ← conversation engine (wraps forkless/lib/agent/)
│   │   ├── auth.js         ← email OTP + JWT (wraps aip-registry auth)
│   │   ├── board.js        ← planning layer API (wraps forkless/lib/planning/)
│   │   ├── artifacts.js    ← readonly page server
│   │   ├── admin.js        ← tenant admin (planning layer with admin cards)
│   │   └── scheduler.js    ← 5-min EventBridge handler
│   ├── lib/
│   │   ├── dynamo.js       ← DynamoDB helpers
│   │   ├── dynamo-board.js ← DynamoDB storage adapter for board.js
│   │   ├── faq.js          ← FAQ cache + crystallization
│   │   └── tenant.js       ← tenant config loader
│   └── prompts/
│       └── system.js       ← system prompt builder (wraps forkless/lib/agent/prompts.js)
├── widget/
│   ├── widget.js           ← three-layer UI injector (built from forkless/widget/)
│   └── chat-ui.html        ← iframe chat interface
├── scripts/
│   ├── build-tenant-prompt.js  ← repo crawler + prompt builder
│   ├── seed-tenant.js          ← create tenant record
│   └── seed-faqs.js            ← pre-populate FAQ cache
└── package.json
```

---

## Build Phases

### Phase 1 — Foundation (Days 1-3)
- [ ] SAM template + `sam init`
- [ ] DynamoDB tables (tenants, conversations)
- [ ] Chat handler Lambda (load tenant config → call Claude via forkless/lib/agent → return response)
- [ ] Widget JS (three-layer overlay — agent panel + board placeholder + artifact viewer)
- [ ] Deploy to `api.agentintake.io`

### Phase 2 — Auth + Planning Layer (Days 4-6)
- [ ] Auth handler (wrap aip-registry OTP + JWT, add tenant scoping)
- [ ] Board handler (wrap forkless/lib/planning with DynamoDB adapter)
- [ ] WebSocket API for real-time board events
- [ ] Widget connects to board — renders cards in transparent overlay
- [ ] Comment-as-interface flow: user comments → coordinator evaluates → card moves

### Phase 3 — Journeys + Scheduler + Admin (Days 7-9)
- [ ] Journey states table + transition logic (wrap forkless/lib/core/journey-machine)
- [ ] Artifact handler (readonly page rendering)
- [ ] FAQ cache table + crystallization logic in chat handler
- [ ] Admin handler (planning layer cards for admin work queue)
- [ ] Scheduler handler (EventBridge 5-min trigger)

### Phase 4 — Brand Onboarding (Day 10)
- [ ] `build-tenant-prompt.js` script
- [ ] Onboard paul-brand tenant (system prompt from public repos)
- [ ] Add widget to pauldiehl.github.io
- [ ] Test full flow: greeting → conversation → board card appears → journey → artifact → FAQ crystallizes

---

## What NOT to Build

- **No new auth code.** Use aip-registry's OTP/JWT. Just add tenant scoping.
- **No user accounts.** OTP only. Session = JWT in cookie.
- **No database migrations.** DynamoDB is schemaless.
- **No frontend framework.** Vanilla JS widget. No React, no build step.
- **No Cognito.** Email OTP is already built.
- **No separate admin dashboard.** Admin = same three layers with admin-context cards.
- **No drag and drop on the board.** Agent moves cards. Users comment.
- **No rate limiting in v1.** DynamoDB on-demand handles burst.
- **No separate Driftboard repo/deploy.** The planning layer is `forkless/lib/planning/`, served through this service.

---

## Supersedes

This document replaces:
- `driftboard/DRIFTBOARD-V2-HANDOFF.md` — Planning Layer architecture is now in `forkless/lib/planning/` (working code) and documented in this handoff. The driftboard handoff has been deprecated.

The `forkless/` repo README documents the pattern library itself. This handoff documents the **service** that wraps it.

---

## Success Criteria

1. **Widget loads on pauldiehl.github.io** — three-layer overlay appears
2. **Agent knows Paul's work** — can discuss Web 4.0, DIAB, Forkless, repos
3. **Board renders cards** — planning layer overlay shows pipeline state
4. **Cards move via agent** — coordinator triages, qualifies, dispatches
5. **Comments drive the board** — user comments parsed for intent, cards respond
6. **FAQ crystallization works** — repeat questions get cached, LLM cost drops
7. **OTP auth works** — email → code → JWT → session persists (aip-registry pattern)
8. **Admin sees work queue** — same product, admin cards floating over it
9. **WebSocket pushes** — board changes appear in real-time, no refresh
10. **Total AWS cost < $5/month** at low traffic (DynamoDB on-demand + Lambda free tier)
