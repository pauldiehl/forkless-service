/**
 * Claude tool definitions for the Forkless agent.
 * Each tool returns action objects that the chat handler interprets.
 */

/**
 * Tool definitions in Anthropic tool schema format.
 */
export const TOOLS = [
  {
    name: 'show_board',
    description: 'Show the Driftboard planning layer. Use this when the user asks about board status, pipeline, or work items.',
    input_schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['full_board', 'highlights', 'minimized'],
          description: 'Display mode for the board',
        },
        filter_stage: {
          type: 'string',
          enum: ['intake', 'qualified', 'grooming', 'building', 'validate', 'done'],
          description: 'If mode is highlights, filter to this stage',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'focus_card',
    description: 'Focus on a specific board card, expanding it for the user to see details.',
    input_schema: {
      type: 'object',
      properties: {
        card_id: {
          type: 'number',
          description: 'The ID of the card to focus on',
        },
      },
      required: ['card_id'],
    },
  },
  {
    name: 'create_board_card',
    description: 'Create a new card on the Driftboard. Use when the user requests something that should be tracked as a work item.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title for the card (one line)',
        },
        description: {
          type: 'string',
          description: 'Detailed description (markdown supported)',
        },
        stage: {
          type: 'string',
          enum: ['intake', 'qualified', 'grooming', 'building'],
          description: 'Initial stage (defaults to intake)',
        },
        background: {
          type: 'string',
          enum: ['default', 'urgent', 'active', 'info', 'journey'],
          description: 'Card color/priority indicator',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'generate_artifact',
    description: 'Generate a long-form artifact (document, analysis, plan). Use for content >5 lines that should be rendered as a separate page.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Artifact title',
        },
        content_html: {
          type: 'string',
          description: 'Full HTML content of the artifact',
        },
        artifact_type: {
          type: 'string',
          enum: ['document', 'analysis', 'plan', 'report', 'proposal'],
          description: 'Type of artifact',
        },
      },
      required: ['title', 'content_html'],
    },
  },
  {
    name: 'set_display_mode',
    description: 'Change the display mode of the three-layer UI. Use to minimize/maximize board or switch chat panel size.',
    input_schema: {
      type: 'object',
      properties: {
        board_mode: {
          type: 'string',
          enum: ['full_board', 'focused_card', 'highlights', 'minimized'],
          description: 'Board overlay mode',
        },
        agent_mode: {
          type: 'string',
          enum: ['collapsed', 'minimal', 'full'],
          description: 'Agent chat panel mode',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_tenant',
    description: 'Create a new Forkless tenant after collecting ALL required info from the user. Do NOT call until you have confirmed every field with the user.',
    input_schema: {
      type: 'object',
      properties: {
        tenant_id: {
          type: 'string',
          description: 'URL-safe slug (e.g. "acme-corp")',
        },
        name: {
          type: 'string',
          description: 'Display name',
        },
        description: {
          type: 'string',
          description: '1-2 sentence description of what the agent should help with',
        },
        admin_emails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Admin email addresses',
        },
        website: {
          type: 'string',
          description: 'Primary website URL (used for CORS + knowledge source)',
        },
        knowledge_urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs to learn from (docs, GitHub repos, guides)',
        },
        tone: {
          type: 'string',
          description: 'Agent tone/personality (e.g. "Friendly, professional")',
        },
        accent_color: {
          type: 'string',
          description: 'Hex brand color (default #e8735a)',
        },
        greeting: {
          type: 'string',
          description: 'Agent greeting message (what the agent says first)',
        },
      },
      required: ['tenant_id', 'name', 'description', 'admin_emails', 'website', 'knowledge_urls'],
    },
  },
];

/**
 * Execute a tool call. Returns an action object for the chat handler.
 */
