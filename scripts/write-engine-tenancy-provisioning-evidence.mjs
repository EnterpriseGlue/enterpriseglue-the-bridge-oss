#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const registryPath = path.join(
  root,
  'test/authz/engine-tenancy-provisioning-journeys.json',
);
const observationDirectory = path.join(
  root,
  'test/results/engine-tenancy-provisioning-observations',
);
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'provisioning-journeys.json');
const allowDirty = process.argv.includes('--allow-dirty');

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const commit = command('git', ['rev-parse', 'HEAD']);
const trackedChanges = command('git', [
  'status',
  '--porcelain',
  '--untracked-files=no',
]);
if (trackedChanges && !allowDirty) {
  throw new Error('Provisioning-journey evidence must be assembled from a clean worktree');
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const journeysById = new Map(registry.journeys.map((journey) => [journey.id, journey]));
const observations = [];
const invalidObservations = [];

function observationInvalidReason(observation, journey) {
  if (observation.schemaVersion !== 1) {
    return 'unsupported observation schema version';
  }
  if (!journey) return 'unknown journey id';
  if (!journey.requiredChannels.includes(observation.channel)) {
    return 'channel is not required for this journey';
  }
  if (observation.status !== 'passed') return 'observation status is not passed';
  if (observation.commit !== commit) {
    return 'observation was produced for another commit';
  }
  if (observation.releaseCommitQualified !== true) {
    return 'observation is not qualified for a clean release commit';
  }
  if (observation.sourceState !== 'clean') {
    return 'observation source state is not clean';
  }
  if (observation.localhostOnly !== true) {
    return 'observation did not prove localhost-only execution';
  }
  if (observation.realHttpService !== true) return 'real HTTP service was not proved';
  if (observation.persistentDatabase !== true) return 'persistent database was not proved';
  if (observation.authorizationEvaluator !== true) {
    return 'authorization evaluator was not proved';
  }
  if (observation.channel === 'manual-ui' && observation.userInterface !== true) {
    return 'manual UI was not proved';
  }
  const expectedAssertions = new Set(journey.requiredAssertions);
  const observedAssertions = new Set(observation.assertions || []);
  const missingAssertions = [...expectedAssertions].filter(
    (assertion) => !observedAssertions.has(assertion),
  );
  if (missingAssertions.length > 0) {
    return `missing assertions: ${missingAssertions.join(', ')}`;
  }
  if (
    !observation.sanitization
    || Object.values(observation.sanitization).some(
      (containsSensitiveValue) => containsSensitiveValue !== false,
    )
  ) {
    return 'observation sanitization is missing or unsafe';
  }
  return null;
}

if (existsSync(observationDirectory)) {
  for (const fileName of readdirSync(observationDirectory).filter(
    (candidate) => candidate.endsWith('.json'),
  ).sort()) {
    const relativePath = path.relative(root, path.join(observationDirectory, fileName));
    let observation;
    try {
      observation = JSON.parse(readFileSync(path.join(observationDirectory, fileName), 'utf8'));
    } catch {
      invalidObservations.push({ artifact: relativePath, reason: 'invalid JSON' });
      continue;
    }
    const journey = journeysById.get(observation.journeyId);
    const invalidReason = observationInvalidReason(observation, journey);
    if (invalidReason) {
      invalidObservations.push({
        artifact: relativePath,
        journeyId: observation.journeyId ?? null,
        channel: observation.channel ?? null,
        reason: invalidReason,
      });
      continue;
    }
    observations.push({
      ...observation,
      artifact: relativePath,
    });
  }
}

const duplicateKeys = new Set();
const seenKeys = new Set();
for (const observation of observations) {
  const key = `${observation.journeyId}:${observation.channel}`;
  if (seenKeys.has(key)) duplicateKeys.add(key);
  seenKeys.add(key);
}
for (const key of duplicateKeys) {
  const [journeyId, channel] = key.split(':');
  invalidObservations.push({
    artifact: null,
    journeyId: Number(journeyId),
    channel,
    reason: `duplicate passing observation for ${key}`,
  });
}

const journeys = registry.journeys.map((journey) => {
  const expected = journey.requiredChannels;
  const matching = observations.filter(
    (observation) =>
      observation.journeyId === journey.id
      && expected.includes(observation.channel)
      && !duplicateKeys.has(`${journey.id}:${observation.channel}`),
  );
  const executedChannels = new Set(matching.map(({ channel }) => channel));
  const missingChannels = expected.filter((channel) => !executedChannels.has(channel));
  const unexpectedChannelResults = invalidObservations.filter(
    (observation) => observation.journeyId === journey.id,
  ).length;
  const status =
    missingChannels.length === 0 && unexpectedChannelResults === 0
      ? 'passed'
      : 'incomplete';
  return {
    id: journey.id,
    key: journey.key,
    description: journey.description,
    status,
    requiredChannels: expected,
    excludedChannels: journey.excludedChannels,
    supportedChannelExecutions: matching.length,
    expectedChannelExecutions: expected.length,
    missingChannelResults: missingChannels.length,
    missingChannels,
    unexpectedChannelResults,
    observations: matching.map(({ channel, artifact }) => ({ channel, artifact })),
  };
});

const passedJourneys = journeys.filter(({ status }) => status === 'passed').length;
const missingJourneys = journeys.length - passedJourneys;
const passedChannelExecutions = journeys.reduce(
  (total, journey) => total + journey.supportedChannelExecutions,
  0,
);
const status =
  passedJourneys === 14 && invalidObservations.length === 0
    ? 'passed'
    : 'incomplete';
const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-provisioning-journeys',
  coverageStandard: registry.coverageStandard,
  status,
  generatedAt: new Date().toISOString(),
  commit,
  sourceState: trackedChanges ? 'dirty-development-run' : 'clean',
  releaseCommitQualified: status === 'passed' && trackedChanges.length === 0,
  passedJourneys,
  missingJourneys,
  expectedChannelExecutions: registry.journeys.reduce(
    (total, journey) => total + journey.requiredChannels.length,
    0,
  ),
  passedChannelExecutions,
  unexpectedChannelResults: invalidObservations.length,
  invalidObservations,
  journeys,
  observationContract: {
    directory: path.relative(root, observationDirectory),
    requiredFields: [
      'schemaVersion',
      'journeyId',
      'channel',
      'status',
      'commit',
      'sourceState',
      'releaseCommitQualified',
      'localhostOnly',
      'realHttpService',
      'persistentDatabase',
      'authorizationEvaluator',
      'userInterface for manual-ui',
      'assertions',
      'sanitization',
    ],
  },
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  `[engine-tenancy-provisioning] ${passedJourneys}/14 journeys and ` +
  `${evidence.passedChannelExecutions}/${evidence.expectedChannelExecutions} ` +
  `required channel executions: ${path.relative(root, outputPath)}`,
);
if (invalidObservations.length > 0) {
  process.exitCode = 1;
}
