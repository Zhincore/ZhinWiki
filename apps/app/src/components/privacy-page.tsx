import { useT } from '@nibleaf/i18n/react';
import { LegalPage, type LegalSection, Mail } from '@/components/legal-page';
import { useBrand } from '@/lib/brand';

/** The built-in privacy notice: what the software behind this instance stores and processes, filled with the brand and its contacts. */
export function PrivacyPage() {
  const t = useT();
  const { name, supportEmail } = useBrand();
  const sections: LegalSection[] = [
    {
      heading: 'Who is responsible',
      body: (
        <>
          <p>
            {name} is run by the operator of this instance. The operator decides how the software is configured, where your data is hosted, which
            outside services it uses, how long data is kept, and which laws apply.
          </p>
          <p>
            For questions or requests about your data, including access, correction or deleting your account, contact the operator at{' '}
            <Mail address={supportEmail} />.
          </p>
        </>
      ),
    },
    {
      heading: 'Your account',
      body: (
        <>
          <p>
            Your account holds your name, email address, profile picture (if any) and role. You sign in with one-time codes sent by email; the codes
            are stored only as hashes. If the operator has enabled Google sign-in and you use it, the account also keeps your Google account ID and
            the tokens Google returns.
          </p>
          <p>
            Each sign-in session stores your IP address and browser user agent. They keep you signed in, and a sign-in from a new IP address can
            trigger an email alert to you that includes that address (you can turn these alerts off).
          </p>
        </>
      ),
    },
    {
      heading: 'Workspaces and content',
      body: (
        <>
          <p>
            {name} stores what you and your team create: pages, published versions of sites, comments (with the text they refer to), notifications,
            workspace members and invitations (the invited email address and who sent it). Uploaded files are kept in the object storage the operator
            configured. Published public sites can be read by anyone; private sites only by workspace members or invited readers.
          </p>
          <p>
            Invited readers of a private site are stored with their email address and name. Their reader sessions store SHA-256 hashes of their IP
            address and user agent, and a cookie keeps them signed in.
          </p>
          <p>
            If you connect a GitHub or GitLab repository, the access token you enter is stored encrypted, and the author name and email of synced
            commits are recorded. Webhook deliveries are recorded by event type and a hash; their contents are not stored. Webhook URLs for Slack,
            Discord or Zapier integrations are stored encrypted.
          </p>
        </>
      ),
    },
    {
      heading: 'Analytics on published sites',
      body: (
        <>
          <p>
            {name} has built-in analytics for published sites. For page views, searches and "was this helpful" feedback it records the page path, the
            referring site's host name, country (when the hosting network provides it), device type, language and a random session ID that is stored
            only as a hash. IP addresses and user agents are not stored with analytics events; the device type is derived from the user agent and the
            user agent itself is discarded.
          </p>
          <p>
            Search terms are stored as keyed hashes. The text of a search on a public site is stored only if the site enables it and the visitor
            consents to analytics. Campaign (UTM) parameters are also kept only with consent and when the site enables them.
          </p>
          <p>
            How long analytics are kept is configured by the operator. Out of the box, detailed events are kept for 180 days, hourly and daily
            summaries for two years, and stored search text for 30 days.
          </p>
          <p>
            Site owners can add Google Analytics or Plausible to their own published sites, and custom fonts are loaded from Google Fonts. Those
            services then receive the visitor's requests under their own policies. Depending on the site's settings, Google Analytics and Plausible
            load right away, only after the visitor consents, or not at all.
          </p>
        </>
      ),
    },
    {
      heading: 'Search and AI features',
      body: (
        <>
          <p>
            AI features are optional and depend on the operator's configuration; they use OpenRouter, which forwards requests to the AI model the
            operator selects. Without an OpenRouter key, nothing is sent to an AI provider.
          </p>
          <p>
            With AI search enabled, the text of published pages and the visitors' search queries are sent to OpenRouter to compute embeddings, and the
            embeddings with page excerpts are stored in a search index. If a site enables AI answers, the question and matching excerpts of published
            pages are sent to the model to write the answer.
          </p>
          <p>When you use AI writing assistance in the editor, the page content and your instruction are sent to the model.</p>
        </>
      ),
    },
    {
      heading: 'Email',
      body: (
        <p>
          Email is sent through Postmark or an SMTP server, as configured by the operator. {name} sends sign-in codes, email verification,
          invitations, sign-in alerts, new-member notices and deployment notifications.
        </p>
      ),
    },
    {
      heading: 'Logs and abuse protection',
      body: (
        <p>
          The application's request logs record each request's method, path, status and duration, but not your IP address or user agent; credentials
          and tokens are removed from logs. The operator's hosting infrastructure, such as a reverse proxy or CDN, may keep its own access logs that
          include IP addresses. Rate limits are counted per IP address in memory and are not stored. Security-relevant actions, such as Git syncs,
          integration changes and AI tool access, are kept in audit records.
        </p>
      ),
    },
    {
      heading: 'Cookies and browser storage',
      body: (
        <>
          <p>{name} sets only first-party cookies needed to work:</p>
          <ul className="list-disc space-y-1 ps-6">
            <li>a session cookie that keeps you signed in (HTTP-only);</li>
            <li>
              <code>nibleaf_reader_…</code>, which keeps an invited reader signed in to a private site;
            </li>
            <li>
              <code>NIBLEAF_LOCALE</code>, your interface language;
            </li>
            <li>
              <code>sidebar_state</code>, whether the dashboard sidebar is open.
            </li>
          </ul>
          <p>
            Your browser's local and session storage hold preferences such as theme and editor settings, your analytics consent choice for each site,
            and the random analytics session ID. Third-party services a site owner adds may set their own cookies.
          </p>
        </>
      ),
    },
    {
      heading: 'Deletion',
      body: (
        <p>
          Deleting a project removes its content from the database, its analytics and its search index. Uploaded files may remain in storage until the
          operator removes them. To delete your account, contact the operator at <Mail address={supportEmail} />.
        </p>
      ),
    },
    {
      heading: 'Changes',
      body: <p>This notice describes the software as it runs today. The operator may change its configuration or replace this notice.</p>,
    },
  ];
  return (
    <LegalPage
      intro={
        <>
          This notice explains what {name} stores and processes about you, and why. Contact: <Mail address={supportEmail} />.
        </>
      }
      sections={sections}
      title={t('auth.legal.privacy')}
    />
  );
}
