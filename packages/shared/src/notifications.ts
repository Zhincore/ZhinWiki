/** Workspace email notifications that stay off until a member turns them on.
 *  Every other id is on by default. */
const OFF_BY_DEFAULT: ReadonlySet<string> = new Set(['project_deploy']);

/** Whether a notification is sent when the workspace has no stored preference for it. */
export const defaultNotificationEnabled = (id: string): boolean => !OFF_BY_DEFAULT.has(id);

/**
 * Workspace notification preferences live as a JSON blob on `Organization.metadata`
 * (`{ notifications: { [id]: boolean } }`), edited in the per-site Notifications
 * settings. A missing or unreadable preference falls back to the id's default.
 */
export function notificationEnabled(metadata: string | null | undefined, id: string): boolean {
  if (!metadata) {
    return defaultNotificationEnabled(id);
  }
  try {
    const parsed = JSON.parse(metadata) as { notifications?: Record<string, boolean> };
    return parsed.notifications?.[id] ?? defaultNotificationEnabled(id);
  } catch {
    return defaultNotificationEnabled(id);
  }
}
