import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { type ComponentType, useState } from 'react';
import { DiscordIcon, GithubIcon, GoogleIcon } from '@/components/icons/brand';
import { signIn } from '@/services/auth-client';

type SocialProvider = 'google' | 'github' | 'discord';

const PROVIDERS: { id: SocialProvider; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: 'google', label: 'Google', Icon: GoogleIcon },
  { id: 'github', label: 'GitHub', Icon: GithubIcon },
  { id: 'discord', label: 'Discord', Icon: DiscordIcon },
];

interface SocialSignInProps {
  /** Providers the instance has credentials for; others are hidden. */
  enabled: Partial<Record<SocialProvider, boolean>> | undefined;
  mode: 'signIn' | 'signUp';
  callbackURL: string;
  disabled?: boolean;
  /** Receives the failure message, or null when a new attempt starts. */
  onError: (message: string | null) => void;
}

/** One button per configured OAuth provider, followed by an "or" divider. */
export function SocialSignIn({ enabled, mode, callbackURL, disabled = false, onError }: SocialSignInProps) {
  const t = useT();
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const providers = PROVIDERS.filter((provider) => enabled?.[provider.id]);
  if (providers.length === 0) {
    return null;
  }

  const start = async (provider: SocialProvider) => {
    setPending(provider);
    onError(null);
    const result = await signIn.social({ provider, callbackURL });
    if (result.error) {
      onError(result.error.message ?? t(mode === 'signIn' ? 'auth.signIn.error' : 'auth.signUp.error'));
      setPending(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-2">
        {providers.map(({ id, label, Icon }) => (
          <Button className="w-full gap-2" disabled={disabled || pending !== null} key={id} onClick={() => start(id)} type="button" variant="outline">
            <Icon className="size-4" />
            {pending === id
              ? t('auth.social.submitting', { provider: label })
              : t(mode === 'signIn' ? 'auth.social.signIn' : 'auth.social.signUp', { provider: label })}
          </Button>
        ))}
      </div>
      <div className="mb-4 flex items-center gap-3 text-muted-foreground text-xs">
        <span className="h-px flex-1 bg-border" />
        <span>{t('auth.divider.or')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}
