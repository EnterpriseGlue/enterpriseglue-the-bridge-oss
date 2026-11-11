import { z } from 'zod';

const base = {
  schemaName: z.literal('cloud-organization-notification'),
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  accountId: z.string().min(1).max(250).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  email: z.email().max(320),
  name: z.string().trim().min(1).max(160),
  slug: z.string().regex(/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/),
};
export const CloudOrganizationNotificationSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.enum(['review_requested', 'received', 'approved', 'ready']) }).strict(),
  z.object({ ...base, kind: z.literal('rejected'), reason: z.string().trim().min(1).max(500) }).strict(),
]);
export type CloudOrganizationNotification = z.infer<typeof CloudOrganizationNotificationSchema>;
