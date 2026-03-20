// Single Lambda router — maps API Gateway events to handler modules
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const WIDGET_BUCKET = process.env.WIDGET_BUCKET || '';
const s3 = new S3Client({});

const routes = {
  'POST /chat':              () => import('./handlers/chat.mjs'),
  'GET /chat/status':        () => import('./handlers/chat-status.mjs'),
  'POST /auth/send-otp':     () => import('./handlers/auth/send-otp.mjs'),
  'POST /auth/verify-otp':   () => import('./handlers/auth/verify-otp.mjs'),
  'POST /auth/logout':       () => import('./handlers/auth/logout.mjs'),
  'GET /board':              () => import('./handlers/board.mjs'),
  'GET /board/':             () => import('./handlers/board.mjs'),
  'POST /board/comment':     () => import('./handlers/board.mjs'),
  'GET /artifacts/':         () => import('./handlers/artifacts.mjs'),
  'GET /faqs/':              () => import('./handlers/faqs.mjs'),
  'GET /admin/':                  () => import('./handlers/admin.mjs'),
  'POST /admin/config':           () => import('./handlers/admin.mjs'),
  'POST /admin/refresh-knowledge': () => import('./handlers/admin.mjs'),
};

// Static files served via S3 redirect
const staticFiles = {
  '/widget.js': 'widget.js',
};

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.requestContext?.http?.path || event.path || '/';

  // Strip stage prefix (e.g., /prod/chat → /chat)
  const path = rawPath.replace(/^\/(?:dev|prod)/, '') || '/';
  const routeKey = `${method} ${path}`;

  // Handle CORS preflight (backup — API Gateway should handle this too)
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // Static files from S3 (served directly to preserve origin)
  if (staticFiles[path] && WIDGET_BUCKET) {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: WIDGET_BUCKET, Key: staticFiles[path] }));
      const body = await obj.Body.transformToString();
      const contentType = path.endsWith('.js') ? 'application/javascript' : 'text/html';
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300' },
        body,
      };
    } catch (err) {
      console.error('S3 fetch error:', err);
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: 'File not found' }) };
    }
  }

  // Try exact match first
  let loader = routes[routeKey];

  // Try prefix match for parameterized routes
  if (!loader) {
    for (const [pattern, fn] of Object.entries(routes)) {
      const [pMethod, pPath] = pattern.split(' ');
      if (pMethod === method && pPath.endsWith('/') && path.startsWith(pPath)) {
        const param = path.slice(pPath.length);
        if (param) {
          event.pathParameters = event.pathParameters || {};
          if (pPath.includes('board')) event.pathParameters.itemId = param;
          else if (pPath.includes('artifacts')) event.pathParameters.id = param;
          else if (pPath.includes('faqs')) event.pathParameters.tenantId = param;
          else if (pPath.includes('admin')) event.pathParameters.tenantId = param;
          loader = fn;
          break;
        }
      }
    }
  }

  if (!loader) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Not found', path, method }),
    };
  }

  try {
    // Normalize path in event so handlers see stripped path
    if (event.requestContext?.http) event.requestContext.http.path = path;
    if (event.path) event.path = path;

    const mod = await loader();
    const response = await mod.handler(event);
    // Ensure CORS headers on all responses
    response.headers = { ...corsHeaders(), ...response.headers };
    return response;
  } catch (err) {
    console.error('Handler error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
