import { z } from 'zod';

export const CloudMicrosoftEmailRequestSchema = z.object({ email: z.email().max(320) }).strict();
export const CloudMicrosoftEmailDestinationSchema = z.enum(['/cloud/onboarding', '/login', '/documentation/access']);
export const CloudMicrosoftEmailCompleteSchema = z.object({ destination: CloudMicrosoftEmailDestinationSchema }).strict();
