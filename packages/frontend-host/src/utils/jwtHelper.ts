/**
 * JWT Helper Utilities
 * Functions to decode and validate JWT tokens
 */

export interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  exp: number;
  iat: number;
}

/**
 * Decode a JWT token
 * Returns the payload without verification (client-side only)
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

/**
 * Check if a JWT token is expired
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJWT(token);
  if (!payload || !payload.exp) {
    return true;
  }

  // exp is in seconds, Date.now() is in milliseconds
  const expiryTime = payload.exp * 1000;
  return Date.now() >= expiryTime;
}

/**
 * Check if a token should be refreshed (within 5 minutes of expiry)
 */
export function shouldRefreshToken(token: string): boolean {
  const payload = decodeJWT(token);
  if (!payload || !payload.exp) {
    return true;
  }

  // Refresh if less than 5 minutes until expiry
  const expiryTime = payload.exp * 1000;
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
  
  return fiveMinutesFromNow >= expiryTime;
}

/**
 * Get time remaining until token expires (in milliseconds)
 */
export function getTimeUntilExpiry(token: string): number {
  const payload = decodeJWT(token);
  if (!payload || !payload.exp) {
    return 0;
  }

  const expiryTime = payload.exp * 1000;
  const remaining = expiryTime - Date.now();
  
  return Math.max(0, remaining);
}
