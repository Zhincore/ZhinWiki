import { useCallback, useEffect, useRef } from 'react';

export interface CaptchaConfig {
  provider: 'altcha' | 'turnstile' | 'off';
  siteKey: string | null;
}

/** Request header the API reads the solution from. */
const CAPTCHA_HEADER = 'x-captcha-response';

const ALTCHA_CHALLENGE_URL = '/api/public/captcha';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileOptions {
  sitekey: string;
  language: string;
  appearance: 'interaction-only';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

interface Turnstile {
  render: (element: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileScript: Promise<Turnstile> | null = null;

const loadTurnstile = (): Promise<Turnstile> => {
  turnstileScript ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable')));
    script.onerror = () => {
      turnstileScript = null;
      reject(new Error('Turnstile unavailable'));
    };
    document.head.append(script);
  });
  return turnstileScript;
};

/** Fetches a challenge and solves it in the browser; the payload matches the ALTCHA widget's. */
const solveAltcha = async (): Promise<string | null> => {
  const response = await fetch(ALTCHA_CHALLENGE_URL, { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }
  const challenge = await response.json();
  const { pbkdf2, solveChallenge } = await import('altcha/lib');
  const solution = await solveChallenge({ challenge, deriveKey: pbkdf2.deriveKey });
  return solution ? btoa(JSON.stringify({ challenge, solution })) : null;
};

/**
 * The instance's bot check for unauthenticated email sends. ALTCHA solves
 * invisibly on demand; Turnstile renders into `container` and asks for
 * interaction only when Cloudflare needs it. `headers()` resolves to the
 * request headers carrying a fresh single-use solution, or rejects.
 */
export function useCaptcha(config: CaptchaConfig | undefined, language: string) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ id: string; turnstile: Turnstile } | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<((value: string | null) => void) | null>(null);
  const unavailable = useRef(false);
  const provider = config?.provider;
  const siteKey = config?.siteKey;

  useEffect(() => {
    const element = container.current;
    if (provider !== 'turnstile' || !siteKey || !element) {
      return;
    }
    let cancelled = false;
    unavailable.current = false;
    const settle = (value: string | null) => {
      token.current = value;
      waiting.current?.(value);
      waiting.current = null;
    };
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        const id = turnstile.render(element, {
          sitekey: siteKey,
          language,
          appearance: 'interaction-only',
          callback: settle,
          'expired-callback': () => {
            token.current = null;
          },
          'error-callback': () => settle(null),
        });
        widget.current = { id, turnstile };
      })
      .catch(() => {
        unavailable.current = true;
        settle(null);
      });
    return () => {
      cancelled = true;
      widget.current?.turnstile.remove(widget.current.id);
      widget.current = null;
      token.current = null;
    };
  }, [provider, siteKey, language]);

  const nextTurnstileToken = useCallback(async (): Promise<string | null> => {
    if (unavailable.current) {
      return null;
    }
    const value =
      token.current ??
      (await new Promise<string | null>((resolve) => {
        waiting.current = resolve;
      }));
    token.current = null;
    if (widget.current) {
      widget.current.turnstile.reset(widget.current.id);
    }
    return value;
  }, []);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    if (provider === 'off') {
      return {};
    }
    const solution = provider === 'altcha' ? await solveAltcha() : provider === 'turnstile' ? await nextTurnstileToken() : null;
    if (!solution) {
      throw new Error('Captcha not solved');
    }
    return { [CAPTCHA_HEADER]: solution };
  }, [provider, nextTurnstileToken]);

  return { container, headers };
}
