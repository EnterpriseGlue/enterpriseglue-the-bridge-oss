import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// Tests are hermetic by default: a developer's .env or .env.selfhost must not
// change unit behavior or leak infrastructure metadata into CI output. A
// protocol rehearsal may explicitly opt in with EG_LOAD_ENV_IN_TESTS=true.
const shouldLoadEnvironmentFile = process.env.NODE_ENV !== 'test'
  || process.env.EG_LOAD_ENV_IN_TESTS === 'true';

if (shouldLoadEnvironmentFile) {
  // Load the first matching env file before either the database-only or full
  // application configuration reads process.env.
  const envFileCandidates = [
    process.env.EG_ENV_FILE,
    path.resolve(process.cwd(), '.env.selfhost'),
    path.resolve(process.cwd(), '..', '.env.selfhost'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ];

  const envFilePath = envFileCandidates.find(candidate => candidate && fs.existsSync(candidate));
  if (envFilePath) dotenv.config({ path: envFilePath });
  else dotenv.config();
}
