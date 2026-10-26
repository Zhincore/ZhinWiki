import { readFile } from 'node:fs/promises';

const [workflow, release, dockerfile, compose, prodCompose, prodEnv, runbook] = await Promise.all([
  readFile('.github/workflows/docker.yml', 'utf8'),
  readFile('.github/workflows/release.yml', 'utf8'),
  readFile('Dockerfile', 'utf8'),
  readFile('docker-compose.coolify.yml', 'utf8'),
  readFile('docker-compose.prod.yml', 'utf8'),
  readFile('.env.production.example', 'utf8'),
  readFile('operations/deployment-reliability.md', 'utf8'),
]);

const requireMatch = (condition, message) => {
  if (!condition) throw new Error(`Release contract invalid: ${message}`);
};

const triggers = workflow.split(/^on:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
requireMatch(/^ {2}workflow_dispatch:/m.test(triggers) && /^ {2}workflow_call:/m.test(triggers), 'Docker workflow must be dispatchable and callable');
requireMatch(!/^ {2}(push|pull_request|pull_request_target|schedule):/m.test(triggers), 'Docker workflow must never build implicitly');
requireMatch(workflow.includes('scripts/reject-existing-immutable-tags.mjs'), 'publishing must reject existing immutable tags');
requireMatch(workflow.includes('scripts/verify-published-image.mjs'), 'publishing must verify the pushed digest');
requireMatch(/uses: \.\/\.github\/workflows\/docker\.yml/.test(release), 'release tags must build the image');
requireMatch(
  /image_tag: \$\{\{ github\.ref_name \}\}/.test(release) && /publish: true/.test(release),
  'release tags must publish the version-tagged image',
);
requireMatch(workflow.includes('actions/attest@v4'), 'published images need source provenance');
requireMatch(dockerfile.includes('FROM node:22-alpine'), 'production must stay on Node 22');
requireMatch(dockerfile.includes('org.opencontainers.image.revision=$REVISION'), 'image must carry the exact source revision');

const pinned = prodCompose.match(/NIBLEAF_VERSION:-(v[^}]+)\}/)?.[1];
requireMatch(pinned && prodEnv.includes(`\nNIBLEAF_VERSION=${pinned}\n`), 'production Compose and env template must pin the same release');

for (const service of ['server', 'worker', 'app', 'admin']) {
  const section = compose.split(`  ${service}:`)[1]?.split(/\n {2}[a-z][a-z-]+:/)[0] ?? '';
  requireMatch(section.includes('healthcheck:'), `${service} requires a healthcheck`);
  requireMatch(section.includes('init: true'), `${service} requires an init process`);
  requireMatch(section.includes('stop_grace_period:'), `${service} requires a graceful stop window`);
}
requireMatch(compose.includes('PORT: "4315"') && compose.includes('"4315"'), 'admin must preserve the 4315 service contract');
requireMatch(/does\s+not support application-level rolling updates/.test(runbook), 'runbook must state the Compose limitation');
requireMatch(runbook.includes('Docker Image applications'), 'runbook must define the eligible rolling architecture');

process.stdout.write('Release contract is internally consistent.\n');
