import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useCaptcha } from '@nibleaf/design-system/hooks/use-captcha';
import { useOtpResendCountdown } from '@nibleaf/design-system/hooks/use-otp-resend-countdown';
import { getLocale } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { LegalNotice } from '@/components/legal-notice';
import { SocialSignIn } from '@/components/social-sign-in';
import { useGetPublicMeta } from '@/hooks/api/public';
import { useTenancy } from '@/hooks/use-tenancy';
import { AuthLayout } from '@/layouts/auth';
import { authEmailErrorMessage, isCaptchaError } from '@/lib/auth-errors';
import { brandedTitle } from '@/lib/brand';
import { readPendingInvitation } from '@/lib/invitations';
import { authClient } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)/sign-in')({
  validateSearch: (search) =>
    z.object({ invite: z.string().optional().catch(undefined), email: z.string().optional().catch(undefined) }).parse(search),
  head: ({ matches }) => ({ meta: [{ title: brandedTitle(matches, 'Log in') }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: SignInPage,
});

function SignInPage() {
  const t = useT();
  const subtitle = t(useTenancy() === 'shared' ? 'auth.signIn.subtitleShared' : 'auth.signIn.subtitle');
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [email, setEmail] = useState(search.email ?? '');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resendIn, resetCountdown, startCountdown } = useOtpResendCountdown();
  const { data: publicMeta } = useGetPublicMeta();
  const captcha = useCaptcha(publicMeta?.captcha, getLocale());

  const normalizedEmail = email.trim().toLowerCase();
  const invitationId = search.invite ?? readPendingInvitation() ?? undefined;
  const afterAuthPath = invitationId ? `/accept-invite/${invitationId}` : '/app';

  const finishSignIn = async () => {
    if (invitationId) {
      await navigate({ to: '/accept-invite/$invitationId', params: { invitationId } });
    } else {
      await navigate({ to: '/app' });
    }
  };

  const requestCode = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const headers = await captcha.headers().catch(() => null);
      if (!headers) {
        setError(t('auth.captcha.failed'));
        return;
      }
      const result = await authClient.emailOtp.sendVerificationOtp({ email: normalizedEmail, type: 'sign-in', fetchOptions: { headers } });
      if (result.error) {
        setError(isCaptchaError(result.error) ? t('auth.captcha.failed') : authEmailErrorMessage(result.error, t('auth.otp.sendError')));
        return;
      }
      setCodeSent(true);
      startCountdown();
    } catch {
      setError(t('auth.otp.sendError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.emailOtp({ email: normalizedEmail, otp: otp.trim() });
      if (result.error) {
        setError(result.error.message ?? t('auth.otp.invalid'));
        return;
      }
      await finishSignIn();
    } catch {
      setError(t('auth.otp.invalid'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (codeSent) await verifyCode();
    else await requestCode();
  };

  return (
    <AuthLayout subtitle={codeSent ? t('auth.otp.checkEmail', { email: normalizedEmail }) : subtitle}>
      {!codeSent ? <SocialSignIn callbackURL={afterAuthPath} enabled={publicMeta?.providers} mode="signIn" onError={setError} /> : null}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {!codeSent ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t('auth.field.email')}</Label>
            <Input
              autoComplete="email"
              autoFocus
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              type="email"
              value={email}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2" dir="ltr">
            <Label htmlFor="otp">{t('auth.otp.label')}</Label>
            <InputOTP
              aria-invalid={Boolean(error)}
              autoComplete="one-time-code"
              autoFocus
              containerClassName="justify-center"
              disabled={isSubmitting}
              id="otp"
              inputMode="numeric"
              maxLength={6}
              onChange={setOtp}
              onComplete={verifyCode}
              value={otp}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <p className="text-center text-muted-foreground text-xs">{t('auth.otp.hint')}</p>
          </div>
        )}
        <div className="flex justify-center empty:hidden" ref={captcha.container} />
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="mt-1 w-full" disabled={isSubmitting || (codeSent ? otp.length !== 6 : !normalizedEmail || !captcha.ready)} type="submit">
          {isSubmitting
            ? codeSent
              ? t('auth.otp.verifying')
              : t('auth.otp.sending')
            : codeSent
              ? t('auth.otp.verifySignIn')
              : t('auth.otp.sendSignIn')}
        </Button>
        {codeSent ? (
          <div className="flex items-center justify-between">
            <Button
              onClick={() => {
                setCodeSent(false);
                setOtp('');
                setError(null);
                resetCountdown();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('auth.otp.differentEmail')}
            </Button>
            <Button disabled={isSubmitting || resendIn > 0 || !captcha.ready} onClick={requestCode} size="sm" type="button" variant="ghost">
              {resendIn > 0 ? t('auth.otp.resendIn', { seconds: resendIn }) : t('auth.otp.resend')}
            </Button>
          </div>
        ) : null}
      </form>
      {!codeSent ? (
        <>
          <LegalNotice />
          <p className="mt-5 text-center text-muted-foreground text-sm">
            {t('auth.signIn.noAccount')}{' '}
            <Link className="text-primary hover:underline" to="/sign-up">
              {t('auth.signIn.createOne')}
            </Link>
          </p>
        </>
      ) : null}
    </AuthLayout>
  );
}
