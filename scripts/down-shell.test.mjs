import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A fake docker executable exercises the actual script and records exact argv;
// this test never operates on a developer's Compose stack.
for (const args of [[], ['--remove-orphans'], ['--db', 'mysql'], ['--db', 'mysql', '-v', '--timeout', '30']]) {
  for (const hasEnvironment of [false, true]) {
    test(`shutdown forwards ${JSON.stringify(args)} (env=${hasEnvironment})`, () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'eg-down-'));
      try {
        cpSync(new URL('../down.sh', import.meta.url), path.join(directory, 'down.sh'));
        mkdirSync(path.join(directory, 'bin'));
        const docker = path.join(directory, 'bin', 'docker');
        writeFileSync(docker, '#!/bin/bash\nprintf "%s\\0" "$@" > "$ARGV_FILE"\n');
        chmodSync(docker, 0o755);
        if (hasEnvironment) {
          mkdirSync(path.join(directory, '.local/docker/env'), { recursive: true });
          for (const file of ['docker.env', 'docker.mysql.env']) {
            writeFileSync(path.join(directory, '.local/docker/env', file), 'DATABASE_TYPE=postgres\n');
          }
        }
        const result = spawnSync('/bin/bash', [path.join(directory, 'down.sh'), ...args], {
          encoding: 'utf8',
          env: { PATH: `${directory}/bin:${process.env.PATH}`, ARGV_FILE: `${directory}/argv`, EG_COMPOSE_CI: '1' },
        });
        assert.equal(result.status, 0, result.stderr);
        const argv = readFileSync(`${directory}/argv`, 'utf8').split('\0').slice(0, -1);
        const forwarded = args.filter((arg, index) => arg !== '--db' && args[index - 1] !== '--db');
        assert.deepEqual(argv.slice(argv.indexOf('down') + 1), forwarded);
        assert.equal(argv.includes('infra/docker/compose/docker-compose.mysql.yml'), args.includes('mysql'));
        assert.equal(argv.includes('--env-file'), hasEnvironment);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}
