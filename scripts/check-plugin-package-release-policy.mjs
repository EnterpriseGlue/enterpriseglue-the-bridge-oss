import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../.github/workflows/plugin-package-release.yml', import.meta.url),
  'utf8',
);
const tarballVerifier = await readFile(
  new URL('./verify-plugin-package-tarballs.mjs', import.meta.url),
  'utf8',
);
const versionDiscipline = await readFile(
  new URL('./check-published-package-version-discipline.sh', import.meta.url),
  'utf8',
);
const versionAuthority = JSON.parse(await readFile(
  new URL('./package-version-authority.json', import.meta.url),
  'utf8',
));

assert.match(workflow, /\bon:\n  release:\n/);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^  (?:push|pull_request|pull_request_target|schedule):/m);
assert.match(workflow, /environment: plugin-packages-production/);
assert.match(workflow, /refs\/tags\/\$RELEASE_TAG/);
assert.match(workflow, /refs\/heads\/main/);
assert.match(workflow, /git merge-base --is-ancestor "\$SOURCE_REF" refs\/remotes\/origin\/main/);
assert.match(workflow, /source_ref must be an immutable 40-character commit/);
assert.match(workflow, /A non-current source_ref requires an exact release_tag/);
assert.match(workflow, /git rev-list -n 1/);
assert.match(workflow, /gh release view/);
assert.match(workflow, /fetch-release-candidate\.sh/);
assert.match(workflow, /cp "\$CANDIDATE_PAYLOAD"\/packages\/plugin\/\*\.tgz/);
assert.match(workflow, /packages\/enterprise-plugin-api pack/);
assert.match(workflow, /test -z "\$\(git status --porcelain\)"/);
assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
assert.match(workflow, /name: Install fallback build dependencies\n\s+if: steps\.source\.outputs\.candidate_required != 'true'/);
assert.match(workflow, /name: Test and build fallback public packages\n\s+if: steps\.source\.outputs\.candidate_required != 'true'/);
assert.match(workflow, /plugin-sdk run test/);
assert.match(workflow, /plugin-runtime run test/);
assert.match(workflow, /plugin-installer run test/);
assert.match(workflow, /plugin-manager run test/);
assert.match(workflow, /verify-plugin-package-tarballs\.mjs/);
assert.match(workflow, /Verify existing versions or plan new immutable publications/);
assert.match(workflow, /Publish packages in dependency order/);
assert.match(workflow, /publish-plugin-package-set\.mjs plan/);
assert.match(workflow, /publish-plugin-package-set\.mjs publish/);
assert.match(workflow, /publish-plugin-package-set\.mjs verify/);
assert.match(workflow, /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/);
assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?:main|master|v?\d+(?:\.\d+){0,2})\s*$/m);
assert.match(tarballVerifier, /packages\/enterprise-plugin-api\/package\.json/);
assert.match(tarballVerifier, /packages\/plugin-sdk\/package\.json/);
assert.match(tarballVerifier, /packages\/plugin-runtime\/package\.json/);
assert.match(tarballVerifier, /packages\/plugin-installer\/package\.json/);
assert.match(tarballVerifier, /packages\/plugin-manager\/package\.json/);
assert.doesNotMatch(
  tarballVerifier,
  /\['@enterpriseglue\/plugin-(?:sdk|runtime|installer|manager)',\s*'\d+\.\d+\.\d+'/,
);
assert.match(versionDiscipline, /package-version-plan\.mjs check/);
assert.ok(
  versionAuthority.sourceChangeExcludes.includes('^Dockerfile(?:\\..*)?$'),
  'container-only Dockerfiles must not force an npm package release',
);
assert.deepEqual(
  versionAuthority.publicationSets.find(({ id }) => id === 'plugin-platform-packages')?.packages,
  [
    '@enterpriseglue/enterprise-plugin-api',
    '@enterpriseglue/plugin-sdk',
    '@enterpriseglue/plugin-runtime',
    '@enterpriseglue/plugin-installer',
    '@enterpriseglue/plugin-manager',
  ],
);

const packageSetPublisher = await readFile(
  new URL('./publish-plugin-package-set.mjs', import.meta.url),
  'utf8',
);
assert.match(packageSetPublisher, /dist\.integrity/);
assert.match(packageSetPublisher, /canonicalPackageDigest/);
assert.match(packageSetPublisher, /path !== 'package\/package\.json'/);
assert.match(packageSetPublisher, /canonicalJsonValue/);
assert.match(packageSetPublisher, /npm[\s\S]*pack/);
assert.match(packageSetPublisher, /different immutable payload/);
assert.match(packageSetPublisher, /registry payload differs after publication/);
assert.match(packageSetPublisher, /publicationOrder/);
assert.match(packageSetPublisher, /plugin-platform-packages/);

const hostPackageSetPublisher = await readFile(
  new URL('./publish-host-package-set.mjs', import.meta.url),
  'utf8',
);
assert.match(hostPackageSetPublisher, /publicationOrder/);
assert.match(hostPackageSetPublisher, /host-packages/);

console.log(JSON.stringify({ status: 'passed', packages: 5, customerCiRequired: false }));
