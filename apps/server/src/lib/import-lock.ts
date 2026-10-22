import { randomUUID } from 'node:crypto';
import { conflict } from '@/errors';
import { getRedis } from './redis';

/** Upper bound on one import; a crashed holder stops blocking the project after this. */
const IMPORT_LOCK_SECONDS = 30 * 60;

/** Delete the key only while it still holds this holder's token. */
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Run `task` while holding the project's import lock, so a second import of the
 * same project (a re-click, a retried request) is refused with a conflict
 * instead of racing the first one. Redis being unreachable fails OPEN: the lock
 * only prevents duplicate work, and imports must not hard-depend on redis.
 */
export const withProjectImportLock = async <T>(projectId: string, task: () => Promise<T>): Promise<T> => {
  const key = `nibleaf:import-lock:${projectId}`;
  const token = randomUUID();
  let acquired: boolean;
  try {
    acquired = (await getRedis().set(key, token, 'EX', IMPORT_LOCK_SECONDS, 'NX')) === 'OK';
  } catch {
    return task();
  }
  if (!acquired) {
    throw conflict('An import is already running for this project. Wait for it to finish, then try again.');
  }
  try {
    return await task();
  } finally {
    await getRedis()
      .eval(RELEASE_SCRIPT, 1, key, token)
      .catch(() => undefined);
  }
};
