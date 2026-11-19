import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import { NavPage, WorkspaceProfile } from '../../types/maildash';
import {
  AccountIcon,
  CalendarIcon,
  ChevronDownIcon,
  DashboardIcon,
  InboxIcon,
  SendIcon,
  SettingsIcon,
  UsersIcon,
} from '../ui/BrandIcons';
import { Avatar } from '../ui/DesignSystem';

interface TopBarProps {
  activePage: NavPage;
  activeWorkspace: WorkspaceProfile;
  connectedAccountsCount: number;
  onNavigate: (page: NavPage) => void;
  onOpenMobileMenu: () => void;
  onToggleTheme: () => void;
  theme: 'light' | 'dark';
}

const PAGE_META: Record<
  NavPage,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  dashboard: { label: 'Dashboard', icon: DashboardIcon },
  inbox: { label: 'Inbox', icon: InboxIcon },
  sending: { label: 'Sending', icon: SendIcon },
  leads: { label: 'Leads', icon: UsersIcon },
  'scouting-plans': { label: 'Scouting plans', icon: CalendarIcon },
  accounts: { label: 'Accounts', icon: AccountIcon },
  settings: { label: 'Settings', icon: SettingsIcon },
};

export const TopBar: React.FC<TopBarProps> = ({
  activePage,
  activeWorkspace,
  connectedAccountsCount,
  onNavigate,
  onOpenMobileMenu,
  onToggleTheme,
  theme,
}) => {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const currentMeta = PAGE_META[activePage];
  const PageIcon = currentMeta.icon;

  return (
    <header className="h-[88px] w-full bg-[var(--color-surface)] border-b border-[var(--color-border)] px-5 sm:px-8 flex items-center justify-between gap-4 shrink-0 sticky top-0 z-20">
      {/* Left: Mobile hamburger + Breadcrumb trail */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden w-10 h-10 rounded-[10px] bg-[var(--color-subtle)] text-[var(--color-text)] inline-flex items-center justify-center shrink-0"
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>

        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[var(--color-brand)] shrink-0 inline-flex items-center">
            <PageIcon size={20} />
          </span>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-[13px] whitespace-nowrap truncate"
          >
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
            >
              Workspace
            </button>
            <span className="text-[14px] font-medium text-[var(--color-text)]">
              / {currentMeta.label}
            </span>
          </nav>
        </div>
      </div>

      {/* Right: Connection status pill + User profile dropdown */}
      <div className="flex items-center gap-4 shrink-0">
        <button
          type="button"
          onClick={() => onNavigate('accounts')}
          className="hidden sm:inline-flex items-center gap-2.5 h-[36px] px-4 rounded-[18px] bg-[var(--color-subtle)] hover:bg-[var(--color-tint)] transition-colors cursor-pointer"
          title="View connected Gmail accounts"
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shrink-0"
            aria-hidden="true"
          />
          <span className="text-[11px] font-normal text-[var(--color-muted)] whitespace-nowrap">
            Connected workspace · {connectedAccountsCount} active
          </span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setAccountMenuOpen((prev) => !prev)}
            className="flex items-center gap-2.5 rounded-full p-0.5 hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            aria-label="Account options"
          >
            <Avatar
              src={activeWorkspace.avatarUrl}
              name={activeWorkspace.ownerName}
              size={40}
            />
            <ChevronDownIcon
              size={14}
              className={`text-[var(--color-muted)] transition-transform duration-150 ${
                accountMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {accountMenuOpen && (
            <div className="absolute right-0 mt-2 w-60 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg p-2 z-30">
              <div className="px-3 py-2 border-b border-[var(--color-border)]">
                <div className="text-[13px] font-semibold text-[var(--color-text)]">
                  {activeWorkspace.ownerName}
                </div>
                <div className="text-[11px] text-[var(--color-muted)] truncate">
                  {activeWorkspace.ownerEmail}
                </div>
              </div>
              <div className="pt-1.5 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('accounts');
                    setAccountMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-[10px] text-left text-[12px] font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)] transition-colors cursor-pointer"
                >
                  Connected accounts
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('settings');
                    setAccountMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-[10px] text-left text-[12px] font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)] transition-colors cursor-pointer"
                >
                  Workspace settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onToggleTheme();
                    setAccountMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-[10px] text-left text-[12px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                >
                  Switch to {theme === 'light' ? 'dark' : 'light'} mode
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
