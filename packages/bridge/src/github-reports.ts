import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Diagnostic } from '../../../shared/diagnostics';

const exec = promisify(execFile);
export type ReportOptions = {
  github: boolean;
  repository: string;
  token?: string;
  apiBase?: string;
  useGhCli?: boolean;
};
export type ReportGroup = {
  fingerprint: string;
  sample: Diagnostic;
  count: number;
  firstSeen: number;
  lastSeen: number;
  issueURL?: string;
  issueNumber?: number;
  deliveredCount?: number;
  lastDelivery?: number;
};

export class GithubReports {
  private authorization?: { token: string; expires: number };
  private labelReady = false;
  constructor(readonly options: ReportOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository)) throw new Error('Invalid report repository');
  }

  private async token() {
    if (this.options.token) return this.options.token;
    if (this.authorization && this.authorization.expires > Date.now()) return this.authorization.token;
    if (this.options.useGhCli === false) throw new Error('GitHub authorization is not configured');
    try {
      const { stdout } = await exec('gh', ['auth', 'token', '--hostname', 'github.com'], {
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 8192,
      });
      const token = stdout.trim();
      if (!token) throw new Error('Empty GitHub credential');
      this.authorization = { token, expires: Date.now() + 10 * 60_000 };
      return token;
    } catch {
      throw new Error('Run gh auth login on the computer, or configure OCC_REPORTS_GITHUB_TOKEN');
    }
  }

  private async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    allowExistingLabel = false,
  ): Promise<T> {
    const response = await fetch(`${this.options.apiBase ?? 'https://api.github.com'}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'OpenCodePocket-reports',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (allowExistingLabel && response.status === 422) return undefined as T;
    if (!response.ok) {
      if (response.status === 401) this.authorization = undefined;
      throw new Error(`GitHub reports HTTP ${response.status}; check repository Issues write permission`);
    }
    return response.json() as Promise<T>;
  }

  async deliver(group: ReportGroup): Promise<{ number: number; url: string; count: number }> {
    const root = `/repos/${this.options.repository}`;
    if (!this.labelReady) {
      await this.request(
        `${root}/labels`,
        'POST',
        {
          name: 'occ-client-report',
          color: 'd2ff5a',
          description: 'Automatic, redacted OpenCode Pocket diagnostics',
        },
        true,
      );
      this.labelReady = true;
    }
    let number = group.issueNumber;
    let url = group.issueURL;
    if (!number) {
      for (let page = 1; page <= 5; page++) {
        const issues = await this.request<{ number: number; html_url: string; title: string }[]>(
          `${root}/issues?state=all&labels=occ-client-report&per_page=100&page=${page}`,
        );
        const found = issues.find((issue) => issue.title.includes(`[${group.fingerprint}]`));
        if (found) {
          number = found.number;
          url = found.html_url;
          break;
        }
        if (issues.length < 100) break;
      }
    }
    if (number && url) {
      if (
        group.deliveredCount !== undefined &&
        group.count > group.deliveredCount &&
        Date.now() - (group.lastDelivery ?? 0) > 60 * 60_000
      ) {
        await this.request(`${root}/issues/${number}/comments`, 'POST', {
          body: `OCC observed **${group.count - group.deliveredCount} additional occurrences** on this companion.\n\nLast seen: ${new Date(group.lastSeen).toISOString()}. Version: \`${group.sample.version}\`.\n\nNo prompts, source files, credentials, or server addresses are included.`,
        });
      }
      return { number, url, count: group.count };
    }
    const sample = group.sample;
    const body = `## Automatic OCC client report\n\n| Field | Value |\n| --- | --- |\n| Version | \`${sample.version}\` |\n| Platform | \`${sample.platform}\` ${sample.osVersion ?? ''} |\n| Severity | \`${sample.severity}\` |\n| Kind | \`${sample.kind}\` |\n| Operation | \`${sample.operation}\` |\n| Screen | \`${sample.screen}\` |\n| HTTP status | ${sample.httpStatus ?? 'n/a'} |\n| Occurrences on this companion | ${group.count} |\n| First seen | ${new Date(group.firstSeen).toISOString()} |\n| Last seen | ${new Date(group.lastSeen).toISOString()} |\n\n### Code locations\n\n\`\`\`text\n${sample.frames.join('\n') || 'No stack locations available'}\n\`\`\`\n\nFingerprint: \`${group.fingerprint}\`\n\n${sample.kind === 'test' ? '**This is a diagnostic pipeline smoke test, not an application defect.**\n\n' : ''}Only allowlisted technical fields are transmitted. Error message text, prompts, source files, API keys, session contents, device identifiers, and server addresses are excluded.\n\nGenerated by the user's OCC companion; GitHub authorization stays on their computer.`;
    const issue = await this.request<{ number: number; html_url: string }>(`${root}/issues`, 'POST', {
      title: `[OCC ${sample.version}] ${sample.platform} ${sample.name} · ${sample.operation} [${group.fingerprint}]`,
      body,
      labels: ['occ-client-report'],
    });
    return { number: issue.number, url: issue.html_url, count: group.count };
  }
}
