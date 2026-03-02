import { describe, it, expect, vi, type Mock } from 'vitest';
import { escapeHtml, renderBracesTemplate, getActiveTemplateByType } from '@enterpriseglue/shared/services/email/utils.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailTemplate } from '@enterpriseglue/shared/db/entities/EmailTemplate.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('email utils', () => {
  describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escapeHtml('Test & <div>')).toBe('Test &amp; &lt;div&gt;');
      expect(escapeHtml("It's a 'test'")).toBe('It&#39;s a &#39;test&#39;');
    });

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('renderBracesTemplate', () => {
    it('replaces template variables', () => {
      const template = 'Hello {{name}}, your email is {{email}}';
      const result = renderBracesTemplate(template, { name: 'John', email: 'john@example.com' });
      expect(result).toBe('Hello John, your email is john@example.com');
    });

    it('handles missing variables', () => {
      const template = 'Hello {{name}}, {{missing}}';
      const result = renderBracesTemplate(template, { name: 'John' });
      expect(result).toBe('Hello John, {{missing}}');
    });

    it('handles whitespace in braces', () => {
      const template = 'Value: {{ key }}';
      const result = renderBracesTemplate(template, { key: 'test' });
      expect(result).toBe('Value: test');
    });
  });

  describe('getActiveTemplateByType', () => {
    it('retrieves active template', async () => {
      const templateRepo = {
        findOneBy: vi.fn().mockResolvedValue({
          type: 'verification',
          subject: 'Verify Email',
          htmlTemplate: '<p>Test</p>',
          textTemplate: 'Test',
          isActive: true,
        }),
      };

      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === EmailTemplate) return templateRepo;
          throw new Error('Unexpected repository');
        },
      });

      const result = await getActiveTemplateByType('verification');
      expect(result).toEqual({
        subject: 'Verify Email',
        htmlTemplate: '<p>Test</p>',
        textTemplate: 'Test',
      });
    });

    it('returns null for inactive template', async () => {
      const templateRepo = {
        findOneBy: vi.fn().mockResolvedValue({
          type: 'verification',
          isActive: false,
        }),
      };

      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === EmailTemplate) return templateRepo;
          throw new Error('Unexpected repository');
        },
      });

      const result = await getActiveTemplateByType('verification');
      expect(result).toBeNull();
    });

    it('returns null for non-existent template', async () => {
      const templateRepo = {
        findOneBy: vi.fn().mockResolvedValue(null),
      };

      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === EmailTemplate) return templateRepo;
          throw new Error('Unexpected repository');
        },
      });

      const result = await getActiveTemplateByType('nonexistent');
      expect(result).toBeNull();
    });
  });
});
