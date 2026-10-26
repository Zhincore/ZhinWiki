import { useT } from '@nibleaf/i18n/react';
import { LegalPage, type LegalSection, Mail } from '@/components/legal-page';
import { useBrand } from '@/lib/brand';

/** The built-in, instance-neutral terms of service, filled with the brand and its contacts. */
export function TermsPage() {
  const t = useT();
  const { name, supportEmail, abuseEmail, sourceUrl } = useBrand();
  const sections: LegalSection[] = [
    {
      heading: 'Who runs this service',
      body: (
        <p>
          {name} is run by the operator of this instance, not by the authors of the software it runs on. These terms are an agreement between you and
          that operator. You can reach the operator at <Mail address={supportEmail} />.
        </p>
      ),
    },
    {
      heading: 'Your account and content',
      body: (
        <>
          <p>
            You are responsible for your account, for keeping access to your email address secure, and for everything you write, upload or publish.
            You keep the rights to your content.
          </p>
          <p>
            You allow the operator to store, process, back up and display your content as needed to run the service, including making it public when
            you publish a site.
          </p>
        </>
      ),
    },
    {
      heading: 'Acceptable use',
      body: (
        <>
          <p>
            Do not use {name} to break the law or to harm others. In particular, do not upload or publish illegal content, content that infringes the
            rights of others, malware or phishing pages, spam, or content that harasses or threatens people. Do not try to disrupt the service, get
            around its limits, or access data that is not yours.
          </p>
          <p>
            To report abuse, including content on a site published with {name}, email <Mail address={abuseEmail} />.
          </p>
        </>
      ),
    },
    {
      heading: 'Suspension and removal',
      body: (
        <p>
          The operator may remove content, take down published sites, and suspend or delete accounts that break these terms or the law, or that put
          the service or other people at risk.
        </p>
      ),
    },
    {
      heading: 'No warranty',
      body: (
        <p>
          The service is provided "as is" and "as available", without warranty of any kind. It may change, be interrupted, or lose data. To the extent
          the law allows, neither the operator nor the authors of the software are liable for any damage arising from its use. Keep your own copies of
          content that matters to you.
        </p>
      ),
    },
    {
      heading: 'Open source',
      body: (
        <p>
          {name} runs open-source software licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). Its source code is available at{' '}
          <a className="text-foreground underline underline-offset-4" href={sourceUrl} rel="noopener noreferrer" target="_blank">
            {sourceUrl}
          </a>
          . Nothing in these terms limits your rights under that license.
        </p>
      ),
    },
    {
      heading: 'Changes',
      body: <p>The operator may update these terms. If you keep using the service after a change, the updated terms apply.</p>,
    },
  ];
  return (
    <LegalPage
      intro={
        <>
          These terms apply when you use {name}. For questions, contact <Mail address={supportEmail} />.
        </>
      }
      sections={sections}
      title={t('auth.legal.terms')}
    />
  );
}
