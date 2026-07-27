#!/usr/bin/env node

import {
  createHash,
  generateKeyPairSync,
} from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createPluginDeploymentExecutionObservationV1,
  createPluginLifecyclePlanEnvelopeV1,
  emptyPluginInstallerStateV1,
  installPluginV1,
  parsePluginInstallerStateV1,
  pluginKubernetesPvcNameV1,
  pluginKubernetesResourceNameV1,
  renderHelmPluginValuesV1,
  rollbackPluginV1,
  upgradePluginV1,
  verifyPluginInstallInputV1,
} from '../packages/plugin-installer/dist/index.js';

const root = process.cwd();
const project = await mkdtemp(
  resolve(root, '.plugin-kubernetes-lifecycle-'),
);
const output = resolve(project, 'generated/plugins');
const assetsRoot = resolve(project, 'assets');
const chart = resolve(
  root,
  'infra/kubernetes/helm/enterpriseglue-plugin-runtime',
);
const rbacChart = resolve(
  root,
  'infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac',
);
const kubeconfig = requiredEnvironment('EG_PLUGIN_TEST_KUBECONFIG');
const containerKubeconfig = requiredEnvironment(
  'EG_PLUGIN_TEST_CONTAINER_KUBECONFIG',
);
const context = requiredEnvironment('EG_PLUGIN_TEST_KUBE_CONTEXT');
const pluginImage = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_REFERENCE_IMAGE'),
);
const secondaryPluginV1Image = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_SECONDARY_V1_IMAGE'),
);
const secondaryPluginV2Image = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_SECONDARY_V2_IMAGE'),
);
const secondaryPluginV3Image = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_SECONDARY_V3_IMAGE'),
);
const secondaryPluginV4Image = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_SECONDARY_V4_IMAGE'),
);
const secondaryPluginV5Image = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_SECONDARY_V5_IMAGE'),
);
const migrationImage = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_MIGRATION_IMAGE'),
);
const installerImage = immutableReference(
  requiredEnvironment('EG_PLUGIN_TEST_INSTALLER_IMAGE'),
);
const namespace = `eg-plugin-lifecycle-${process.pid}`;
const releaseName = `eg-plugin-lifecycle-${process.pid}`;
const rbacReleaseName = `eg-plugin-installer-rbac-${process.pid}`;
const installerServiceAccount = 'enterpriseglue-plugin-installer';
const primaryPluginId = 'io.enterpriseglue.reference-health';
const secondaryPluginId =
  'io.enterpriseglue.reference-health-secondary';
const pluginIds = [primaryPluginId, secondaryPluginId];
const primaryDeployment =
  pluginKubernetesResourceNameV1(primaryPluginId);
const secondaryDeployment =
  pluginKubernetesResourceNameV1(secondaryPluginId);
let namespaceCreated = false;
let workerKubeconfig;
let workerClusterConfig;
let restrictedInstallerCredentialRotated = false;
let storageProbeSequence = 0;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function immutableReference(value) {
  if (
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[a-f0-9]{64}$/.test(
      value,
    )
  ) {
    throw new Error('Lifecycle test images must be immutable OCI references');
  }
  return value;
}

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  const acceptedStatuses = options.acceptedStatuses ?? [0];
  if (!acceptedStatuses.includes(result.status)) {
    throw new Error(
      `${commandName} failed: ${(result.stderr || result.stdout)
        .trim()
        .slice(0, 2_000)}`,
    );
  }
  return result.stdout.trim();
}

function kubectl(args, options = {}) {
  return command(
    'kubectl',
    [
      '--kubeconfig',
      kubeconfig,
      '--context',
      context,
      ...args,
    ],
    options,
  );
}

