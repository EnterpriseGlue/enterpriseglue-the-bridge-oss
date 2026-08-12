import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('email administration OpenAPI contracts', () => {
  it('publishes typed secret-safe requests, responses, and ownership metadata', () => {
    const document = generateOpenApi();
    const paths = document.paths;

    const createSchema = paths?.['/api/admin/email-configs']?.post?.requestBody
      ?.content?.['application/json']?.schema;
    expect(createSchema?.properties).toMatchObject({
      name: expect.any(Object),
      provider: expect.objectContaining({ enum: ['resend', 'sendgrid', 'mailgun', 'mailjet', 'smtp'] }),
      apiKey: expect.any(Object),
      fromEmail: expect.any(Object),
    });
    expect(createSchema?.required).toEqual(expect.arrayContaining(['name', 'provider', 'apiKey', 'fromName', 'fromEmail']));

    const listItem = paths?.['/api/admin/email-configs']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema?.items;
    expect(listItem?.properties).toMatchObject({
      configKey: expect.any(Object),
      sourceRef: expect.any(Object),
      ownershipMode: expect.objectContaining({ enum: ['manual', 'config_locked', 'config_warn'] }),
      driftStatus: expect.any(Object),
    });
    expect(listItem?.properties).not.toHaveProperty('apiKey');
    expect(listItem?.properties).not.toHaveProperty('apiKeyEncrypted');

    const deleteResponse = paths?.['/api/admin/email-configs/{id}']?.delete?.responses?.['200']
      ?.content?.['application/json']?.schema;
    expect(deleteResponse?.properties).toHaveProperty('success');
    expect(paths?.['/api/admin/email-configs/{id}']?.delete?.responses).not.toHaveProperty('204');

    const testRequest = paths?.['/api/admin/email-configs/{id}/test']?.post?.requestBody
      ?.content?.['application/json']?.schema;
    expect(testRequest?.required).toEqual(['toEmail']);
    expect(testRequest?.properties).toHaveProperty('toEmail');
    expect(testRequest?.properties).not.toHaveProperty('to');

    const platformNameRequest = paths?.['/api/admin/email-platform-name']?.put?.requestBody
      ?.content?.['application/json']?.schema;
    expect(platformNameRequest?.required).toEqual(['emailPlatformName']);
    expect(platformNameRequest?.properties).not.toHaveProperty('name');

    const platformNameResponse = paths?.['/api/admin/email-platform-name']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema;
    expect(platformNameResponse?.properties).toHaveProperty('ownership');

    const templateItem = paths?.['/api/admin/email-templates']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema?.items;
    expect(templateItem?.properties).toMatchObject({
      variables: expect.objectContaining({ type: 'array' }),
      ownershipMode: expect.any(Object),
    });

    const preview = paths?.['/api/admin/email-templates/{id}/preview']?.post;
    const previewRequest = preview?.requestBody?.content?.['application/json']?.schema;
    expect(previewRequest?.properties).toHaveProperty('variables');
    const previewResponse = preview?.responses?.['200']?.content?.['application/json']?.schema;
    expect(previewResponse?.required).toEqual(expect.arrayContaining(['subject', 'html', 'text']));
    expect(previewResponse?.properties).toMatchObject({
      subject: expect.any(Object), html: expect.any(Object), text: expect.any(Object),
    });
  });
});
