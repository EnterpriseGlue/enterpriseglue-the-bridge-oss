import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';

/**
 * Password utility functions
 * Handles hashing, verification, and generation
 */

const SALT_ROUNDS = 10;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password meets complexity requirements
 * - Min 8 characters
 * - At least 1 lowercase letter
 * - At least 1 uppercase letter
 * - At least 1 number
 * - At least 1 symbol from: !@#$%^&*_+=
 */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*_+=]/.test(password)) {
    errors.push('Password must contain at least one symbol (!@#$%^&*_+=)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a secure random password
 * Format: Word-Word-Number-Symbol (e.g., Blue-Tiger-789-!)
 * Easy to read, meets all complexity requirements
 */
export function generatePassword(): string {
  const words = [
    'Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Gray',
    'Tiger', 'Lion', 'Eagle', 'Bear', 'Wolf', 'Hawk', 'Fox', 'Owl',
    'River', 'Ocean', 'Mountain', 'Valley', 'Forest', 'Desert', 'Lake', 'Storm',
    'Star', 'Moon', 'Sun', 'Cloud', 'Wind', 'Rain', 'Snow', 'Fire',
  ];

  const symbols = ['!', '@', '#', '$', '%', '^', '&', '*', '_', '+', '='];

  // Pick two random words
  const word1 = words[randomInt(0, words.length)];
  const word2 = words[randomInt(0, words.length)];

  // Generate random 3-digit number
  const number = randomInt(100, 1000);

  // Pick random symbol
  const symbol = symbols[randomInt(0, symbols.length)];

  return `${word1}-${word2}-${number}-${symbol}`;
}
