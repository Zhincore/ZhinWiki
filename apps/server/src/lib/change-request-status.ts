import type { ChangeRequestStatus } from '@nibleaf/database';

/** Statuses of a change request still being worked on. */
export const OPEN_CHANGE_REQUEST_STATUSES = ['DRAFT', 'IN_REVIEW'] as const satisfies readonly ChangeRequestStatus[];
