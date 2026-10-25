import { type ImportRun, Prisma, prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';
import { AppError, conflict } from '@/errors';
import { trackProjectEvent } from './analytics';
import type { ImportSummary, importers } from './importers';
import { createNotificationsForOrgMembers } from './notifications';

/** A RUNNING run refreshes `updatedAt` this often while its import works. */
const HEARTBEAT_MS = 30_000;
/** A run whose heartbeat is older than this died with its process (restart, crash). */
const STALE_MS = 2 * 60_000;
const ACTIVE_STATUSES = ['PENDING', 'RUNNING'] as const;

const STALE_ERROR = 'The import stopped unexpectedly (the server may have restarted). Start it again.';
const UNEXPECTED_ERROR = 'The import failed unexpectedly. Try again shortly.';

export type ImportRunSource = keyof typeof importers;

const SOURCE_LABELS: Record<ImportRunSource, string> = { ghost: 'Ghost', gitbook: 'GitBook', mintlify: 'Mintlify' };

/** What the dashboard sees of a run. */
export const toImportRunView = (run: ImportRun) => ({
  id: run.id,
  source: run.source,
  status: run.status,
  summary: (run.summary as ImportSummary | null) ?? null,
  error: run.error,
  createdAt: run.createdAt,
  startedAt: run.startedAt,
  completedAt: run.completedAt,
});

export type ImportRunView = ReturnType<typeof toImportRunView>;

/**
 * Fail the project's active runs whose heartbeat stopped, and drop the import
 * replacement branches they left behind. Safe because at most one run per
 * project is active, so no live import owns those branches.
 */
export const failStaleImportRuns = async (projectId: string): Promise<void> => {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.importRun.findMany({
    where: { projectId, status: { in: [...ACTIVE_STATUSES] }, updatedAt: { lt: cutoff } },
    select: { id: true, source: true },
  });
  if (stale.length === 0) return;
  await prisma.$transaction([
    prisma.importRun.updateMany({
      where: { id: { in: stale.map((run) => run.id) }, status: { in: [...ACTIVE_STATUSES] }, updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', error: STALE_ERROR, completedAt: new Date() },
    }),
    prisma.branch.deleteMany({
      where: {
        projectId,
        isDefault: false,
        OR: [...new Set(stale.map((run) => run.source))].map((source) => ({ name: { startsWith: `import-${source}-` } })),
      },
    }),
  ]);
  logger.warn({ projectId, runIds: stale.map((run) => run.id) }, 'failed stale import runs');
};

/** The project's most recent run, after failing stale ones so a dead run never shows as running. */
export const getLatestImportRun = async (projectId: string): Promise<ImportRunView | null> => {
  await failStaleImportRuns(projectId);
  const run = await prisma.importRun.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  return run ? toImportRunView(run) : null;
};

const trackImport = (projectId: string, event: Parameters<typeof trackProjectEvent>[1]) =>
  trackProjectEvent(projectId, event, { source: 'dashboard' }).catch(() => undefined);

const notifyMembers = (projectId: string, title: string, body: string, type: string) =>
  createNotificationsForOrgMembers(projectId, { type, title, body, href: `/app/projects/${projectId}/settings` }).catch(() => undefined);

/** Execute a created run to completion; never throws (the outcome lives on the row). */
const executeImportRun = async (run: ImportRun, task: () => Promise<ImportSummary>): Promise<void> => {
  const source = run.source as ImportRunSource;
  const label = SOURCE_LABELS[source] ?? run.source;
  const started = performance.now();
  const operationId = `${source}-${run.id}`;
  const heartbeat = setInterval(() => {
    prisma.importRun.updateMany({ where: { id: run.id, status: 'RUNNING' }, data: { updatedAt: new Date() } }).catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref();
  try {
    await prisma.importRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    await trackImport(run.projectId, { name: 'import_started', sourceType: source, operationId });
    const summary = await task();
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', summary: summary as unknown as Prisma.InputJsonValue, completedAt: new Date() },
    });
    await trackImport(run.projectId, {
      name: 'import_completed',
      sourceType: source,
      operationId,
      itemCount: summary.imported + summary.updated,
      durationMs: Math.round(performance.now() - started),
    });
    await notifyMembers(
      run.projectId,
      'Content import completed',
      `${summary.imported} pages imported and ${summary.updated} updated from ${label}.`,
      'import_completed',
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : UNEXPECTED_ERROR;
    if (!(error instanceof AppError)) logger.error({ error, importRunId: run.id, projectId: run.projectId }, 'import run failed');
    await prisma.importRun
      .update({ where: { id: run.id }, data: { status: 'FAILED', error: message, completedAt: new Date() } })
      .catch((updateError) => logger.error({ error: updateError, importRunId: run.id }, 'could not record import failure'));
    await trackImport(run.projectId, {
      name: 'import_failed',
      sourceType: source,
      operationId,
      outcomeReason: 'import_failed',
      durationMs: Math.round(performance.now() - started),
    });
    await notifyMembers(run.projectId, 'Content import failed', `The ${label} import failed: ${message}`, 'import_failed');
  } finally {
    clearInterval(heartbeat);
  }
};

/**
 * Record an import run and start it in the background, so the request returns
 * at once and a long import is not bound to the browser's request timeout. A
 * second import of the same project is refused while one is active.
 */
export const startImportRun = async (options: {
  projectId: string;
  userId: string;
  source: ImportRunSource;
  task: () => Promise<ImportSummary>;
}): Promise<ImportRunView> => {
  await failStaleImportRuns(options.projectId);
  let run: ImportRun;
  try {
    run = await prisma.importRun.create({ data: { projectId: options.projectId, source: options.source, createdById: options.userId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('An import is already running for this project. Wait for it to finish, then try again.', { projectId: options.projectId });
    }
    throw error;
  }
  void executeImportRun(run, options.task);
  return toImportRunView(run);
};
