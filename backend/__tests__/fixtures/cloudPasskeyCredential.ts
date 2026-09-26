/** Deliberately non-cryptographic input; protocol verification is mocked in route tests. */
export const mockCloudPasskeyCredential = {
  id: 'registered-credential',
  rawId: 'registered-credential',
  type: 'public-key' as const,
  response: {},
  clientExtensionResults: {},
};
