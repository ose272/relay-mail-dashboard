import React, { useState } from 'react';
import { RefreshCw, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { AccountStatus, ConnectedAccount } from '../types/maildash';
import {
  AccountIcon,
  AlertCircleIcon,
  CheckMarkIcon,
  SendIcon,
} from '../components/ui/BrandIcons';
import {
  MetricCard,
  ModalShell,
  NoticeBanner,
  PortfolioPillButton,
  StatusBadge,
  SurfacePanel,
} from '../components/ui/DesignSystem';

interface AccountsPageProps {
  accounts: ConnectedAccount[];
  onToggleAccountStatus: (id: string) => Promise<unknown>;
  onToggleWarmup: (id: string) => void;
  onUpdateDailyLimit: (id: string, dailyLimit: number) => Promise<unknown>;
  onConnectAccount: (payload: {
    appPassword: string;
    email: string;
    displayName: string;
    provider: 'Google Workspace' | 'Gmail OAuth';
    dailyLimit: number;
  }) => Promise<unknown>;
  onRunDnsCheck: (id: string) => Promise<unknown>;
}

export const AccountsPage: React.FC<AccountsPageProps> = ({
  accounts,
  onToggleAccountStatus,
  onToggleWarmup,
  onUpdateDailyLimit,
  onConnectAccount,
  onRunDnsCheck,
}) => {
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ConnectedAccount | null>(
    null
  );
  const [limitDraft, setLimitDraft] = useState(40);

  // Connect form
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [appPassword,setAppPassword]=useState('');
  const [saving,setSaving]=useState(false);
  const [provider, setProvider] = useState<'Google Workspace' | 'Gmail OAuth'>(
    'Google Workspace'
  );
  const [dailyLimit, setDailyLimit] = useState(40);

  const totalCapacity = accounts.filter(a=>a.status==='Connected').reduce((acc, a) => acc + a.dailyLimit, 0);
  const sentTodayTotal = accounts.reduce((acc, a) => acc + a.sentToday, 0);
  const avgDeliverability = Math.round(
    accounts.reduce((acc, a) => acc + a.deliverabilityScore, 0) /
      Math.max(1, accounts.length)
  );
  const attentionAccount = accounts.find(
    (a) => a.status === 'Needs attention'
  );

  const renderStatusBadge = (status: AccountStatus) => {
    switch (status) {
      case 'Connected':
        return <StatusBadge label="Connected" tone="success" icon="check" />;
      case 'Warming':
        return <StatusBadge label="Warming" tone="brand" icon="none" />;
      case 'Needs attention':
        return (
          <StatusBadge label="Needs attention" tone="warning" icon="alert" />
        );
      case 'Paused':
        return <StatusBadge label="Paused" tone="neutral" icon="pause" />;
    }
  };

  const handleConnectSubmit=async(e:React.FormEvent)=>{e.preventDefault();if(saving)return;setSaving(true);try{await onConnectAccount({email:email.trim(),appPassword,displayName:'',provider:'Google Workspace',dailyLimit:Number(dailyLimit)});setEmail('');setAppPassword('');setConnectModalOpen(false);}catch{}finally{setSaving(false);}};
  const handleLimitSave=async(e:React.FormEvent)=>{e.preventDefault();if(!editingAccount || saving)return;setSaving(true);try{await onUpdateDailyLimit(editingAccount.id,limitDraft);setEditingAccount(null);}catch{}finally{setSaving(false);}};
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold text-[var(--color-text)] tracking-[-0.8px] leading-[1.25]">
            Sender accounts
          </h1>
          <p className="text-[14px] text-[var(--color-muted)] mt-1">
            Manage connected Gmail mailboxes, rolling daily quotas, and connection health.
          </p>
        </div>

        <PortfolioPillButton
          variant="primary"
          size="lg"
          onClick={() => setConnectModalOpen(true)}
          className="min-w-[218px]"
        >
          + Connect account
        </PortfolioPillButton>
      </div>

      {/* Attention notice */}
      {attentionAccount && (
        <NoticeBanner
          title={`${attentionAccount.email} requires attention`}
          subtitle={attentionAccount.healthMessage || attentionAccount.connection || 'Check this account’s connection.'}
          actionLabel="Check connection"
          onAction={() => onRunDnsCheck(attentionAccount.id)}
          tone="warning"
        />
      )}

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard
          label="CONNECTED"
          value={accounts.filter(a=>a.connection==='Connected' && a.hasCredentials).length}
          subtitle="Verified Gmail senders"
          icon={<AccountIcon size={20} />}
        />
        <MetricCard
          label="DAILY CAPACITY"
          value={totalCapacity}
          subtitle="Active verified sender capacity"
          icon={<SendIcon size={20} />}
        />
        <MetricCard
          label="SENT (24 HOURS)"
          value={sentTodayTotal}
          subtitle={`${Math.max(0, totalCapacity - sentTodayTotal)} remaining in rolling window`}
          icon={<CheckMarkIcon size={18} />}
        />
        <MetricCard
          label="HEALTHY"
          value={accounts.filter(a=>a.healthStatus==='Healthy').length}
          subtitle="Provider connection checks"
          icon={<AlertCircleIcon size={20} />}
        />
      </div>

      {/* Accounts Table Panel */}
      <SurfacePanel className="overflow-hidden">
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="w-10 h-10 rounded-[12px] bg-[var(--color-tint)] text-[var(--color-brand)] inline-flex items-center justify-center shrink-0">
              <AccountIcon size={20} />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold text-[var(--color-text)]">
                Connected Gmail mailboxes
              </h2>
              <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                Gmail app-password connections used by the background sender
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-[var(--color-muted)]">
            <ShieldCheck size={15} className="text-[var(--color-success)]" />
            <span>IMAP · SMTP connection health</span>
          </span>
        </div>

        {!accounts.length && <p className="p-6 text-[13px] text-[var(--color-muted)]">No connected accounts yet.</p>}
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-[var(--color-subtle)]">
                <th className="py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] rounded-l-[8px]">
                  SENDER ACCOUNT
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  STATUS
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  DAILY QUOTA
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  HEALTH
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  AUTOMATION
                </th>
                <th className="py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] text-right rounded-r-[8px]">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {accounts.map((acc) => {
                const quotaPct = Math.min(
                  100,
                  Math.round((acc.sentToday / Math.max(1, acc.dailyLimit)) * 100)
                );
                return (
                  <tr
                    key={acc.id}
                    className="hover:bg-[var(--color-subtle)]/40 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <div className="text-[13px] font-semibold text-[var(--color-text)]">
                        {acc.email}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {acc.displayName} · {acc.provider} · Synced {acc.lastSynced}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      {renderStatusBadge(acc.status)}
                    </td>
                    <td className="py-3.5 px-3 w-[190px]">
                      <div className="flex items-center justify-between text-[11px] text-[var(--color-text)] tabular-nums mb-1.5">
                        <span>
                          {acc.sentToday} / {acc.dailyLimit}
                        </span>
                        <span className="text-[var(--color-muted)]">
                          {acc.healthStatus}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[var(--color-subtle)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--color-brand)]"
                          style={{ width: `${quotaPct}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="text-[11px] text-[var(--color-muted)]" title={acc.healthMessage}>{acc.healthStatus || 'Not checked'}</span>
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="text-[11px] text-[var(--color-muted)]">Warmup unavailable</span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onRunDnsCheck(acc.id)}
                          className="w-8 h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)] inline-flex items-center justify-center cursor-pointer"
                          title="Check IMAP and SMTP connection"
                          aria-label={`Sync ${acc.email}`}
                        >
                          <RefreshCw size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAccount(acc);
                            setLimitDraft(acc.dailyLimit);
                          }}
                          className="w-8 h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)] inline-flex items-center justify-center cursor-pointer"
                          title="Edit daily limit"
                          aria-label={`Edit limit for ${acc.email}`}
                        >
                          <SlidersHorizontal size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleAccountStatus(acc.id)}
                          className="h-8 px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)] cursor-pointer"
                        >
                          {acc.status === 'Paused' ? 'Resume' : 'Pause'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SurfacePanel>

      {/* Edit Daily Limit Modal */}
      <ModalShell
        open={Boolean(editingAccount)}
        onClose={() => setEditingAccount(null)}
        title="Configure daily send cap"
        subtitle={editingAccount?.email}
      >
        <form onSubmit={handleLimitSave} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1.5">
              Maximum messages per 24 hours
            </label>
            <input
              type="number"
              min={1}
              max={40}
              value={limitDraft}
              onChange={(e) => setLimitDraft(Number(e.target.value))}
              className="w-full h-[42px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px] text-[var(--color-text)] tabular-nums focus:outline-none focus:border-[var(--color-brand)]"
            />
            <p className="text-[11px] text-[var(--color-muted)] mt-1.5">
              Choose 1–40 messages per rolling 24 hours.
            </p>
          </div>
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditingAccount(null)}
              className="px-4 py-2.5 rounded-[70px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-muted)] cursor-pointer"
            >
              Cancel
            </button>
            <PortfolioPillButton type="submit" variant="primary" size="md" disabled={saving}>
              Save limit
            </PortfolioPillButton>
          </div>
        </form>
      </ModalShell>

      {/* Connect New Account Modal */}
      <ModalShell
        open={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        title="Connect sender account"
        subtitle="Authorize a Gmail or Google Workspace seat for background sending."
      >
        <form onSubmit={handleConnectSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="founders@yourcompany.com"
              className="w-full h-[40px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
            />
          </div>
          <label className="block text-[12px] font-medium">Google app password<input type="password" required autoComplete="new-password" value={appPassword} onChange={e=>setAppPassword(e.target.value)} className="mt-2 w-full h-[40px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)]"/><span className="block mt-2 text-[var(--color-muted)]">Use a 16-character Google app password. It is never displayed after saving.</span></label>
          <div>
            <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
              Initial daily send cap
            </label>
            <input
              type="number"
              min={1}
              max={40}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value))}
              className="w-full h-[40px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] tabular-nums"
            />
          </div>
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setConnectModalOpen(false)}
              className="px-4 py-2.5 rounded-[70px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-muted)] cursor-pointer"
            >
              Cancel
            </button>
            <PortfolioPillButton type="submit" variant="primary" size="md" disabled={saving}>
              Connect mailbox
            </PortfolioPillButton>
          </div>
        </form>
      </ModalShell>
    </div>
  );
};
