import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

test('documentation sign-in is an account-only journey on desktop and mobile @documentation-account', async ({ page }, testInfo) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (request.method() === 'POST') writes.push(path);
    const body = path === '/api/tenancy/capabilities' ? { mode: 'pooled', rootTenantAliasesEnabled: false, tenantScopedLoginRequired: true, databaseIsolation: 'postgres-rls', customDomainsEnabled: true, organizationDiscoveryEnabled: true, signedPlacementAssertionsEnabled: true }
      : path === '/api/plugins/v1/frontend' ? { apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1', revision: 1, issues: [], plugins: [] }
      : path === '/api/auth/cloud-signup/providers' ? [{ id: 'google', displayName: 'Google', protocol: 'oidc' }]
      : {};
    await route.fulfill({ status: ['/api/auth/me', '/api/auth/refresh'].includes(path) ? 401 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/documentation/access?state=${'s'.repeat(43)}&challenge=${'c'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'Documentation access' }), errors.join('\n')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText(/No Cloud organization or workspace is required/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create an organization' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Create free account' }).focus();
  await expect(page.getByRole('link', { name: 'Create free account' })).toBeFocused();
  // Capture canonical visual evidence once; exercise the journey in every browser.
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: testInfo.outputPath('documentation-account-desktop-1440x900.png') });
  await page.getByRole('link', { name: 'Create free account' }).click();
  await expect(page).toHaveURL(/\/signup\?intent=documentation$/);
  await expect(page.getByRole('heading', { name: 'Create your EnterpriseGlue account' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue with email' }).click();
  await expect(page).toHaveURL(/\/signup\/email\?intent=documentation$/);
  expect(writes.some((path) => path.startsWith('/api/platform/cloud'))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('textbox', { name: 'Email address' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: testInfo.outputPath('documentation-account-mobile.png') });
});

test('documentation profile edits the shared account without organization onboarding @documentation-account', async ({ page }, testInfo) => {
  const writes: string[] = []; let fail = true;
  const user = { id: 'reader', email: 'reader@example.test', firstName: 'Alex', lastName: 'Reader', isActive: true, isEmailVerified: true, mustResetPassword: false, createdAt: Date.now(), session: { principal: { type: 'user', id: 'reader' }, tenant: { id: null } } };
  await page.route('**/api/**', async route => {
    const request=route.request();const path=new URL(request.url()).pathname;
    if(!path.startsWith('/api/'))return route.continue();
    if(!['GET','HEAD'].includes(request.method()))writes.push(path);
    if(path==='/api/auth/me'&&request.method()==='PATCH'){
      if(fail)return route.fulfill({status:503,json:{error:'Unavailable'}});
      Object.assign(user,request.postDataJSON());
    }
    const body=path==='/api/auth/me'?user
      :path==='/api/auth/documentation/configuration'?{documentationOrigin:'https://docs.example.test'}
      :path==='/api/tenancy/capabilities'?{mode:'pooled',rootTenantAliasesEnabled:false,tenantScopedLoginRequired:true,databaseIsolation:'postgres-rls',customDomainsEnabled:true,organizationDiscoveryEnabled:true,signedPlacementAssertionsEnabled:true}
      :path==='/api/plugins/v1/frontend'?{apiVersion:'frontend-bootstrap.plugin.enterpriseglue.io/v1',revision:1,issues:[],plugins:[]}:{};
    await route.fulfill({status:200,json:body});
  });
  await page.goto('/documentation/access?view=account');
  await expect(page.getByRole('heading',{name:'Your EnterpriseGlue account'})).toBeVisible();
  await expect(page.getByText(user.email,{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'First name',exact:true}).fill('Taylor');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByText('Your profile could not be saved. Please try again.',{exact:true})).toBeVisible();
  fail=false;await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Your profile has been updated.');
  await page.reload();await expect(page.getByRole('textbox',{name:'First name',exact:true})).toHaveValue('Taylor');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:width===1440?900:844});
    await expect(page.getByRole('link',{name:'Back to documentation'})).toHaveAttribute('href','https://docs.example.test');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const evidence=process.env.DOCUMENTATION_ACCOUNT_EVIDENCE_DIR;
    if(evidence&&testInfo.project.name==='chromium'&&width!==320){
      await mkdir(evidence,{recursive:true});
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:join(evidence,`shared-account-${width}x${width===1440?900:844}.png`)});
    }
  }
  expect(writes).toEqual(['/api/auth/me','/api/auth/me']);
  await expect(page.getByRole('button',{name:'Create an organization'})).toHaveCount(0);
});

test('account sign-in preserves the profile destination and a new handoff overrides it @documentation-account',async({page})=>{
  let authenticated=false;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(!path.startsWith('/api/'))return route.continue();
    if(['/api/auth/me','/api/auth/refresh'].includes(path)&&!authenticated)return route.fulfill({status:401,json:{error:'Sign in'}});
    const body=path==='/api/auth/me'?{id:'reader',email:'reader@example.test',firstName:'Alex',lastName:'Reader',isEmailVerified:true,session:{principal:{type:'user',id:'reader'},tenant:{id:null}}}
      :path==='/api/auth/documentation/configuration'?{documentationOrigin:'https://docs.example.test'}
      :path==='/api/auth/cloud-signup/providers'?[]
      :path==='/api/tenancy/capabilities'?{mode:'pooled',rootTenantAliasesEnabled:false,tenantScopedLoginRequired:true,databaseIsolation:'postgres-rls',customDomainsEnabled:true,organizationDiscoveryEnabled:true,signedPlacementAssertionsEnabled:true}
      :path==='/api/plugins/v1/frontend'?{apiVersion:'frontend-bootstrap.plugin.enterpriseglue.io/v1',revision:1,issues:[],plugins:[]}:{};
    await route.fulfill({status:200,json:body});
  });
  await page.goto('/documentation/access?view=account');
  await page.getByRole('link',{name:'Sign in with a passkey'}).click();
  await expect(page).toHaveURL(/signup\/email\/signin\?intent=documentation$/);
  authenticated=true;await page.goto('/documentation/access');
  await expect(page.getByRole('heading',{name:'Your EnterpriseGlue account'})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'First name',exact:true})).toHaveValue('Alex');
  // A fresh documentation handoff takes precedence over an abandoned account view.
  await page.evaluate(()=>sessionStorage.setItem('enterpriseglue.documentation.account-view','true'));
  await page.goto(`/documentation/access?state=${'s'.repeat(43)}&challenge=${'c'.repeat(43)}`);
  await expect(page.getByRole('heading',{name:'Documentation access',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continue to documentation',exact:true})).toBeVisible();
});
