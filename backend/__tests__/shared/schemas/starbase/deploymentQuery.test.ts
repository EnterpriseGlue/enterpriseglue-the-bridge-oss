import { describe, expect, it } from 'vitest';
import {
  FileDeploymentSummarySchema,
  LatestProjectDeploymentArtifactSchema,
} from '@enterpriseglue/shared/schemas/starbase/deployment-query.js';

const fileDeployment = {
  engineId: 'engine-1',
  engineDeploymentId: 'deployment-1',
  fileId: 'file-1',
  fileType: 'bpmn',
  fileName: 'invoice.bpmn',
  fileGitCommitId: 'commit-1',
  fileVersionNumber: 4,
  artifacts: [{ kind: 'process', key: 'invoice', version: 2, id: 'artifact-1' }],
  deployedAt: 1700000000,
  engineName: 'Engine One',
  environmentTag: 'production',
};

describe('Starbase deployment-query contracts', () => {
  it('parses one visible file deployment summary', () => {
    expect(FileDeploymentSummarySchema.parse(fileDeployment)).toEqual(fileDeployment);
  });

  it('requires complete latest-project lineage fields', () => {
    expect(() => LatestProjectDeploymentArtifactSchema.parse(fileDeployment)).toThrow();
    const { fileVersionNumber: _fileVersionNumber, ...latestProjectArtifact } = fileDeployment;
    expect(LatestProjectDeploymentArtifactSchema.parse({
      ...latestProjectArtifact,
      fileUpdatedAt: 1700000001,
      fileContentHash: 'hash-1',
      fileGitCommitMessage: 'Deploy invoice',
      resourceName: 'invoices/invoice.bpmn',
      artifactVersions: { 'process:invoice': 2 },
      gitDeploymentId: 'git-deployment-1',
      gitCommitSha: 'abc123',
      gitCommitMessage: 'Deploy invoice',
      camundaDeploymentId: 'camunda-1',
      camundaDeploymentName: 'Invoice deployment',
      camundaDeploymentTime: '2025-01-01T00:00:00.000Z',
    })).toMatchObject({ resourceName: 'invoices/invoice.bpmn' });
  });
});
