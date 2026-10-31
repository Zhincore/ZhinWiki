import type { GitbookImportBody, MintlifyImportBody } from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';

/** Summary reported by the content importers (Mintlify, Ghost, …). */
export interface ContentImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  assetsImported?: number;
  assetsSkipped?: number;
  warnings: string[];
}

type ImportRunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/** One background content import. */
export interface ImportRun {
  id: string;
  source: string;
  status: ImportRunStatus;
  summary: ContentImportSummary | null;
  error: string | null;
  errorCode: string | null;
  errorDetails: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export const isImportRunActive = (run: ImportRun | null | undefined): boolean => run?.status === 'PENDING' || run?.status === 'RUNNING';

/**
 * The project's latest import run, polled while it is active. When a run
 * succeeds, the data it may have changed (pages, project config) is refreshed.
 */
export const useLatestImportRun = (projectId: string) => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.imports.latestRun(projectId),
    queryFn: async () =>
      getData<ImportRun | null>(await api.app.projects[':projectId'].settings.import.runs.latest.$get({ param: { projectId } }), 'latest import run'),
    enabled: Boolean(projectId),
    refetchInterval: (state) => (isImportRunActive(state.state.data) ? 2500 : false),
  });
  const previous = useRef<ImportRun | null | undefined>(undefined);
  useEffect(() => {
    const run = query.data;
    const finished = isImportRunActive(previous.current) && previous.current?.id === run?.id && run?.status === 'SUCCEEDED';
    previous.current = run;
    if (!finished) return;
    qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    // Importers may also fill empty project-config keys (branding, navbar, redirects).
    qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    qc.invalidateQueries({ queryKey: queryKeys.projects.all() });
  }, [query.data, qc, projectId]);
  return query;
};

/** Start polling the run a start request just created. */
const useStartImport = <TBody>(projectId: string, start: (body: TBody) => Promise<ImportRun>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: start,
    onSuccess: (run) => qc.setQueryData(queryKeys.imports.latestRun(projectId), run),
  });
};

/** Start a one-way import of a public Mintlify GitHub docs repo (docs.json / mint.json). */
export const useImportFromMintlify = (projectId: string) =>
  useStartImport(projectId, async (body: MintlifyImportBody) =>
    mutateData<ImportRun>(
      await api.app.projects[':projectId'].settings.import.mintlify.$post({ param: { projectId }, json: body }),
      'Could not import from Mintlify.',
    ),
  );

/** Start a one-way import of a public GitBook Git Sync GitHub repo (.gitbook.yaml / SUMMARY.md). */
export const useImportFromGitbook = (projectId: string) =>
  useStartImport(projectId, async (body: GitbookImportBody) =>
    mutateData<ImportRun>(
      await api.app.projects[':projectId'].settings.import.gitbook.$post({ param: { projectId }, json: body }),
      'Could not import from GitBook.',
    ),
  );

/** Start a one-way import of a Ghost JSON export (published posts + pages → Markdown). */
export const useImportFromGhost = (projectId: string) =>
  useStartImport(projectId, async (body: Record<string, unknown>) =>
    mutateData<ImportRun>(
      await api.app.projects[':projectId'].settings.import.ghost.$post({ param: { projectId }, json: body }),
      'Could not import from Ghost.',
    ),
  );
