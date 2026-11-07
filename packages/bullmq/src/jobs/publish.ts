export type PublishJobName = 'publish-deployment';

export interface PublishDeploymentJobData {
  deploymentId: string;
  projectId: string;
  /** Skip the (non-structural) grammar lint at build time — broken-link checks
   *  still block. Set by the dashboard's "Publish anyway" action. */
  skipGrammarChecks?: boolean;
  /** True for publishes started by the system (publish on merge) rather than
   *  the Publish button: activation metrics exclude them and no success email
   *  is sent. */
  auto?: boolean;
  /** Paraglide interface locale resolved when the publish was requested. */
  locale?: string;
}
