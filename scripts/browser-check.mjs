import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// All credentials are ephemeral test inputs. No trace, HAR or screenshots are saved.
export async function verifyBrowser({ baseURL, apiBase, accounts, secureCookies = false }) {
  const origin = new URL(baseURL);
  const apiOrigin = new URL(apiBase);
  assert(['localhost', '127.0.0.1'].includes(origin.hostname) && ['localhost', '127.0.0.1'].includes(apiOrigin.hostname), 'Only loopback test applications may be used');
  let browser;
  let phase = 'launch Chromium';
  try {
    browser = await chromium.launch({ headless: true });
    for (const account of accounts) {
      const context = await browser.newContext();
      await context.route('**/*', route => {
        const target = new URL(route.request().url());
        return target.origin === origin.origin ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      phase = 'unauthenticated redirect';
      await page.goto(`${baseURL}/observation`);
      await page.waitForURL('**/login');
      phase = 'frontend login';
      await page.locator('#email').fill(account.email);
      await page.locator('#password').fill(account.password);
      await page.locator('#btn-login').click();
      await page.waitForURL('**/dashboard');
      assert((await page.locator('aside').innerText()).includes(account.email), 'Wrong signed-in company user');
      phase = 'HttpOnly session';
      const cookies = await context.cookies(baseURL);
      const access = cookies.find(c => c.name === 'access_token');
      const refresh = cookies.find(c => c.name === 'refresh_token');
      assert(access && refresh && access.httpOnly && refresh.httpOnly, 'Session cookies must be HttpOnly');
      assert(access.secure === secureCookies && refresh.secure === secureCookies, 'Wrong secure-cookie setting');
      assert(!/access_token|refresh_token/.test(await page.evaluate(() => document.cookie)), 'Client script can read a session cookie');
      phase = 'observation report and tenant isolation';
      await page.getByRole('link', { name: 'Relatório de observação', exact: true }).click();
      await page.waitForURL('**/observation');
      await page.getByRole('heading', { name: 'O que os dados permitem afirmar', exact: true }).waitFor();
      const reportText = await page.locator('article').innerText();
      assert(reportText.includes('Indisponível') && reportText.includes('Última sincronização'), 'Report must disclose missing financial data and freshness');
      if (account.sourceName) {
        assert(reportText.includes(account.sourceName) && reportText.includes('SIMULAÇÃO LOCAL'), 'Synthetic provenance missing');
        assert(!reportText.includes(account.foreignSourceName), 'Foreign company source visible in report');
      } else {
        assert(reportText.includes('Nenhuma fonte disponível'), 'Empty installation must disclose missing sources');
      }
      phase = 'browser session renewal';
      await context.addCookies([{ ...access, expires: 1 }]);
      await page.goto(`${baseURL}/observation`);
      await page.getByRole('heading', { name: 'O que os dados permitem afirmar', exact: true }).waitFor();
      const renewed = await context.cookies(baseURL);
      const renewedAccess = renewed.find(c => c.name === 'access_token');
      const renewedRefresh = renewed.find(c => c.name === 'refresh_token');
      assert(renewedAccess && renewedRefresh && renewedRefresh.value !== refresh.value, 'Browser must rotate the refresh token');
      phase = 'frontend logout and revocation';
      await page.getByRole('button', { name: /Sair/ }).click();
      await page.waitForURL('**/login');
      const revoked = await fetch(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${renewedAccess.value}` }, signal: AbortSignal.timeout(5000) });
      assert(revoked.status === 401, 'Logout must revoke the server session');
      await context.close();
    }
    console.log(`PASS: Chromium frontend login, private report, HttpOnly cookies, refresh and logout for ${accounts.length} isolated test company/companies.`);
  } catch {
    // Playwright errors can include filled form values; do not print them.
    throw new Error(`Browser verification failed at: ${phase}. No credentials or browser contents were logged.`);
  } finally {
    await browser?.close();
  }
}