export async function executeTool(name, input, context = {}) {
  const { board, tenantId } = context;

  switch (name) {
    case 'show_board': {
      const columns = board ? board.getColumns() : {};
      return {
        action: 'show_board',
        mode: input.mode,
        filter_stage: input.filter_stage || null,
        columns,
        result: `Board displayed in ${input.mode} mode`,
      };
    }

    case 'focus_card': {
      const card = board ? board.getCard(input.card_id) : null;
      const comments = board ? board.getComments(input.card_id) : [];
      return {
        action: 'focus_card',
        card_id: input.card_id,
        card,
        comments,
        result: card ? `Focused on card #${input.card_id}: ${card.title}` : `Card #${input.card_id} not found`,
      };
    }

    case 'create_board_card': {
      if (!board) return { error: 'Board not available' };
      const card = await board.addCard({
        title: input.title,
        description: input.description || '',
        stage: input.stage || 'intake',
        background: input.background || 'default',
      });
      return {
        action: 'card_created',
        card,
        result: `Created card #${card.id}: ${card.title}`,
      };
    }

    case 'generate_artifact': {
      const { putItem } = await import('./dynamo.mjs');
      const { randomUUID } = await import('node:crypto');
      const artifactId = randomUUID();
      await putItem('artifacts', {
        tenant_id: tenantId,
        artifact_id: artifactId,
        title: input.title,
        content_html: input.content_html,
        artifact_type: input.artifact_type || 'document',
        created_at: new Date().toISOString(),
      });
      return {
        action: 'artifact_created',
        artifact_id: artifactId,
        title: input.title,
        url: `/artifacts/${artifactId}`,
        result: `Artifact created: ${input.title}`,
      };
    }

    case 'set_display_mode': {
      return {
        action: 'set_display_mode',
        board_mode: input.board_mode || null,
        agent_mode: input.agent_mode || null,
        result: 'Display mode updated',
      };
    }

    case 'create_tenant': {
      const { getTenant } = await import('./tenant.mjs');
      const { putItem } = await import('./dynamo.mjs');

      // 1. Validate — check tenant_id doesn't already exist
      const existing = await getTenant(input.tenant_id);
      if (existing) {
        return { error: `Tenant "${input.tenant_id}" already exists. Choose a different slug.` };
      }

      // 2. Parse admin emails — handle "Name <email>" format
      const adminEmails = input.admin_emails.map(e => {
        const match = e.match(/<([^>]+)>/);
        return (match ? match[1] : e).trim().toLowerCase();
      });

      // 3. Save tenant record immediately (status: provisioning)
      const apiBase = process.env.API_BASE || 'https://api.agentintake.io';
      const allUrls = [input.website, ...input.knowledge_urls];
      const knowledgeSources = allUrls.map(url => ({
        url,
        name: url.split('/').filter(Boolean).pop() || 'Document',
      }));
      const newTenant = {
        tenant_id: input.tenant_id,
        name: input.name,
        description: input.description,
        tone: input.tone || 'Friendly and helpful',
        admin_users: adminEmails,
        greeting: input.greeting || `Hi! I'm the ${input.name} assistant. How can I help?`,
        theme: 'dark',
        accent_color: input.accent_color || '#e8735a',
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system_prompt: '',
        status: 'provisioning',
        knowledge_sources: knowledgeSources,
        allowed_origins: [input.website, 'http://localhost:3000'],
        created_at: new Date().toISOString(),
      };
      await putItem('tenants', newTenant);

      // 4. Fire async Lambda to build knowledge in background
      const intakeArn = process.env.INTAKE_WORKER_ARN;
      if (intakeArn) {
        try {
          const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
          const lambda = new LambdaClient({});
          await lambda.send(new InvokeCommand({
            FunctionName: intakeArn,
            InvocationType: 'Event', // fire-and-forget
            Payload: JSON.stringify({
              tenant_id: input.tenant_id,
              name: input.name,
              website: input.website,
              knowledge_urls: input.knowledge_urls,
            }),
          }));
        } catch (err) {
          console.error('Failed to invoke intake worker:', err.message);
          // Tenant still works — just without deep knowledge
        }
      }

      // 5. Return embed snippet immediately
      const snippet = `<script src="${apiBase}/widget.js" data-api="${apiBase}" data-tenant="${input.tenant_id}"></script>`;
      return {
        action: 'tenant_created',
        tenant_id: input.tenant_id,
        result: `Tenant "${input.name}" created!\n\nEmbed snippet — paste on any page:\n\`\`\`html\n${snippet}\n\`\`\`\n\nYour agent is live now. Knowledge is building in the background (1-2 minutes) — the agent will get smarter as it learns your site. Admin emails: ${adminEmails.join(', ')}`,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
