import { useT } from '@nibleaf/i18n/react';
import type { CreateChangeRequestBody, SubmitChangeRequestReviewBody, UpdateChangeRequestBody } from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';
import type { ChangeRequest, ChangeRequestDetail, ChangeRequestPageDiff, ChangeRequestUser } from './types';

const changeRequests = api.app.projects[':projectId']['change-requests'];

/** Every change request of a project, newest first. */
export const useChangeRequests = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.changeRequests.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<ChangeRequest[]>(await changeRequests.$get({ param: { projectId: projectId ?? '' }, query: {} }), 'change requests'),
  });

/** One change request with the pages it changes and its current merge conflicts; refetched on mount since editor saves change it. */
export const useChangeRequest = (projectId: string, number: number | undefined) =>
  useQuery({
    queryKey: queryKeys.changeRequests.detail(projectId, number ?? 0),
    enabled: number !== undefined,
    staleTime: 0,
    queryFn: async () =>
      getData<ChangeRequestDetail>(await changeRequests[':number'].$get({ param: { projectId, number: String(number) } }), 'change request'),
  });

export const useChangeRequestPageDiff = (projectId: string, number: number, pageId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.changeRequests.pageDiff(projectId, number, pageId ?? ''),
    enabled: Boolean(pageId),
    staleTime: 0,
    queryFn: async () =>
      getData<ChangeRequestPageDiff>(
        await changeRequests[':number'].pages[':pageId'].diff.$get({ param: { projectId, number: String(number), pageId: pageId ?? '' } }),
        'page changes',
      ),
  });

const useCreateChangeRequest = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateChangeRequestBody) =>
      mutateData<ChangeRequest>(await changeRequests.$post({ param: { projectId }, json: body }), 'Could not open a change request.'),
    onSuccess: (created) => {
      qc.setQueryData<ChangeRequest[]>(queryKeys.changeRequests.all(projectId), (list) => (list ? [created, ...list] : list));
      qc.invalidateQueries({ queryKey: queryKeys.changeRequests.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.branches.all(projectId) });
    },
  });
};

/** Open a change request and continue in the editor on it; a failure toasts. */
export const useStartChangeRequest = (projectId: string) => {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateChangeRequest(projectId);
  const start = () =>
    create.mutate(
      {},
      {
        onSuccess: (created) => void navigate({ to: '/app/projects/$projectId/editor', params: { projectId }, search: { cr: created.number } }),
        onError: (error) => toast.error(error.message || t('changeRequest.createError')),
      },
    );
  return { start, isPending: create.isPending };
};

export const useUpdateChangeRequest = (projectId: string, number: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateChangeRequestBody) =>
      mutateData<ChangeRequest>(
        await changeRequests[':number'].$patch({ param: { projectId, number: String(number) }, json: body }),
        'Could not update the change request.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.changeRequests.all(projectId) }),
  });
};

/** Merge into main. A 409 carries `details.conflicts`; `force` names the conflicting pages the change request wins on. */
export const useMergeChangeRequest = (projectId: string, number: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (force: string[]) =>
      mutateData<ChangeRequest>(
        await changeRequests[':number'].merge.$post({ param: { projectId, number: String(number) }, json: { force } }),
        'Could not merge the change request.',
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.changeRequests.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.branches.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
    },
  });
};

/** Users who can be asked to review (members only). */
export const useReviewerCandidates = (projectId: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.changeRequests.reviewerCandidates(projectId),
    enabled,
    queryFn: async () => getData<ChangeRequestUser[]>(await changeRequests['reviewer-candidates'].$get({ param: { projectId } }), 'reviewers'),
  });

/** Add a reviewer, ask them again (`request`) or remove them. */
export const useChangeRequestReviewer = (projectId: string, number: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, remove }: { userId: string; remove?: boolean }) => {
      const param = { projectId, number: String(number) };
      return mutateData<{ userId: string }>(
        remove
          ? await changeRequests[':number'].reviewers[':userId'].$delete({ param: { ...param, userId } })
          : await changeRequests[':number'].reviewers.$post({ param, json: { userId } }),
        'Could not update the reviewers.',
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.changeRequests.all(projectId) }),
  });
};

export const useSubmitChangeRequestReview = (projectId: string, number: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SubmitChangeRequestReviewBody) =>
      mutateData<{ state: string }>(
        await changeRequests[':number'].reviews.$post({ param: { projectId, number: String(number) }, json: body }),
        'Could not submit the review.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.changeRequests.all(projectId) }),
  });
};
