/**
 * POST /auth/logout
 * Nullifies session and clears cookie.
 */

import { authenticateRequest, success, withCookie } from '../../lib/auth.mjs';
import { updateItem } from '../../lib/dynamo.mjs';

export async function handler(event) {
  const user = authenticateRequest(event);

  if (user && user.tenant_id && user.email) {
    // Nullify the session in DB
    await updateItem('users', { tenant_id: user.tenant_id, email: user.email }, {
      jwt_session_id: null,
      last_logout: new Date().toISOString(),
    });
  }

  const response = success({ loggedOut: true });
  return withCookie(response, 'forkless_token', '', { maxAge: 0 });
}
