import { startCustomerSidecarReference } from './customer-sidecar-reference.mjs';

const engineBaseUrl = process.env.EG_CUSTOMER_SIDECAR_ENGINE_URL;
if (!engineBaseUrl) throw new Error('EG_CUSTOMER_SIDECAR_ENGINE_URL is required');

const port = Number(process.env.PORT || 8080);
const sidecar = await startCustomerSidecarReference(engineBaseUrl, {
  upstreamAuthorization: process.env.EG_CUSTOMER_SIDECAR_UPSTREAM_AUTHORIZATION || null,
  listenHost: '0.0.0.0',
  listenPort: Number.isSafeInteger(port) && port > 0 && port <= 65_535 ? port : 8080,
});
console.log(`Customer-sidecar reference listening on ${sidecar.baseUrl}`);

async function stop() {
  await sidecar.close();
  process.exit(0);
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
