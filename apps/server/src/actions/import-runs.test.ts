import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Run = {
  id: string;
  projectId: string;
  source: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  summary: unknown;
  error: string | null;
  createdById: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const db = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  const runs: Run[] = [];
  const active = (run: Run) => run.status === 'PENDING' || run.status === 'RUNNING';
  const matches = (
    run: Run,
    where: {
      id?: string | { in: string[] };
      projectId?: string;
      source?: string;
      status?: string | { in: string[] };
      updatedAt?: { lt?: Date; gte?: Date };
    },
  ) =>
    (where.id === undefined || (typeof where.id === 'string' ? run.id === where.id : where.id.in.includes(run.id))) &&
    (where.projectId === undefined || run.projectId === where.projectId) &&
    (where.source === undefined || run.source === where.source) &&
    (where.status === undefined || (typeof where.status === 'string' ? run.status === where.status : where.status.in.includes(run.status))) &&
    (where.updatedAt?.lt === undefined || run.updatedAt < where.updatedAt.lt) &&
    (where.updatedAt?.gte === undefined || run.updatedAt >= where.updatedAt.gte);
  const apply = (run: Run, data: Partial<Run>) => Object.assign(run, data, { updatedAt: data.updatedAt ?? new Date() });
  return {
    PrismaClientKnownRequestError,
    runs,
    branchDeleteMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
    importRun: {
      create: vi.fn(async ({ data }: { data: { projectId: string; source: string; createdById: string } }) => {
        if (runs.some((run) => run.projectId === data.projectId && active(run))) throw new PrismaClientKnownRequestError('unique', 'P2002');
        const now = new Date();
        const run: Run = {
          id: `run-${runs.length + 1}`,
          status: 'PENDING',
          summary: null,
          error: null,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        runs.push(run);
        return { ...run };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Run> }) => {
        const run = runs.find((candidate) => candidate.id === where.id);
        if (!run) throw new Error('not found');
        return { ...apply(run, data) };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Parameters<typeof matches>[1]; data: Partial<Run> }) => {
        const hit = runs.filter((run) => matches(run, where));
        for (const run of hit) apply(run, data);
        return { count: hit.length };
      }),
      findMany: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) =>
        runs.filter((run) => matches(run, where)).map((run) => ({ ...run })),
      ),
      count: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => runs.filter((run) => matches(run, where)).length),
      findFirst: vi.fn(async ({ where }: { where: { projectId: string } }) => {
        const found = runs.filter((run) => run.projectId === where.projectId).at(-1);
        return found ? { ...found } : null;
      }),
    },
    notify: vi.fn(async (..._args: unknown[]) => ({ created: 1 })),
    track: vi.fn(async (..._args: unknown[]) => undefined),
  };
});

