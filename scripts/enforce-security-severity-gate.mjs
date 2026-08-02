import { pathToFileURL } from 'node:url';

function parseFindingCount(value, severity) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new Error(`${severity} vulnerability count must be a non-negative integer`);
  }
  return Number.parseInt(value, 10);
}

export function evaluateSecuritySeverityGate({ critical, high }) {
  const criticalCount = parseFindingCount(critical, 'Critical');
  const highCount = parseFindingCount(high, 'High');
  return {
    blocked: criticalCount > 0 || highCount > 0,
    critical: criticalCount,
    high: highCount,
  };
}

function main() {
  try {
    const result = evaluateSecuritySeverityGate({
      critical: process.env.CRITICAL_FINDINGS,
      high: process.env.HIGH_FINDINGS,
    });
    if (result.blocked) {
      console.error(
        `Nightly security drift found ${result.critical} critical and ${result.high} high vulnerabilities. Review the uploaded reports and tracking issue.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('Nightly security gate passed: no unignored critical or high vulnerabilities.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
