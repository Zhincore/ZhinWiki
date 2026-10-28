/** Error codes returned by `POST /auth/delete-user` when account deletion is refused. */
export const ACCOUNT_DELETION_ERROR = {
  /** The user owns workspaces that still have other members. */
  OWNS_SHARED_WORKSPACES: 'OWNS_SHARED_WORKSPACES',
  /** A sole-member workspace cannot be erased yet; retry shortly. */
  ERASURE_PENDING: 'WORKSPACE_ERASURE_PENDING',
} as const;

/** A workspace that blocks account deletion until ownership moves or members leave. */
export interface BlockingWorkspace {
  organizationId: string;
  projectId: string | null;
  name: string;
}
