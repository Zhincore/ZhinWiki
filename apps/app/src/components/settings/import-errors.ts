import type { useT } from '@nibleaf/i18n/react';
import { ApiResponseError } from '@/hooks/api/client-helpers';

export const importMayStillRun = (error: unknown): boolean =>
  !(error instanceof ApiResponseError) || (error.code === undefined && (error.status >= 502 || error.status === 408));

/** A refused request or failed run: its error code, details, and the server's English message. */
interface ImportFailure {
  code?: string | null;
  details?: Record<string, unknown> | null;
  message: string;
}

const detail = (details: ImportFailure['details'], key: string) => (typeof details?.[key] === 'string' ? (details[key] as string) : undefined);

/** Translated text for a known import error code; the server's message otherwise. */
export const importFailureMessage = (t: ReturnType<typeof useT>, { code, details, message }: ImportFailure): string => {
  switch (code) {
    case 'import:in_progress':
      return t('settings.import.inProgress');
    case 'import:busy':
      return t('settings.import.busy');
    case 'import:conflict':
      return t('settings.import.conflict');
    case 'import:incomplete': {
      const path = detail(details, 'path');
      const sourceFile = detail(details, 'sourceFile');
      return `${t('settings.import.incomplete')}${path ? ` (${sourceFile ? `${sourceFile}: ` : ''}${path})` : ''}`;
    }
    case 'import:limit':
      return typeof details?.limit === 'number' ? t('settings.import.nodeLimit', { limit: details.limit }) : t('settings.import.limit');
    default:
      return message;
  }
};
