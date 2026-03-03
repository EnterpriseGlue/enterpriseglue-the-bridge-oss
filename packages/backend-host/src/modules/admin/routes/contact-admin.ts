import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { sendContactAdminEmail } from '@enterpriseglue/shared/services/email/contact.js';

const contactAdminSchema = z.object({
  userEmail: z.string().email('Invalid email format'),
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().optional().default(''),
});

const router = Router();

/**
 * POST /api/contact-admin
 * Send contact admin email from login page
 * Public endpoint (no authentication required)
 */
router.post('/', apiLimiter, validateBody(contactAdminSchema), asyncHandler(async (req: Request, res: Response) => {
  const { userEmail, subject, message } = req.body;

  // Send email
  const result = await sendContactAdminEmail({
    userEmail,
    subject,
    message: message || ''
  });

  if (!result.success) {
    throw Errors.internal('Failed to send email');
  }

  res.json({ 
    success: true,
    message: 'Your message has been sent to the administrator' 
  });
}));

export default router;
