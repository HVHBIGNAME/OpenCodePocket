import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DiagnosticSchema, type Diagnostic, type DiagnosticSummary } from '../../../shared/diagnostics';
import { atomicJson } from './state';
import { GithubReports, type ReportGroup, type ReportOptions } from './github-reports';

type ReportState = { groups: ReportGroup[]; seen: string[] };

export class ReportService {
  private state: ReportState = { groups: [], seen: [] };
  private writes = Promise.resolve();
  private worker?: Promise<void>;
  private retryTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private lastError?: string;
  private mirror: GithubReports;
  private deliveriesToday = 0;
  private deliveryDay = new Date().toISOString().slice(0, 10);
  private limits = new Map<string, { count: number; until: number }>();

  constructor(
    private directory: string,
    readonly options: ReportOptions,
    private log: (message: string) => void,
  ) {
    this.mirror = new GithubReports(options);
  }

  async load() {
    try {
      const input = JSON.parse(await readFile(join(this.directory, 'reports.json'), 'utf8')) as ReportState;
      if (!Array.isArray(input.groups) || !Array.isArray(input.seen)) throw new Error('Invalid report store');
      for (const group of input.groups) DiagnosticSchema.parse(group.sample);
      this.state = input;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.retryTimer = setInterval(() => {
      void this.flush();
    }, 60_000);
    this.retryTimer.unref();
    void this.flush();
  }

  async accept(deviceID: string, reports: Diagnostic[]): Promise<string[]> {
    const previous = this.limits.get(deviceID);
    const limit =
      previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 60_000 };
    if (limit.count + reports.length > 60) throw new Error('Diagnostic rate limit reached');
    limit.count += reports.length;
    this.limits.set(deviceID, limit);
    const accepted: string[] = [];
    for (const input of reports) {
      const report = DiagnosticSchema.parse(input);
      accepted.push(report.id);
      if (this.state.seen.includes(report.id)) continue;
      this.state.seen.push(report.id);
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            report.version,
            report.platform,
            report.kind,
            report.name,
            report.operation,
            report.httpStatus,
            report.frames,
          ]),
        )
        .digest('hex')
        .slice(0, 16);
      const group = this.state.groups.find((item) => item.fingerprint === fingerprint);
      if (group) {
        group.count++;
        group.lastSeen = Math.max(group.lastSeen, report.timestamp);
      } else
        this.state.groups.push({
          fingerprint,
          sample: report,
          count: 1,
          firstSeen: report.timestamp,
          lastSeen: report.timestamp,
        });
    }
    this.state.seen = this.state.seen.slice(-5000);
    this.state.groups = this.state.groups.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 500);
    await this.save();
    void this.flush();
    return accepted;
  }

  summary(): DiagnosticSummary {
    return {
      enabled: this.options.github,
      repository: this.options.repository,
      groups: this.state.groups.length,
      pending: this.state.groups.filter((group) => group.count > (group.deliveredCount ?? 0)).length,
      lastDelivery:
        this.state.groups.reduce((last, group) => Math.max(last, group.lastDelivery ?? 0), 0) || undefined,
      lastError: this.lastError,
      reports: this.state.groups.slice(0, 25).map((group) => ({
        fingerprint: group.fingerprint,
        kind: group.sample.kind,
        name: group.sample.name,
        count: group.count,
        version: group.sample.version,
        platform: group.sample.platform,
        lastSeen: group.lastSeen,
        issueURL: group.issueURL,
      })),
    };
  }

  flush(): Promise<void> {
    if (!this.options.github || this.stopped) return Promise.resolve();
    if (this.worker) return this.worker;
    this.worker = this.drain()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Diagnostic delivery failed';
        if (this.lastError !== message) this.log(message);
        this.lastError = message;
      })
      .finally(() => {
        this.worker = undefined;
      });
    return this.worker;
  }

  private async drain() {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.deliveryDay) {
      this.deliveryDay = day;
      this.deliveriesToday = 0;
    }
    for (const group of this.state.groups) {
      if (this.stopped || this.deliveriesToday >= 20) break;
      if (group.count <= (group.deliveredCount ?? 0)) continue;
      if (group.lastDelivery && Date.now() - group.lastDelivery < 60 * 60_000) continue;
      const result = await this.mirror.deliver({ ...group });
      group.issueNumber = result.number;
      group.issueURL = result.url;
      group.deliveredCount = result.count;
      group.lastDelivery = Date.now();
      this.deliveriesToday++;
      this.lastError = undefined;
      await this.save();
    }
  }

  private save() {
    const snapshot = JSON.stringify(this.state);
    const write = this.writes.then(() =>
      atomicJson(join(this.directory, 'reports.json'), JSON.parse(snapshot)),
    );
    this.writes = write.catch(() => undefined);
    return write;
  }

  async close() {
    this.stopped = true;
    clearInterval(this.retryTimer);
    await this.worker;
    await this.writes;
  }
}

export function reportOptions(settings: {
  reportsGithub: boolean;
  reportsRepository: string;
}): ReportOptions {
  return {
    github: process.env.OCC_REPORTS_GITHUB === '0' ? false : settings.reportsGithub,
    repository: process.env.OCC_REPORTS_REPOSITORY ?? settings.reportsRepository,
    token: process.env.OCC_REPORTS_GITHUB_TOKEN,
    useGhCli: true,
  };
}
