import { z } from 'zod';

export const CloudEmailSignupRequestSchema = z.object({
  email: z.email().max(320),
  intent: z.enum(['cloud', 'documentation']).optional(),
  turnstileToken: z.string().min(1).max(2048).optional(),
}).strict();

export const CloudEmailSignupChallengeSchema = z.object({
  siteKey: z.string().min(1).max(255).nullable(),
}).strict();
