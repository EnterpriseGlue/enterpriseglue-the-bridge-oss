export const gitCredentialFixture = {
  id: 'credential-1', userId: 'user-1', providerId: 'github', providerName: 'GitHub', providerType: 'github',
  name: 'Work', authType: 'pat' as 'pat' | 'oauth', providerUsername: 'fixture-user', createdAt: 1, updatedAt: 2,
};
export const gitProviderFixture = { id: 'github', name: 'GitHub', type: 'github', baseUrl: 'https://github.com', apiUrl: 'https://api.github.com', supportsPAT: true, supportsOAuth: true };
export const gitOAuthStateFixture = 'a'.repeat(64);
