/** Keep the browser credential boundary replaceable in UI tests without
 * pretending that mocked credentials prove device or provider compatibility. */
export { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
