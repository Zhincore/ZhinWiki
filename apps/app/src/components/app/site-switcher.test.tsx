import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { state, passthrough } = vi.hoisted(() => ({
  state: { canCreate: true },
  passthrough: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@nibleaf/design-system/brand', () => ({ BrandMark: () => null }));
vi.mock('@nibleaf/design-system/components/ui/dropdown-menu', () => ({
  DropdownMenu: passthrough,
  DropdownMenuContent: passthrough,
  DropdownMenuItem: passthrough,
  DropdownMenuLabel: passthrough,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: passthrough,
}));
vi.mock('@nibleaf/design-system/components/ui/sidebar', () => ({
  SidebarMenu: passthrough,
  SidebarMenuButton: passthrough,
  SidebarMenuItem: passthrough,
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/api', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('@/hooks/use-tenancy', () => ({ useCanCreateWiki: () => state.canCreate }));

import { SiteSwitcher } from './site-switcher';

describe('SiteSwitcher', () => {
  it('offers a new site with its separator when creation is allowed', () => {
    state.canCreate = true;
    const html = renderToStaticMarkup(<SiteSwitcher />);
    expect(html).toContain('dashboard.newProject');
    expect(html).toContain('<hr/>');
  });

  it('drops the new-site item and its separator otherwise', () => {
    state.canCreate = false;
    const html = renderToStaticMarkup(<SiteSwitcher />);
    expect(html).not.toContain('dashboard.newProject');
    expect(html).not.toContain('<hr/>');
  });
});
