import React, { useState } from 'react';
import { NavPage, WorkspaceProfile } from '../../types/maildash';
import {
  AccountIcon,
  CalendarIcon,
  ChevronDownIcon,
  DashboardIcon,
  InboxIcon,
  MoonIcon,
  MyMailMark,
  SendIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  XMarkIcon,
} from '../ui/BrandIcons';
import { Avatar } from '../ui/DesignSystem';

export interface NavItemConfig {
  id: NavPage;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: number;
}

interface SidebarProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  workspaces: WorkspaceProfile[];
  activeWorkspace: WorkspaceProfile;
  onSelectWorkspace: (ws: WorkspaceProfile) => void;
  unreadInboxCount: number;
  needsReviewCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  theme,
  onToggleTheme,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  unreadInboxCount,
  needsReviewCount,
  mobileOpen,
  onCloseMobile,
}) => {
  const [wsMenuOpen, setWsMenuOpen] = useState(false);

  const navItems: NavItemConfig[] = [
    { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
    { id: 'inbox', label: 'Inbox', icon: InboxIcon, badge: unreadInboxCount },
    { id: 'sending', label: 'Sending', icon: SendIcon, badge: needsReviewCount },
    { id: 'leads', label: 'Leads', icon: UsersIcon },
    { id: 'scouting-plans', label: 'Scouting plans', icon: CalendarIcon },
    { id: 'accounts', label: 'Accounts', icon: AccountIcon },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const handleSelectNav = (page: NavPage) => {
    onNavigate(page);
    onCloseMobile();
  };

  const sidebarBody = (
    <aside className="w-[248px] h-full flex flex-col justify-between bg-[var(--color-surface)] border-r border-[var(--color-border)] select-none">
      <div>
        {/* Brand lockup */}
        <div className="px-7 pt-7 pb-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => handleSelectNav('dashboard')}
            className="flex items-center gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] rounded-lg"
          >
            <MyMailMark size={40} />
            <div className="min-w-0">
              <div className="text-[23px] font-bold leading-[1.2] tracking-[-0.02em] whitespace-nowrap">
                <span className="text-[var(--color-text)]">Mail </span>
                <span className="text-[var(--color-text)] dark:text-[var(--color-text)] text-[var(--color-brand)]">
                  Dash
                </span>
              </div>
              <p className="text-[11px] font-normal text-[var(--color-muted)] leading-[1.35] mt-0.5 whitespace-nowrap">
                Email outreach workspace
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden w-8 h-8 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] inline-flex items-center justify-center"
            aria-label="Close navigation menu"
          >
            <XMarkIcon size={18} />
          </button>
        </div>

        {/* Section label */}
        <div className="px-7 pt-4 pb-3">
          <span className="text-[11px] font-medium text-[var(--color-muted)]">
            Main Menu
          </span>
        </div>

        {/* Navigation links */}
        <nav className="px-4 space-y-2" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`relative w-full h-[48px] px-3.5 rounded-[12px] flex items-center justify-between gap-3 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] ${
                  isActive
                    ? 'bg-[var(--color-tint)] text-[var(--color-brand)] font-semibold'
                    : 'text-[var(--color-muted)] font-medium hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]'
                }`}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[20px] rounded-full bg-[var(--color-brand)]"
                    aria-hidden="true"
                  />
                )}
                <span className="flex items-center gap-3.5 min-w-0">
                  <Icon size={21} className="shrink-0" />
                  <span className="text-[14px] whitespace-nowrap truncate">
                    {item.label}
                  </span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full ${
                      isActive
                        ? 'bg-[var(--color-surface)] text-[var(--color-brand)]'
                        : 'bg-[var(--color-subtle)] text-[var(--color-muted)]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom controls: Appearance toggle + Workspace switcher */}
      <div className="px-4 pb-6 pt-4 space-y-4">
        <button
          type="button"
          onClick={onToggleTheme}
          className="w-full px-3 py-1.5 rounded-[12px] flex items-center gap-3 text-left hover:bg-[var(--color-subtle)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          <span className="w-8 h-8 rounded-full bg-[var(--color-subtle)] text-[var(--color-muted)] inline-flex items-center justify-center shrink-0">
            {theme === 'light' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </span>
          <span className="text-[12px] text-[var(--color-muted)] font-normal">
            {theme === 'light' ? 'Light mode' : 'Dark mode'}
          </span>
        </button>

        {/* Workspace card + dropdown */}
        <div className="relative">
          {wsMenuOpen && (
            <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg p-1.5 z-30">
              {workspaces.map((ws) => {
                const selected = ws.id === activeWorkspace.id;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => {
                      onSelectWorkspace(ws);
                      setWsMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 rounded-[10px] flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[var(--color-tint)] text-[var(--color-brand)]'
                        : 'hover:bg-[var(--color-subtle)] text-[var(--color-text)]'
                    }`}
                  >
                    <Avatar src={ws.avatarUrl} name={ws.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold truncate">
                        {ws.name}
                      </div>
                      <div className="text-[10px] text-[var(--color-muted)] truncate">
                        {ws.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setWsMenuOpen((prev) => !prev)}
            className="w-full h-[76px] px-3 rounded-[14px] bg-[var(--color-subtle)] hover:bg-[var(--color-tint)]/60 transition-colors flex items-center justify-between gap-2.5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Avatar
                src={activeWorkspace.avatarUrl}
                name={activeWorkspace.ownerName}
                size={40}
              />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--color-text)] truncate">
                  {activeWorkspace.name}
                </div>
                <div className="text-[11px] text-[var(--color-muted)] truncate">
                  {activeWorkspace.subtitle}
                </div>
              </div>
            </div>
            <ChevronDownIcon
              size={14}
              className={`text-[var(--color-muted)] shrink-0 transition-transform duration-150 ${
                wsMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop fixed sidebar */}
      <div className="hidden lg:block shrink-0 h-screen sticky top-0">
        {sidebarBody}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full">{sidebarBody}</div>
        </div>
      )}
    </>
  );
};
