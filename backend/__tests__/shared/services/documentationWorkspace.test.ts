import {afterEach, describe, expect, it} from 'vitest';
import {config} from '@enterpriseglue/shared/config/index.js';
import {documentationWorkspaceService} from '@enterpriseglue/shared/services/DocumentationWorkspaceService.js';
import type {UserJwtPayload} from '@enterpriseglue/shared/utils/jwt.js';

const previous = config.documentationWorkspacesJson;
afterEach(() => {config.documentationWorkspacesJson = previous;});
const principal = {userId:'provider-asserted-user',email:'reader@example.test',type:'access'} as UserJwtPayload;
describe('documentation domain authority', () => {
  it('a tenant provider asserting an allowed email cannot enter domain-only documentation', () => {
    config.documentationWorkspacesJson = JSON.stringify({schemaVersion:1,workspaces:[{
      id:'alpha',name:'Customer specific',active:true,accessMode:'verified_domain',allowedEmailDomains:['example.test'],readers:[],
    }]});
    expect(documentationWorkspaceService.list(principal)).toEqual([]);
    expect(documentationWorkspaceService.list({...principal,tenantId:'other-customer'})).toEqual([]);
    expect(() => documentationWorkspaceService.require(principal,'alpha')).toThrow('Documentation workspace');
    expect(documentationWorkspaceService.list({...principal,sessionClass:'cloud_account'})).toEqual([{id:'alpha',name:'Customer specific'}]);
  });
  it('individual admission retains its immutable-account restriction for a verified tenant session', () => {
    config.documentationWorkspacesJson = JSON.stringify({schemaVersion:1,workspaces:[{
      id:'alpha',name:'Customer specific',active:true,allowedEmailDomains:['example.test'],readers:[{userId:'approved-account',expiresAt:Date.now()+60000}],
    }]});
    expect(documentationWorkspaceService.list(principal)).toEqual([]);
    expect(documentationWorkspaceService.list({...principal,userId:'approved-account'})).toEqual([{id:'alpha',name:'Customer specific'}]);
  });
});
