#!/usr/bin/env node

const response = await fetch('http://127.0.0.1:8080/_plugin/health', {
  signal: AbortSignal.timeout(1_500),
});
if (!response.ok) process.exit(1);
const body = await response.json();
if (body?.status !== 'alive') process.exit(1);
