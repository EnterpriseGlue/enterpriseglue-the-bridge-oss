import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailTemplate } from '@enterpriseglue/shared/db/entities/EmailTemplate.js';

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderBracesTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (m, key) => {
    const v = vars[String(key)];
    return typeof v === 'string' ? v : m;
  });
}

export async function getActiveTemplateByType(type: string): Promise<{
  subject: string;
  htmlTemplate: string;
  textTemplate: string | null;
} | null> {
  try {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(EmailTemplate);
    const template = await repo.findOneBy({ type });

    if (!template) return null;
    if (!template.isActive) return null;

    return {
      subject: template.subject,
      htmlTemplate: template.htmlTemplate,
      textTemplate: template.textTemplate ?? null,
    };
  } catch {
    return null;
  }
}
