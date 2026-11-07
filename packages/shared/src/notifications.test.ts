import { describe, expect, it } from 'vitest';
import { defaultNotificationEnabled, notificationEnabled } from './notifications';

describe('notification defaults', () => {
  it('keeps the publish success email off and everything else on until set', () => {
    expect(defaultNotificationEnabled('project_deploy')).toBe(false);
    expect(defaultNotificationEnabled('project_deploy_failed')).toBe(true);
    expect(defaultNotificationEnabled('member_invited')).toBe(true);
  });

  it('falls back to the default when the preference is missing or unreadable', () => {
    for (const metadata of [null, undefined, '', '{}', '{"notifications":{}}', '{"notifications":{"other":false}}', 'not json']) {
      expect(notificationEnabled(metadata, 'project_deploy')).toBe(false);
      expect(notificationEnabled(metadata, 'project_deploy_failed')).toBe(true);
    }
  });

  it('honors a stored preference over the default', () => {
    const metadata = JSON.stringify({ notifications: { project_deploy: true, project_deploy_failed: false } });
    expect(notificationEnabled(metadata, 'project_deploy')).toBe(true);
    expect(notificationEnabled(metadata, 'project_deploy_failed')).toBe(false);
  });
});
