import { Button } from '@nibleaf/design-system/components/ui/button';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { Eye, Loader2, Rocket } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { ProjectSidebar } from '@/components/app/project-sidebar';
import { DeployPipeline } from '@/components/project/deploy-pipeline';
import { PublishModal } from '@/components/project/publish-modal';
import { useDeployments, useProject } from '@/hooks/api';
import type { Project } from '@/hooks/api/types';
import type { FirstPublishAttribution } from '@/lib/first-publish-activation';

/** Top-bar status badge + Publish button. Publishing happens through the modal → pipeline flow.
 *  `initialPublishOpen` opens the publish modal on mount (deep link: editor?publish=true). */
export function PublishControl({
  project,
  initialPublishOpen = false,
  beforePublish,
}: {
  project: Project;
  initialPublishOpen?: boolean;
  beforePublish?: () => Promise<void> | Promise<boolean>;
}) {
  const [publishOpen, setPublishOpen] = useState(initialPublishOpen);
  const [deployOpen, setDeployOpen] = useState(false);
  const [publishedAttribution, setPublishedAttribution] = useState<FirstPublishAttribution | null>(null);
  const [publishedDeploymentId, setPublishedDeploymentId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const t = useT();

  const deployments = useDeployments(project.id, { pollIntervalMs: 1500 });
  const latest = deployments.data?.[0];
  const building = latest?.status === 'PENDING' || latest?.status === 'BUILDING';

  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={building ? t('project.publishing') : t('project.publish')}
        disabled={building || preparing}
        onClick={async () => {
          setPreparing(true);
          try {
            if ((await beforePublish?.()) === false) return;
            setPublishOpen(true);
          } catch {
            toast.error(t('editor.saveError'));
          } finally {
            setPreparing(false);
          }
        }}
        size="sm"
      >
        {preparing ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
        <span className="hidden sm:inline">{building ? t('project.publishing') : t('project.publish')}</span>
      </Button>

      <PublishModal
        beforePublish={beforePublish}
        onOpenChange={setPublishOpen}
        onPublished={(deployment, attribution) => {
          setPublishedAttribution(attribution);
          setPublishedDeploymentId(deployment.id);
          setDeployOpen(true);
        }}
        open={publishOpen}
        project={project}
      />
      <DeployPipeline
        onOpenChange={setDeployOpen}
        open={deployOpen}
        project={project}
        trackedAttribution={publishedAttribution}
        trackedDeploymentId={publishedDeploymentId}
      />
    </div>
  );
}

/** Routes that render their own top bar inside the shell and keep the nav collapsed to icons. */
const isFocusedRoute = (pathname: string) => pathname.endsWith('/editor');

/** The per-site shell: a left sidebar (switcher + sections + account) with a slim
 *  content header. Publishing lives ONLY in the editor (Mintlify-style); the
 *  dashboard header just offers a live-site preview. */
export function ProjectLayout({ projectId, children }: { projectId: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const { data: project } = useProject(projectId);
  const previewEnabled = project ? project.config?.addons?.previewDeployments !== false : false;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The editor is a focused workspace: it renders its own top bar and page-tree
  // sidebar inside the inset, and the nav collapses to the icon rail. A manual
  // toggle only lasts while the route kind stays the same.
  const focused = isFocusedRoute(pathname);
  const [override, setOverride] = useState<{ open: boolean; focused: boolean } | null>(null);
  const open = override?.focused === focused ? override.open : !focused;

  // Warm the editor chunk so entering it does not wait on a lazy import.
  useEffect(() => {
    void router.preloadRoute({ to: '/app/projects/$projectId/editor', params: { projectId } }).catch(() => undefined);
  }, [router, projectId]);

  return (
    <SidebarProvider
      className={cn(focused && 'h-svh')}
      onOpenChange={(next) => setOverride({ open: next, focused })}
      open={open}
      style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}
    >
      <ProjectSidebar projectId={projectId} />
      {focused ? (
        <SidebarInset className="min-h-0 overflow-hidden">{children}</SidebarInset>
      ) : (
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background/85 px-4 backdrop-blur">
            <SidebarTrigger className="-ms-1" />
            {project?.name ? (
              <span className="truncate font-medium text-sm" dir="auto">
                {project.name}
              </span>
            ) : (
              <span className="h-4 w-28 animate-pulse rounded bg-muted" aria-hidden />
            )}
            <div className="ms-auto flex items-center gap-2">
              <NotificationsPopover />
              <Button
                nativeButton={false}
                render={
                  previewEnabled ? (
                    <Link aria-label={t('project.previewDraftAria')} params={{ projectId }} to="/app/projects/$projectId/preview" />
                  ) : (
                    // biome-ignore lint/a11y/useAnchorContent: content is merged from the Button children via Base UI's render prop
                    <a aria-label={t('project.previewLiveAria')} href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />
                  )
                }
                size="sm"
                variant="outline"
              >
                <Eye className="size-3.5" /> {t('project.preview')}
              </Button>
            </div>
          </header>
          <div className="flex-1">{children}</div>
        </SidebarInset>
      )}
    </SidebarProvider>
  );
}
