/**
 * Example auth strategy — beyond the built-ins (cookie / token / custom / storageState). INERT until
 * selected: qa.config `auth: { strategy: 'example' }`. Implement for YOUR TEST env; return values that
 * authenticate as `role`. Prove it: node --test .qa/app-qa/strategies/
 *   - apiHeaders(role)           → headers that authenticate an API request
 *   - browserAuth(context, role) → seed the Playwright context so the app treats it as logged-in `role`
 */
export async function apiHeaders(role = 'user') {
  // Whatever your API expects. In a TEST env this is typically a signed test token or a static header.
  return { authorization: `Bearer test-token-${role}` };
}

export async function browserAuth(context, role = 'user') {
  // Seed cookies / localStorage so the app is logged in as `role`. `context` is a Playwright BrowserContext.
  const url = process.env.QA_BASE_URL || 'http://localhost:3000';
  await context.addCookies([{ name: 'qa_session', value: `test-${role}`, url }]);
}