vi.mock('@nibleaf/database', () => ({
  Prisma: { PrismaClientKnownRequestError: db.PrismaClientKnownRequestError },
  prisma: {
    importRun: db.importRun,
    branch: { deleteMany: db.branchDeleteMany },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  },
}));
vi.mock('@nibleaf/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('./analytics', () => ({ trackProjectEvent: db.track }));
vi.mock('./notifications', () => ({ createNotificationsForOrgMembers: db.notify }));

import { badRequest } from '@/errors';
import { getLatestImportRun, startImportRun } from './import-runs';

const summary = { imported: 3, updated: 1, skipped: 0, warnings: ['one'] };
const settle = () => vi.waitFor(() => expect(db.runs.every((run) => run.status === 'SUCCEEDED' || run.status === 'FAILED')).toBe(true));

beforeEach(() => {
  db.runs.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startImportRun', () => {
  it('answers with the pending run and finishes the import in the background', async () => {
    let finish: (value: typeof summary) => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<typeof summary>((resolve) => {
          finish = resolve;
        }),
    );

    const run = await startImportRun({ projectId: 'p1', userId: 'u1', source: 'mintlify', task });

    expect(run).toMatchObject({ id: 'run-1', source: 'mintlify', status: 'PENDING', summary: null });
    await vi.waitFor(() => expect(task).toHaveBeenCalled());
    expect(db.runs[0]?.status).toBe('RUNNING');
    finish(summary);
    await settle();

    expect(db.runs[0]).toMatchObject({ status: 'SUCCEEDED', summary, error: null });
    expect(db.runs[0]?.completedAt).toBeInstanceOf(Date);
    // The starter is notified too: nobody else sees the result of a background run.
    expect(db.notify).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'import_completed' }));
    expect(db.notify.mock.calls[0]).toHaveLength(2);
    expect(db.track).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'import_completed', itemCount: 4 }), { source: 'dashboard' });
  });

  it('records an importer error message and hides unexpected ones', async () => {
    await startImportRun({
      projectId: 'p1',
      userId: 'u1',
      source: 'mintlify',
      task: () => Promise.reject(badRequest('Repository or branch not found.')),
    });
    await settle();
    expect(db.runs[0]).toMatchObject({ status: 'FAILED', error: 'Repository or branch not found.' });
    expect(db.notify).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'import_failed' }));

    await startImportRun({ projectId: 'p2', userId: 'u1', source: 'ghost', task: () => Promise.reject(new Error('socket hang up')) });
    await settle();
    expect(db.runs[1]).toMatchObject({ status: 'FAILED', error: 'The import failed unexpectedly. Try again shortly.' });
  });

  it('refuses a second import of the same project while one is active', async () => {
    await startImportRun({ projectId: 'p1', userId: 'u1', source: 'mintlify', task: () => new Promise(() => undefined) });

    await expect(startImportRun({ projectId: 'p1', userId: 'u1', source: 'ghost', task: async () => summary })).rejects.toMatchObject({
      code: 'import:in_progress',
      status: 409,
    });
    await expect(startImportRun({ projectId: 'p2', userId: 'u1', source: 'ghost', task: async () => summary })).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('refuses a GitBook import while the instance runs its maximum, ignoring stale runs', async () => {
    const pending = () => new Promise<typeof summary>(() => undefined);
    await startImportRun({ projectId: 'p1', userId: 'u1', source: 'gitbook', task: pending });
    await startImportRun({ projectId: 'p2', userId: 'u1', source: 'gitbook', task: pending });

    await expect(startImportRun({ projectId: 'p3', userId: 'u1', source: 'gitbook', task: pending })).rejects.toMatchObject({ code: 'import:busy' });
    await expect(startImportRun({ projectId: 'p3', userId: 'u1', source: 'mintlify', task: pending })).resolves.toMatchObject({ status: 'PENDING' });

    await vi.waitFor(() => expect(db.runs[0]?.status).toBe('RUNNING'));
    (db.runs[0] as Run).updatedAt = new Date(Date.now() - 3 * 60_000);
    await expect(startImportRun({ projectId: 'p4', userId: 'u1', source: 'gitbook', task: pending })).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('keeps a long import alive with a heartbeat', async () => {
    vi.useFakeTimers();
    await startImportRun({ projectId: 'p1', userId: 'u1', source: 'mintlify', task: () => new Promise(() => undefined) });
    await vi.waitFor(() => expect(db.runs[0]?.status).toBe('RUNNING'));
    db.importRun.updateMany.mockClear();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(db.importRun.updateMany).toHaveBeenCalledWith({ where: { id: 'run-1', status: 'RUNNING' }, data: { updatedAt: expect.any(Date) } });
  });
});

describe('getLatestImportRun', () => {
  it('fails a run whose heartbeat stopped and drops its import branches', async () => {
    await startImportRun({ projectId: 'p1', userId: 'u1', source: 'mintlify', task: () => new Promise(() => undefined) });
    await vi.waitFor(() => expect(db.runs[0]?.status).toBe('RUNNING'));
    const run = db.runs[0] as Run;
    run.updatedAt = new Date(Date.now() - 3 * 60_000);

    const latest = await getLatestImportRun('p1');

    expect(latest).toMatchObject({ id: 'run-1', status: 'FAILED', error: expect.stringMatching(/stopped unexpectedly/) });
    expect(db.branchDeleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', isDefault: false, OR: [{ name: { startsWith: 'import-mintlify-' } }] },
    });
    // A dead run no longer blocks the next import.
    await expect(startImportRun({ projectId: 'p1', userId: 'u1', source: 'mintlify', task: async () => summary })).resolves.toMatchObject({
      id: 'run-2',
    });
  });

  it('leaves a run with a fresh heartbeat alone', async () => {
    await startImportRun({ projectId: 'p1', userId: 'u1', source: 'mintlify', task: () => new Promise(() => undefined) });
    await vi.waitFor(() => expect(db.runs[0]?.status).toBe('RUNNING'));

    await expect(getLatestImportRun('p1')).resolves.toMatchObject({ status: 'RUNNING' });
    expect(db.branchDeleteMany).not.toHaveBeenCalled();
  });

  it('returns null when the project never imported', async () => {
    await expect(getLatestImportRun('p1')).resolves.toBeNull();
  });
});
