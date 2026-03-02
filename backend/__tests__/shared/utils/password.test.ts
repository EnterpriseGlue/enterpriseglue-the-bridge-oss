import { describe, expect, it } from 'vitest';
import { generatePassword, hashPassword, validatePassword, verifyPassword } from '@enterpriseglue/shared/utils/password.js';

describe('password utils', () => {
  it('validates password complexity', () => {
    const result = validatePassword('short');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must be at least 8 characters long');

    const ok = validatePassword('StrongPass1!');
    expect(ok.valid).toBe(true);
    expect(ok.errors).toHaveLength(0);
  });

  it('generates a readable, complex password', () => {
    const value = generatePassword();
    expect(value).toMatch(/^[A-Za-z]+-[A-Za-z]+-\d{3}-[!@#$%^&*_+=]$/);
    const validation = validatePassword(value);
    expect(validation.valid).toBe(true);
  });

  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('StrongPass1!');
    expect(hash).not.toBe('StrongPass1!');
    await expect(verifyPassword('StrongPass1!', hash)).resolves.toBe(true);
    await expect(verifyPassword('WrongPass1!', hash)).resolves.toBe(false);
  });
});
