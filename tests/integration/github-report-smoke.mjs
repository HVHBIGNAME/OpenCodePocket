import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createBridge } from '../../packages/bridge/dist/server.js';

const directory = resolve('.cache', 'github-report-smoke');
await mkdir(directory, { recursive: true });
const bridge = await createBridge({
  upstream: 'http://127.0.0.1:4097',
  port: 0,
  stateDirectory: directory,
  subscribe: false,
  reports: { github: true, repository: 'HVHBIGNAME/OpenCodePocket', useGhCli: true },
  log: console.error,
});
try {
  const pair = bridge.createPairing();
  const response = await fetch(`${bridge.localUrl}/occ/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pair.code, name: 'Diagnostic test' }),
  });
  const credentials = await response.json();
  const diagnostic = {
    schema: 1,
    id: randomUUID(),
    timestamp: Date.now(),
    version: '1.0.0',
    platform: 'web',
    kind: 'test',
    severity: 'warning',
    name: 'DiagnosticSmokeTest',
    operation: 'unknown',
    screen: 'settings',
    frames: ['diagnostics-selftest.js:1:1'],
  };
  const receipt = await fetch(`${bridge.localUrl}/occ/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.token}` },
    body: JSON.stringify({ reports: [diagnostic] }),
  });
  assert.equal(receipt.status, 200);
  await bridge.reports.flush();
  const report = bridge.reports.summary().reports.find((item) => item.name === 'DiagnosticSmokeTest');
  assert(report?.issueURL, bridge.reports.summary().lastError ?? 'No issue URL');
  console.log(`PASS real GitHub report delivery: ${report.issueURL}`);
  const number = report.issueURL.split('/').pop();
  const closed = spawnSync(
    'gh',
    [
      'issue',
      'close',
      number,
      '--repo',
      'HVHBIGNAME/OpenCodePocket',
      '--comment',
      'Verified the automatic redacted report pipeline end to end. Closing this intentional smoke-test report; it is not an application defect.',
    ],
    { encoding: 'utf8', timeout: 20000 },
  );
  if (closed.status !== 0) throw new Error(closed.stderr);
  console.log(`Test issue closed. Local evidence: ${join(directory, 'reports.json')}`);
} finally {
  await bridge.close();
}
