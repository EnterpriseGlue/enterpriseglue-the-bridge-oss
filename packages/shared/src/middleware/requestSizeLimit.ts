import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const CONFIG_BUNDLE_JSON_LIMIT_BYTES = 1024 * 1024;
export const IDENTITY_ADMIN_JSON_LIMIT_BYTES = 256 * 1024;
export const ENGINE_REGISTRATION_JSON_LIMIT_BYTES = 256 * 1024;

function parsedBodySize(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (Buffer.isBuffer(body)) return body.byteLength;
  if (typeof body === 'string') return Buffer.byteLength(body);
  return Buffer.byteLength(JSON.stringify(body));
}

export function enforceParsedPayloadLimit(maxBytes: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const declaredLength = Number(req.headers['content-length']);
    const actualLength = parsedBodySize(req.body);
    if ((Number.isFinite(declaredLength) && declaredLength > maxBytes) || actualLength > maxBytes) {
      return res.status(413).json({
        error: 'Request payload exceeds the allowed size',
        code: 'PAYLOAD_TOO_LARGE',
        maxBytes,
      });
    }
    next();
  };
}

export const configBundleJsonPayloadLimit = enforceParsedPayloadLimit(CONFIG_BUNDLE_JSON_LIMIT_BYTES);
export const identityAdminJsonPayloadLimit = enforceParsedPayloadLimit(IDENTITY_ADMIN_JSON_LIMIT_BYTES);
export const engineRegistrationJsonPayloadLimit = enforceParsedPayloadLimit(ENGINE_REGISTRATION_JSON_LIMIT_BYTES);