function wrapper(args, options = {}) {
  if (!workerKubeconfig) {
    throw new Error('Restricted installer kubeconfig is not initialized');
  }
  return command(resolve(root, 'scripts/eg-plugin'), args, {
    env: {
      EG_PLUGIN_INSTALLER_IMAGE: installerImage,
      EG_PLUGIN_KUBECONFIG: workerKubeconfig,
      EG_PLUGIN_KUBERNETES_NETWORK:
        process.env.EG_PLUGIN_KUBERNETES_NETWORK?.trim() || 'bridge',
    },
    acceptedStatuses: options.acceptedStatuses,
  });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeDesiredState(state) {
  await mkdir(output, { recursive: true, mode: 0o700 });
  await Promise.all(
    pluginIds.map((pluginId) =>
      mkdir(resolve(assetsRoot, pluginId), {
        recursive: true,
        mode: 0o700,
      }),
    ),
  );
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  await writeFile(
    resolve(output, 'plugin-invocation-private.pem'),
    pair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    { mode: 0o600 },
  );
  await writeFile(
    resolve(output, 'plugin-invocation-public.pem'),
    publicKey,
    { mode: 0o600 },
  );
  await writeStateSnapshot(state);
  return publicKey;
}

async function writeStateSnapshot(state) {
  await writeFile(
    resolve(output, 'plugin-installer-state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  );
  const envelope = createPluginLifecyclePlanEnvelopeV1(
    state.revision,
    state.lifecyclePlan,
  );
  await writeFile(
    resolve(output, 'plugin-lifecycle-plan.json'),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    resolve(output, 'plugin-lifecycle-observation.json'),
    `${JSON.stringify(
      createPluginDeploymentExecutionObservationV1(
        envelope,
        null,
      ),
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    resolve(output, 'helm.plugins.generated.values.yaml'),
    renderHelmPluginValuesV1(state),
    { mode: 0o600 },
  );
}

function applyLifecycle(options = {}) {
  const args = [
    'apply-kubernetes',
    '--output',
    relative(root, output),
    '--project-directory',
    '.',
    '--chart',
    relative(root, chart),
    '--values',
    relative(
      root,
      resolve(output, 'helm.plugins.generated.values.yaml'),
    ),
    '--namespace',
    namespace,
    '--release-name',
    releaseName,
    '--utility-image',
    installerImage,
    '--kube-context',
    context,
    '--platform',
    'kubernetes',
    '--artifact-storage-mib',
    '64',
    '--rollout-timeout-seconds',
    String(options.rolloutTimeoutSeconds ?? 120),
  ];
  if (options.supersedeExecutionRevision !== undefined) {
    args.push(
      '--supersede-execution-revision',
      String(options.supersedeExecutionRevision),
    );
  }
  return JSON.parse(
    wrapper(args, {
      acceptedStatuses: options.acceptedStatuses,
    }),
  );
}

function mutateLifecycle(args) {
  wrapper([...args, '--output', relative(root, output)]);
}

function applyObject(object) {
  kubectl(['apply', '--filename', '-'], {
    input: `${JSON.stringify(object)}\n`,
  });
}

function canInstaller(verb, resource, subresource) {
  return canServiceAccount(
    installerServiceAccount,
    verb,
    resource,
    subresource,
  );
}

function canServiceAccount(
  serviceAccount,
  verb,
  resource,
  subresource,
) {
  const result = spawnSync(
    'kubectl',
    [
      '--kubeconfig',
      kubeconfig,
      '--context',
      context,
      'auth',
      'can-i',
      verb,
      resource,
      ...(subresource ? [`--subresource=${subresource}`] : []),
      '--namespace',
      namespace,
      '--as',
      `system:serviceaccount:${namespace}:${serviceAccount}`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const decision = result.stdout.trim();
  if (
    (result.status === 0 && decision === 'yes') ||
    (result.status === 1 && decision === 'no')
  ) {
    return decision;
  }
  throw new Error(
    `kubectl auth can-i failed: ${(result.stderr || result.stdout)
      .trim()
      .slice(0, 2_000)}`,
  );
}

function kubernetesObject(kind, name) {
  return JSON.parse(
    kubectl([
      '--namespace',
      namespace,
      'get',
      kind,
      name,
      '--output',
      'json',
    ]),
  );
}

function pluginPodIdentity(pluginId) {
  const resourceName = pluginKubernetesResourceNameV1(pluginId);
  const pods = JSON.parse(
    kubectl([
      '--namespace',
      namespace,
      'get',
      'pods',
      '--selector',
      `app.kubernetes.io/name=${resourceName}`,
      '--output',
      'json',
    ]),
  ).items;
  const readyPods = pods.filter(
    (pod) =>
      pod.metadata?.deletionTimestamp === undefined &&
      pod.status?.containerStatuses?.every(
        (container) => container.ready === true,
      ),
  );
  const identity = readyPods[0]?.metadata?.uid;
  if (readyPods.length !== 1 || typeof identity !== 'string') {
    throw new Error(
      `Expected one ready workload pod for ${pluginId}`,
    );
  }
  return identity;
}

function verifyPluginResourceIsolation() {
  const claims = JSON.parse(
    kubectl([
      '--namespace',
      namespace,
      'get',
      'persistentvolumeclaims',
      '--output',
      'json',
    ]),
  );
  const replayClaims = claims.items.filter(
    (claim) =>
      claim.metadata?.annotations?.[
        'io.enterpriseglue/storage-name'
      ] === 'replay-state',
  );
  const claimedPluginIds = new Set(
    replayClaims.map(
      (claim) =>
        claim.metadata?.annotations?.[
          'io.enterpriseglue/plugin-id'
        ],
    ),
  );
  if (
    replayClaims.length !== pluginIds.length ||
    pluginIds.some((pluginId) => !claimedPluginIds.has(pluginId)) ||
    new Set(replayClaims.map((claim) => claim.metadata?.name)).size !==
      pluginIds.length
  ) {
    throw new Error(
      'Kubernetes plugins did not receive distinct plugin-owned storage',
    );
  }

  for (const pluginId of pluginIds) {
    const resourceName = pluginKubernetesResourceNameV1(pluginId);
    const deployment = kubernetesObject('deployment', resourceName);
    const serviceAccount = kubernetesObject(
      'serviceaccount',
      resourceName,
    );
    const networkPolicy = kubernetesObject(
      'networkpolicy',
      resourceName,
    );
    const ingressPeer =
      networkPolicy.spec?.ingress?.[0]?.from?.[0];
    const egressPeer =
      networkPolicy.spec?.egress?.[0]?.to?.[0];
    if (
      deployment.spec?.template?.spec?.serviceAccountName !==
        resourceName ||
      deployment.spec?.template?.spec
        ?.automountServiceAccountToken !== false ||
      serviceAccount.automountServiceAccountToken !== false ||
      networkPolicy.spec?.podSelector?.matchLabels?.[
        'app.kubernetes.io/name'
      ] !== resourceName ||
      networkPolicy.spec?.ingress?.length !== 1 ||
      networkPolicy.spec?.egress?.length !== 1 ||
      ingressPeer?.podSelector?.matchLabels?.[
        'app.kubernetes.io/name'
      ] !== 'enterpriseglue-backend' ||
      egressPeer?.podSelector?.matchLabels?.[
        'app.kubernetes.io/name'
      ] !== 'enterpriseglue-backend' ||
      ingressPeer?.namespaceSelector ||
      ingressPeer?.ipBlock ||
      egressPeer?.namespaceSelector ||
      egressPeer?.ipBlock
    ) {
      throw new Error(
        `Kubernetes resource isolation is invalid for ${pluginId}`,
      );
    }
    for (const [verb, resource] of [
      ['get', 'secrets'],
      ['get', 'configmaps'],
      ['list', 'pods'],
    ]) {
      if (
        canServiceAccount(resourceName, verb, resource) !== 'no'
      ) {
        throw new Error(
          `Plugin service account ${resourceName} unexpectedly allows ${verb} ${resource}`,
        );
      }
    }
  }
}

function verifySecondaryCapabilityIdentity(expectedVersion) {
  const probe = `eg-plugin-capability-probe-${expectedVersion.replaceAll(
    '.',
    '-',
  )}-${process.pid}`;
  applyObject({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: probe,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'enterpriseglue-backend',
      },
    },
    spec: {
      restartPolicy: 'Never',
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 65532,
        runAsGroup: 65532,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: 'verify',
          image:
            expectedVersion === '0.1.0'
              ? secondaryPluginV1Image
              : secondaryPluginV2Image,
          imagePullPolicy: 'IfNotPresent',
          command: [
            'node',
            '--input-type=module',
            '--eval',
            `const response=await fetch('http://${secondaryDeployment}:8080/_plugin/capabilities',{signal:AbortSignal.timeout(5000)});const value=await response.json();if(!response.ok||value.protocol!=='backend.plugin.enterpriseglue.io/v1'||value.pluginId!=='${secondaryPluginId}'||value.pluginVersion!=='${expectedVersion}'||value.operations?.length!==0)throw Error('invalid capability identity');console.log('verified')`,
          ],
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
            runAsUser: 65532,
            capabilities: { drop: ['ALL'] },
          },
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '100m', memory: '64Mi' },
          },
        },
      ],
    },
  });
  kubectl([
    '--namespace',
    namespace,
    'wait',
    '--for=jsonpath={.status.phase}=Succeeded',
    `pod/${probe}`,
    '--timeout=60s',
  ]);
  if (
    kubectl(['--namespace', namespace, 'logs', probe]) !==
    'verified'
  ) {
    throw new Error(
      'Secondary plugin capability identity verification failed',
    );
  }
}

function secondaryStorageProbe(
  action,
  dataSchema,
  expectedOperation,
) {
  storageProbeSequence += 1;
  const probe = `eg-plugin-storage-${action}-${dataSchema}-${storageProbeSequence}-${process.pid}`;
  const claim = pluginKubernetesPvcNameV1(
    secondaryPluginId,
    dataSchema,
    'replay-state',
  );
  const script =
    action === 'seed'
      ? "import{writeFile}from'node:fs/promises';await writeFile('/data/payload.txt','secondary-lifecycle-payload-v1\\n',{mode:0o600});await writeFile('/data/migration-state.json',JSON.stringify({schemaVersion:1,pluginId:'io.enterpriseglue.reference-health-secondary',dataSchema:0,operation:'seed',idempotencyKey:'seed'})+'\\n',{mode:0o600});console.log('verified')"
      : `import{readFile}from'node:fs/promises';const payload=await readFile('/data/payload.txt','utf8');const state=JSON.parse(await readFile('/data/migration-state.json','utf8'));if(payload!=='secondary-lifecycle-payload-v1\\n'||state.schemaVersion!==1||state.pluginId!=='${secondaryPluginId}'||state.dataSchema!==${dataSchema}||state.operation!=='${expectedOperation}'||typeof state.idempotencyKey!=='string')throw Error('invalid migration state');console.log('verified')`;
  applyObject({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: probe, namespace },
    spec: {
      restartPolicy: 'Never',
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 65532,
        runAsGroup: 65532,
        fsGroup: 65532,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: 'verify',
          image: installerImage,
          imagePullPolicy: 'IfNotPresent',
          command: [
            'node',
            '--input-type=module',
            '--eval',
            script,
          ],
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
            runAsUser: 65532,
            capabilities: { drop: ['ALL'] },
          },
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '100m', memory: '64Mi' },
          },
          volumeMounts: [
            {
              name: 'data',
              mountPath: '/data',
              readOnly: action !== 'seed',
            },
          ],
        },
      ],
      volumes: [
        {
          name: 'data',
          persistentVolumeClaim: { claimName: claim },
        },
      ],
    },
  });
  kubectl([
    '--namespace',
    namespace,
    'wait',
    '--for=jsonpath={.status.phase}=Succeeded',
    `pod/${probe}`,
    '--timeout=60s',
  ]);
  if (
    kubectl(['--namespace', namespace, 'logs', probe]) !==
    'verified'
  ) {
    throw new Error('Secondary plugin storage verification failed');
  }
}

function verifyFailedMigrationJob(failedExecution) {
  const jobs = JSON.parse(
    kubectl([
      '--namespace',
      namespace,
      'get',
      'jobs',
      '--output',
      'json',
    ]),
  ).items;
  const job = jobs.find(
    (candidate) =>
      candidate.metadata?.annotations?.[
        'io.enterpriseglue/desired-revision'
      ] === String(failedExecution.desiredRevision) &&
      candidate.metadata?.annotations?.[
        'io.enterpriseglue/phase'
      ] === 'migrate',
  );
  const container = job?.spec?.template?.spec?.containers?.[0];
  const jobFailed =
    (job?.status?.failed ?? 0) > 0 ||
    job?.status?.conditions?.some(
      (condition) =>
        condition.type === 'Failed' &&
        condition.status === 'True',
    ) === true;
  const environment = Object.fromEntries(
    (container?.env ?? []).map((entry) => [
      entry.name,
      entry.value,
    ]),
  );
  if (
    !job ||
    !jobFailed ||
    container?.image !== migrationImage ||
    environment.ENTERPRISEGLUE_PLUGIN_OPERATION !== 'upgrade' ||
    environment.ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA !== '0' ||
    environment.ENTERPRISEGLUE_PLUGIN_TO_SCHEMA !== '2'
  ) {
    throw new Error(
      'Failed Kubernetes migration Job evidence is invalid',
    );
  }
}

function verifyFailureFixtureImage(image, mode) {
  storageProbeSequence += 1;
  const podName = `eg-plugin-fixture-${mode}-${storageProbeSequence}-${process.pid}`;
  applyObject({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: podName, namespace },
    spec: {
      restartPolicy: 'Never',
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 65532,
        runAsGroup: 65532,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: 'fixture',
          image,
          imagePullPolicy: 'IfNotPresent',
          ports: [{ name: 'http', containerPort: 8080 }],
          ...(mode === 'readiness-fail'
            ? {
                readinessProbe: {
                  httpGet: {
                    path: '/_plugin/ready',
                    port: 'http',
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 1,
                  timeoutSeconds: 1,
                  failureThreshold: 1,
                },
              }
            : {}),
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
            runAsUser: 65532,
            capabilities: { drop: ['ALL'] },
          },
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '100m', memory: '64Mi' },
          },
        },
      ],
    },
  });
  if (mode === 'readiness-fail') {
    kubectl([
      '--namespace',
      namespace,
      'wait',
      '--for=jsonpath={.status.phase}=Running',
      `pod/${podName}`,
      '--timeout=60s',
    ]);
    kubectl(
      [
        '--namespace',
        namespace,
        'wait',
        '--for=condition=Ready',
        `pod/${podName}`,
        '--timeout=5s',
      ],
      { acceptedStatuses: [1] },
    );
    const pod = kubernetesObject('pod', podName);
    const status = pod.status?.containerStatuses?.[0];
    if (
      pod.status?.phase !== 'Running' ||
      status?.ready !== false ||
      !status?.state?.running ||
      status?.restartCount !== 0
    ) {
      throw new Error(
        'Readiness-failure fixture did not remain running and unready',
      );
    }
  } else {
    kubectl([
      '--namespace',
      namespace,
      'wait',
      '--for=jsonpath={.status.containerStatuses[0].state.terminated.exitCode}=1',
      `pod/${podName}`,
      '--timeout=60s',
    ]);
    kubectl([
      '--namespace',
      namespace,
      'wait',
      '--for=jsonpath={.status.phase}=Failed',
      `pod/${podName}`,
      '--timeout=60s',
    ]);
    const pod = kubernetesObject('pod', podName);
    const terminated =
      pod.status?.containerStatuses?.[0]?.state?.terminated;
    if (
      pod.status?.phase !== 'Failed' ||
      terminated?.exitCode !== 1
    ) {
      throw new Error(
        'Process-crash fixture did not terminate with the expected failure',
      );
    }
  }
  kubectl([
    '--namespace',
    namespace,
    'delete',
    'pod',
    podName,
    '--wait=true',
  ]);
}

async function exerciseSecondaryRuntimeFailure(
  record,
  failureName,
  primaryPodIdentityBeforeFailure,
) {
  let state = parsePluginInstallerStateV1(
    JSON.parse(
      await readFile(
        resolve(output, 'plugin-installer-state.json'),
        'utf8',
      ),
    ),
  );
  state = upgradePluginV1(
    state,
    record,
    new Date().toISOString(),
  );
  await writeStateSnapshot(state);
  const failed = applyLifecycle({
    acceptedStatuses: [3],
    rolloutTimeoutSeconds: 10,
  });
  if (
    failed.status !== 'failed' ||
    failed.operation !== 'upgrade' ||
    failed.reasonCode !== 'phase_failed' ||
    failed.nextPhase !== 'ready' ||
    failed.completedPhases.join(',') !==
      'stage,drain,deactivate,checkpoint,activate'
  ) {
    throw new Error(
      `Secondary Kubernetes ${failureName} failure was not contained`,
    );
  }
  if (
    kubectl([
      '--namespace',
      namespace,
      'get',
      'deployment',
      secondaryDeployment,
      '--ignore-not-found',
      '--output',
      'name',
    ])
  ) {
    throw new Error(
      `Secondary ${failureName} candidate Deployment remained after failure`,
    );
  }
  kubectl([
    '--namespace',
    namespace,
    'rollout',
    'status',
    `deployment/${primaryDeployment}`,
    '--timeout=120s',
  ]);
  if (
    pluginPodIdentity(primaryPluginId) !==
    primaryPodIdentityBeforeFailure
  ) {
    throw new Error(
      `Unrelated primary plugin restarted during secondary ${failureName} failure`,
    );
  }

  mutateLifecycle([
    'rollback',
    '--plugin',
    secondaryPluginId,
    '--supersede-execution-revision',
    String(failed.revision),
  ]);
  const recovered = applyLifecycle({
    supersedeExecutionRevision: failed.revision,
  });
  if (
    recovered.status !== 'succeeded' ||
    recovered.operation !== 'rollback' ||
    recovered.completedPhases.join(',') !==
      'stage,drain,deactivate,checkpoint,activate,ready,commit'
  ) {
    throw new Error(
      `Secondary Kubernetes ${failureName} recovery did not succeed`,
    );
  }
  for (const deployment of [
    primaryDeployment,
    secondaryDeployment,
  ]) {
    kubectl([
      '--namespace',
      namespace,
      'rollout',
      'status',
      `deployment/${deployment}`,
      '--timeout=120s',
    ]);
  }
  verifySecondaryCapabilityIdentity('0.1.0');
  secondaryStorageProbe('verify', 0, 'rollback');
  if (
    pluginPodIdentity(primaryPluginId) !==
    primaryPodIdentityBeforeFailure
  ) {
    throw new Error(
      `Unrelated primary plugin restarted during secondary ${failureName} recovery`,
    );
  }
}

async function bootstrapRestrictedInstaller() {
  command('helm', [
    'upgrade',
    '--install',
    rbacReleaseName,
    rbacChart,
    '--namespace',
    namespace,
    '--kubeconfig',
    kubeconfig,
    '--kube-context',
    context,
    '--wait',
    '--timeout',
    '60s',
  ]);

  const expectedAllowed = [
    ['get', 'configmaps'],
    ['create', 'persistentvolumeclaims'],
    ['patch', 'deployments'],
    ['patch', 'deployments/scale'],
    ['create', 'jobs'],
    ['create', 'networkpolicies.networking.k8s.io'],
  ];
  for (const [verb, resource] of expectedAllowed) {
    if (canInstaller(verb, resource) !== 'yes') {
      throw new Error(
        `Installer RBAC unexpectedly denies ${verb} ${resource}`,
      );
    }
  }
  const expectedDenied = [
    ['get', 'secrets'],
    ['create', 'roles.rbac.authorization.k8s.io'],
    ['create', 'rolebindings.rbac.authorization.k8s.io'],
    ['create', 'pods', 'exec'],
    ['get', 'pods', 'log'],
    ['get', 'nodes'],
  ];
  for (const [verb, resource, subresource] of expectedDenied) {
    if (canInstaller(verb, resource, subresource) !== 'no') {
      throw new Error(
        `Installer RBAC unexpectedly allows ${verb} ${resource}${
          subresource ? `/${subresource}` : ''
        }`,
      );
    }
  }

  const token = kubectl([
    '--namespace',
    namespace,
    'create',
    'token',
    installerServiceAccount,
    '--duration=15m',
  ]);
  const source = JSON.parse(
    command('kubectl', [
      '--kubeconfig',
      containerKubeconfig,
      '--context',
      context,
      'config',
      'view',
      '--raw',
      '--minify',
      '--output',
      'json',
    ]),
  );
  const clusterConfig = source.clusters?.[0]?.cluster;
  if (
    !clusterConfig ||
    typeof clusterConfig.server !== 'string' ||
    !clusterConfig.server
  ) {
    throw new Error('Container-reachable cluster configuration is invalid');
  }
  workerClusterConfig = clusterConfig;
  workerKubeconfig = await writeRestrictedInstallerKubeconfig(
    token,
    'installer-initial.kubeconfig',
  );
}

async function writeRestrictedInstallerKubeconfig(token, name) {
  if (
    !workerClusterConfig ||
    typeof token !== 'string' ||
    token.length < 100
  ) {
    throw new Error('Restricted installer credential input is invalid');
  }
  const path = resolve(project, name);
  await writeFile(
    path,
    `${JSON.stringify(
      {
        apiVersion: 'v1',
        kind: 'Config',
        clusters: [{ name: 'target', cluster: workerClusterConfig }],
        users: [{ name: 'installer', user: { token } }],
        contexts: [
          {
            name: context,
            context: {
              cluster: 'target',
              user: 'installer',
              namespace,
            },
          },
        ],
        'current-context': context,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const details = await lstat(path);
  if (
    !details.isFile() ||
    details.isSymbolicLink() ||
    (details.mode & 0o777) !== 0o600
  ) {
    throw new Error(
      'Restricted installer kubeconfig is not a mode-0600 regular file',
    );
  }
  return path;
}

async function rotateRestrictedInstallerCredential() {
  if (!workerKubeconfig) {
    throw new Error('Restricted installer credential was not initialized');
  }
  const priorPath = workerKubeconfig;
  const priorDigest = digest(await readFile(priorPath));
  const replacementToken = kubectl([
    '--namespace',
    namespace,
    'create',
    'token',
    installerServiceAccount,
    '--duration=15m',
  ]);
  const replacementPath = await writeRestrictedInstallerKubeconfig(
    replacementToken,
    'installer-rotated.kubeconfig',
  );
  if (digest(await readFile(replacementPath)) === priorDigest) {
    throw new Error(
      'Restricted installer credential rotation reused the prior kubeconfig',
    );
  }
  workerKubeconfig = replacementPath;
  await rm(priorPath);
  restrictedInstallerCredentialRotated = true;
}

async function main() {
  const resources = JSON.parse(
    await readFile(
      resolve(root, 'packages/plugin-reference/deploy/resources.json'),
      'utf8',
    ),
  );
  const resourceBytes = Buffer.from(JSON.stringify(resources));
  const createRecord = (
    pluginId,
    displayName,
    version,
    image,
    migration,
  ) => {
    const manifest = {
      apiVersion: 'plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePlugin',
      metadata: {
        id: pluginId,
        version,
        displayName,
        publisher: 'io.enterpriseglue',
      },
      compatibility: {
        host: '>=0.4.0 <0.5.0',
        sdk: '^0.1.0',
        backendProtocol: 1,
        requiredSlots: [],
      },
      deployment: {
        backend: {
          image,
          healthPath: '/_plugin/health',
          readyPath: '/_plugin/ready',
          protocolPath: '/_plugin/capabilities',
          operations: [],
        },
        ...(migration
          ? {
              migration: {
                image: migrationImage,
                ...migration,
              },
            }
          : {}),
        resources: {
          descriptor: 'deploy/resources.json',
          sha256: digest(resourceBytes),
        },
      },
      scope: {
        installation: 'deployment',
        enablement: 'deployment',
      },
      permissions: { required: [], optional: [] },
      network: { egressPolicy: 'none' },
      entitlement: { provider: 'none' },
      dependencies: [],
      conflicts: [],
      events: { subscriptions: [] },
      jobs: { fixedSchedules: [] },
      contributions: [],
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    return verifyPluginInstallInputV1({
      release: {
        version,
        channel: 'stable',
        bundle: image,
        manifestSha256: digest(manifestBytes),
        hostCompatibility: '>=0.4.0 <0.5.0',
        testedHostVersions: ['0.4.6'],
        sdkCompatibility: '^0.1.0',
        revoked: false,
        revocationReasonCode: 'none',
      },
      manifest,
      manifestBytes,
      resources,
      resourceBytes,
      grantedPermissions: [],
      stagedAssetPath: `./${relative(
        root,
        resolve(assetsRoot, pluginId),
      ).replaceAll('\\', '/')}`,
    });
  };
  const primaryRecord = createRecord(
    primaryPluginId,
    'Reference Health',
    '0.1.0',
    pluginImage,
  );
  const secondaryRecord = createRecord(
    secondaryPluginId,
    'Reference Health Secondary',
    '0.1.0',
    secondaryPluginV1Image,
  );
  const secondaryUpgradeRecord = createRecord(
    secondaryPluginId,
    'Reference Health Secondary',
    '0.2.0',
    secondaryPluginV2Image,
    {
      fromSchema: 0,
      toSchema: 1,
      rollbackThrough: 0,
    },
  );
  const secondaryFailingUpgradeRecord = createRecord(
    secondaryPluginId,
    'Reference Health Secondary',
    '0.3.0',
    secondaryPluginV3Image,
    {
      fromSchema: 0,
      toSchema: 2,
      rollbackThrough: 0,
    },
  );
  const secondaryReadinessFailureRecord = createRecord(
    secondaryPluginId,
    'Reference Health Secondary',
    '0.4.0',
    secondaryPluginV4Image,
  );
  const secondaryCrashFailureRecord = createRecord(
    secondaryPluginId,
    'Reference Health Secondary',
    '0.5.0',
    secondaryPluginV5Image,
  );
  let state = installPluginV1(
    emptyPluginInstallerStateV1(),
    primaryRecord,
    new Date().toISOString(),
  );
  const publicKey = await writeDesiredState(state);

  applyObject({
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: namespace,
      labels: {
        'pod-security.kubernetes.io/enforce': 'restricted',
        'pod-security.kubernetes.io/enforce-version': 'latest',
      },
    },
  });
  namespaceCreated = true;
  await bootstrapRestrictedInstaller();
  applyObject({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: 'enterpriseglue-plugin-invocation-public',
      namespace,
    },
    data: { 'public.pem': publicKey },
  });

  const installed = applyLifecycle();
  if (
    installed.status !== 'succeeded' ||
    installed.completedPhases.join(',') !== 'stage,commit'
  ) {
    throw new Error(
      'Primary disabled Kubernetes install lifecycle did not succeed',
    );
  }

  state = installPluginV1(
    state,
    secondaryRecord,
    new Date().toISOString(),
  );
  await writeStateSnapshot(state);
  const secondaryInstalled = applyLifecycle();
  if (
    secondaryInstalled.status !== 'succeeded' ||
    secondaryInstalled.completedPhases.join(',') !==
      'stage,commit'
  ) {
    throw new Error(
      'Secondary disabled Kubernetes install lifecycle did not succeed',
    );
  }

  mutateLifecycle(['enable', '--plugin', primaryPluginId]);
  const primaryEnabled = applyLifecycle();
  if (primaryEnabled.status !== 'succeeded') {
    throw new Error(
      'Primary Kubernetes enable lifecycle did not succeed',
    );
  }
  kubectl([
    '--namespace',
    namespace,
    'rollout',
    'status',
    `deployment/${primaryDeployment}`,
    '--timeout=120s',
  ]);

  mutateLifecycle(['enable', '--plugin', secondaryPluginId]);
  const secondaryEnabled = applyLifecycle();
  if (secondaryEnabled.status !== 'succeeded') {
    throw new Error(
      'Secondary Kubernetes enable lifecycle did not succeed',
    );
  }
  for (const deployment of [
    primaryDeployment,
    secondaryDeployment,
  ]) {
    kubectl([
      '--namespace',
      namespace,
      'rollout',
      'status',
      `deployment/${deployment}`,
      '--timeout=120s',
    ]);
  }
  verifyPluginResourceIsolation();
  verifySecondaryCapabilityIdentity('0.1.0');
  secondaryStorageProbe('seed', 0, 'seed');
  secondaryStorageProbe('verify', 0, 'seed');
  const primaryPodBeforeSecondaryUpgrade =
    pluginPodIdentity(primaryPluginId);
  await rotateRestrictedInstallerCredential();

  let currentState = parsePluginInstallerStateV1(
    JSON.parse(
      await readFile(
        resolve(output, 'plugin-installer-state.json'),
        'utf8',
      ),
    ),
  );
  currentState = upgradePluginV1(
    currentState,
    secondaryUpgradeRecord,
    new Date().toISOString(),
  );
  await writeStateSnapshot(currentState);
  const secondaryUpgraded = applyLifecycle();
  if (
    secondaryUpgraded.status !== 'succeeded' ||
    secondaryUpgraded.operation !== 'upgrade' ||
    secondaryUpgraded.completedPhases.join(',') !==
      'stage,drain,deactivate,checkpoint,migrate,activate,ready,commit'
  ) {
    throw new Error(
      'Secondary Kubernetes upgrade lifecycle did not succeed',
    );
  }
  for (const deployment of [
    primaryDeployment,
    secondaryDeployment,
  ]) {
    kubectl([
      '--namespace',
      namespace,
      'rollout',
      'status',
      `deployment/${deployment}`,
      '--timeout=120s',
    ]);
  }
  verifySecondaryCapabilityIdentity('0.2.0');
  secondaryStorageProbe('verify', 1, 'upgrade');
  if (
    pluginPodIdentity(primaryPluginId) !==
    primaryPodBeforeSecondaryUpgrade
  ) {
    throw new Error(
      'Unrelated primary plugin restarted during secondary upgrade',
    );
  }

  currentState = parsePluginInstallerStateV1(
    JSON.parse(
      await readFile(
        resolve(output, 'plugin-installer-state.json'),
        'utf8',
      ),
    ),
  );
  currentState = rollbackPluginV1(
    currentState,
    secondaryPluginId,
    new Date().toISOString(),
  );
  await writeStateSnapshot(currentState);
  const secondaryRolledBack = applyLifecycle();
  if (
    secondaryRolledBack.status !== 'succeeded' ||
    secondaryRolledBack.operation !== 'rollback' ||
    secondaryRolledBack.completedPhases.join(',') !==
      'stage,drain,deactivate,checkpoint,migrate,activate,ready,commit'
  ) {
    throw new Error(
      'Secondary Kubernetes rollback lifecycle did not succeed',
    );
  }
  for (const deployment of [
    primaryDeployment,
    secondaryDeployment,
  ]) {
    kubectl([
      '--namespace',
      namespace,
      'rollout',
      'status',
      `deployment/${deployment}`,
      '--timeout=120s',
    ]);
  }
  verifySecondaryCapabilityIdentity('0.1.0');
  secondaryStorageProbe('verify', 0, 'rollback');
  if (
    pluginPodIdentity(primaryPluginId) !==
    primaryPodBeforeSecondaryUpgrade
  ) {
    throw new Error(
      'Unrelated primary plugin restarted during secondary rollback',
    );
  }

  currentState = parsePluginInstallerStateV1(
    JSON.parse(
      await readFile(
        resolve(output, 'plugin-installer-state.json'),
        'utf8',
      ),
    ),
  );
  currentState = upgradePluginV1(
    currentState,
    secondaryFailingUpgradeRecord,
    new Date().toISOString(),
  );
  await writeStateSnapshot(currentState);
  const secondaryMigrationFailed = applyLifecycle({
    acceptedStatuses: [3],
  });
  if (
    secondaryMigrationFailed.status !== 'failed' ||
    secondaryMigrationFailed.operation !== 'upgrade' ||
    secondaryMigrationFailed.reasonCode !== 'phase_failed' ||
    secondaryMigrationFailed.nextPhase !== 'migrate' ||
    secondaryMigrationFailed.completedPhases.join(',') !==
      'stage,drain,deactivate,checkpoint'
  ) {
    throw new Error(
      'Secondary Kubernetes migration failure was not contained',
    );
  }
  verifyFailedMigrationJob(secondaryMigrationFailed);
  kubectl([
    '--namespace',
    namespace,
    'rollout',
    'status',
    `deployment/${primaryDeployment}`,
    '--timeout=120s',
  ]);
  if (
    pluginPodIdentity(primaryPluginId) !==
    primaryPodBeforeSecondaryUpgrade
  ) {
    throw new Error(
      'Unrelated primary plugin restarted during failed secondary migration',
    );
  }

  mutateLifecycle([
    'rollback',
    '--plugin',
    secondaryPluginId,
    '--supersede-execution-revision',
    String(secondaryMigrationFailed.revision),
  ]);
  const secondaryMigrationRecovered = applyLifecycle({
    supersedeExecutionRevision: secondaryMigrationFailed.revision,
  });
  if (
    secondaryMigrationRecovered.status !== 'succeeded' ||
    secondaryMigrationRecovered.operation !== 'rollback' ||
    secondaryMigrationRecovered.completedPhases.join(',') !==
      'stage,drain,deactivate,checkpoint,migrate,activate,ready,commit'
  ) {
    throw new Error(
      'Secondary Kubernetes failed-migration recovery did not succeed',
    );
  }
  for (const deployment of [
    primaryDeployment,
    secondaryDeployment,
  ]) {
    kubectl([
      '--namespace',
      namespace,
      'rollout',
      'status',
      `deployment/${deployment}`,
      '--timeout=120s',
    ]);
  }
  verifySecondaryCapabilityIdentity('0.1.0');
  secondaryStorageProbe('verify', 0, 'rollback');
  if (
    pluginPodIdentity(primaryPluginId) !==
    primaryPodBeforeSecondaryUpgrade
  ) {
    throw new Error(
      'Unrelated primary plugin restarted during failed-migration recovery',
    );
  }

  verifyFailureFixtureImage(
    secondaryPluginV4Image,
    'readiness-fail',
  );
  await exerciseSecondaryRuntimeFailure(
    secondaryReadinessFailureRecord,
    'readiness',
    primaryPodBeforeSecondaryUpgrade,
  );
  verifyFailureFixtureImage(
    secondaryPluginV5Image,
    'crash',
  );
  await exerciseSecondaryRuntimeFailure(
    secondaryCrashFailureRecord,
    'process-crash',
    primaryPodBeforeSecondaryUpgrade,
  );

  mutateLifecycle(['disable', '--plugin', secondaryPluginId]);
  const secondaryDisabled = applyLifecycle();
  if (secondaryDisabled.status !== 'succeeded') {
    throw new Error(
      'Secondary Kubernetes disable lifecycle did not succeed',
    );
  }
  const disabledSecondaryDeployment = kubectl([
    '--namespace',
    namespace,
    'get',
    'deployment',
    secondaryDeployment,
    '--ignore-not-found',
    '--output',
    'name',
  ]);
  if (disabledSecondaryDeployment) {
    throw new Error(
      'Secondary plugin Deployment remained after disable',
    );
  }
  kubectl([
    '--namespace',
    namespace,
    'rollout',
    'status',
    `deployment/${primaryDeployment}`,
    '--timeout=120s',
  ]);

  mutateLifecycle([
    'uninstall',
    '--plugin',
    secondaryPluginId,
    '--data-action',
    'retain',
  ]);
  const secondaryUninstalled = applyLifecycle();
  if (secondaryUninstalled.status !== 'succeeded') {
    throw new Error(
      'Secondary Kubernetes uninstall/retain lifecycle did not succeed',
    );
  }
  kubectl([
    '--namespace',
    namespace,
    'rollout',
    'status',
    `deployment/${primaryDeployment}`,
    '--timeout=120s',
  ]);

  mutateLifecycle(['disable', '--plugin', primaryPluginId]);
  const primaryDisabled = applyLifecycle();
  if (primaryDisabled.status !== 'succeeded') {
    throw new Error(
      'Primary Kubernetes disable lifecycle did not succeed',
    );
  }
  const disabledPrimaryDeployment = kubectl([
    '--namespace',
    namespace,
    'get',
    'deployment',
    primaryDeployment,
    '--ignore-not-found',
    '--output',
    'name',
  ]);
  if (disabledPrimaryDeployment) {
    throw new Error(
      'Primary plugin Deployment remained after disable',
    );
  }

  mutateLifecycle([
    'uninstall',
    '--plugin',
    primaryPluginId,
    '--data-action',
    'export',
  ]);
  const primaryUninstalled = applyLifecycle();
  if (primaryUninstalled.status !== 'succeeded') {
    throw new Error(
      'Primary Kubernetes uninstall/export lifecycle did not succeed',
    );
  }

  const claims = JSON.parse(
    kubectl([
      '--namespace',
      namespace,
      'get',
      'persistentvolumeclaims',
      '--output',
      'json',
    ]),
  );
  const artifactClaim = claims.items.find(
    (claim) =>
      claim.metadata?.annotations?.[
        'io.enterpriseglue/storage-name'
      ] === 'lifecycle-artifacts',
  )?.metadata?.name;
  if (!artifactClaim) {
    throw new Error('Lifecycle artifact PVC was not retained');
  }

  const verifier = `eg-plugin-export-verifier-${process.pid}`;
  applyObject({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: verifier, namespace },
    spec: {
      restartPolicy: 'Never',
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 65532,
        runAsGroup: 65532,
        fsGroup: 65532,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: 'verify',
          image: installerImage,
          imagePullPolicy: 'IfNotPresent',
          command: [
            'node',
            '--input-type=module',
            '--eval',
            "import{readdir,readFile}from'node:fs/promises';import{resolve}from'node:path';let found=0;for(const root of await readdir('/artifacts'))for(const name of await readdir(resolve('/artifacts',root)))if(name==='export-manifest.json'){const value=JSON.parse(await readFile(resolve('/artifacts',root,name),'utf8'));if(value.kind!=='EnterpriseGluePluginDataExport'||value.artifacts?.length<1||!value.artifacts.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)&&x.sizeBytes>0))throw Error('invalid export');found++}if(found!==1)throw Error('missing export');console.log('verified')",
          ],
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
            runAsUser: 65532,
            capabilities: { drop: ['ALL'] },
          },
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '250m', memory: '128Mi' },
          },
          volumeMounts: [
            {
              name: 'artifacts',
              mountPath: '/artifacts',
              readOnly: true,
            },
            { name: 'tmp', mountPath: '/tmp' },
          ],
        },
      ],
      volumes: [
        {
          name: 'artifacts',
          persistentVolumeClaim: { claimName: artifactClaim },
        },
        {
          name: 'tmp',
          emptyDir: { medium: 'Memory', sizeLimit: '16Mi' },
        },
      ],
    },
  });
  kubectl([
    '--namespace',
    namespace,
    'wait',
    '--for=jsonpath={.status.phase}=Succeeded',
    `pod/${verifier}`,
    '--timeout=120s',
  ]);
  if (
    kubectl([
      '--namespace',
      namespace,
      'logs',
      verifier,
    ]) !== 'verified'
  ) {
    throw new Error('Kubernetes export evidence verification failed');
  }

  const configMaps = JSON.parse(
    kubectl([
      '--namespace',
      namespace,
      'get',
      'configmaps',
      '--output',
      'json',
    ]),
  );
  const receipts = configMaps.items.filter((item) =>
    item.metadata?.name?.startsWith('eg-plugin-effect-'),
  ).length;
  const version = JSON.parse(
    kubectl(['version', '--output', 'json']),
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      twoSequentialInstallsApplied: true,
      twoPluginsEnabledReady: true,
      resourceIsolationVerified: true,
      permissionIsolationVerified: true,
      networkPolicyProjectionVerified: true,
      secondaryCapabilityVersionsVerified: ['0.1.0', '0.2.0'],
      secondaryUpgradeIsolated: true,
      secondaryRollbackIsolated: true,
      secondaryMigrationUpgradeVerified: true,
      secondaryMigrationRollbackVerified: true,
      secondaryMigrationFailureContained: true,
      secondaryMigrationFailureRecovered: true,
      secondaryReadinessFailureContained: true,
      secondaryReadinessFailureRecovered: true,
      secondaryProcessCrashContained: true,
      secondaryProcessCrashRecovered: true,
      migratedPayloadPreserved: true,
      unrelatedPrimaryPodPreserved: true,
      secondaryDisableIsolated: true,
      secondaryUninstallRetainIsolated: true,
      primaryDisabledRemoved: true,
      uninstallExportVerified: true,
      restrictedInstallerRbacVerified: true,
      restrictedInstallerCredentialRotated,
      restrictedInstallerCredentialDurationSeconds: 900,
      executionReceipts: receipts,
      kubernetesServer: version.serverVersion?.gitVersion ?? 'unknown',
    }),
  );
}

let passed = false;
try {
  await main();
  passed = true;
} finally {
  if (!passed && process.env.EG_PLUGIN_KEEP_FAILED === 'true') {
    console.error(`Preserved failed lifecycle fixture at ${project}`);
    console.error(`Preserved failed namespace ${namespace}`);
    process.exitCode = 1;
  } else {
    if (namespaceCreated) {
      spawnSync(
        'kubectl',
        [
          '--kubeconfig',
          kubeconfig,
          '--context',
          context,
          'delete',
          'namespace',
          namespace,
          '--wait=true',
        ],
        { cwd: root, stdio: 'ignore' },
      );
    }
    await rm(project, { recursive: true, force: true });
  }
}
