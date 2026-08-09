export interface IdentifierSlugOptions {
  preserve?: string;
  maxLength?: number;
  fallback?: string;
}

function isAsciiLetterOrDigit(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

/**
 * Builds stable identifier slugs in one bounded pass. Keeping this logic out of
 * regular expressions avoids polynomial backtracking on attacker-controlled
 * names while retaining the existing lowercase and separator behaviour.
 */
export function slugifyIdentifier(value: string, options: IdentifierSlugOptions = {}): string {
  const preserve = new Set(options.preserve || '');
  const maxLength = options.maxLength ?? Number.MAX_SAFE_INTEGER;
  const fallback = options.fallback ?? '';
  let result = '';
  let separatorPending = false;

  for (const character of value.trim().toLowerCase()) {
    if (isAsciiLetterOrDigit(character) || preserve.has(character)) {
      if (character === '-' && !result) continue;
      if (separatorPending && result && result.length < maxLength) result += '-';
      separatorPending = false;
      if (result.length < maxLength) result += character;
      if (result.length >= maxLength) break;
    } else {
      separatorPending = Boolean(result);
    }
  }

  let end = result.length;
  while (end > 0 && result[end - 1] === '-') end -= 1;
  if (end !== result.length) result = result.slice(0, end);
  return result || fallback;
}
