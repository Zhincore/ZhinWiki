import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { changeRequestPolicy } from '@nibleaf/shared/rbac';
import { GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useTenancy } from '@/hooks/use-tenancy';
import { FIELD_INPUT, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

/** Merge policy: required approvals, and outside contributions on shared instances. */
export function ChangeRequestsSection({ project }: { project: Project }) {
  const t = useT();
  const shared = useTenancy() === 'shared';
  const update = useUpdateProjectConfig(project.id);
  const policy = changeRequestPolicy(project.config);
  const [requiredApprovals, setRequiredApprovals] = useState(String(policy.requiredApprovals));
  const [outsideContributions, setOutsideContributions] = useState(policy.outsideContributions);
  const [saving, setSaving] = useState(false);
  const approvals = Number(requiredApprovals);
  const valid = requiredApprovals.trim() !== '' && Number.isInteger(approvals) && approvals >= 0 && approvals <= 10;

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid) return;
        setSaving(true);
        try {
          await saveConfigSection(update, { changeRequests: { requiredApprovals: approvals, outsideContributions } });
        } finally {
          setSaving(false);
        }
      }}
    >
      <SectionHeader icon={<GitPullRequest className="size-4" />} title={t('settings.changeRequests')} />
      <Field hint={t('settings.changeRequests.requiredApprovals.hint')} label={t('settings.changeRequests.requiredApprovals.label')}>
        <Input
          className={`${FIELD_INPUT} w-24`}
          inputMode="numeric"
          max={10}
          min={0}
          onChange={(event) => setRequiredApprovals(event.target.value)}
          type="number"
          value={requiredApprovals}
          aria-invalid={!valid}
        />
      </Field>
      {shared ? (
        <ToggleRow
          checked={outsideContributions}
          hint={t('settings.changeRequests.outside.hint')}
          onCheckedChange={setOutsideContributions}
          title={t('settings.changeRequests.outside.title')}
        />
      ) : null}
      <div className="mt-4">
        <SaveBar
          defaults={{ requiredApprovals: String(policy.requiredApprovals), outsideContributions: policy.outsideContributions }}
          invalid={!valid}
          isSubmitting={saving}
          values={{ requiredApprovals, outsideContributions }}
        />
      </div>
    </form>
  );
}
