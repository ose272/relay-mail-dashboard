import { TrackingAnalytics } from '../components/TrackingAnalytics';
import type { ConnectedAccount, InboxThread, Lead, NavPage, ScoutingPlan, SendingState } from '../types/maildash';
import { MetricCard, SurfacePanel, PortfolioPillButton } from '../components/ui/DesignSystem';
import { SendIcon, InboxIcon, UsersIcon, AccountIcon } from '../components/ui/BrandIcons';

interface Props {
  sendingState: SendingState;
  threads: InboxThread[];
  leads: Lead[];
  plans: ScoutingPlan[];
  accounts: ConnectedAccount[];
  leadTotal: number;
  campaignCount: number;
  onNavigate: (page: NavPage) => void;
  onSelectThread: (id: string) => void;
}

export function DashboardPage({
  sendingState,
  threads,
  plans,
  accounts,
  leadTotal,
  campaignCount,
  onNavigate,
  onSelectThread,
}: Props) {
  const isCancelled = sendingState.backendStatus === 'Cancelled';
  const displaySent = isCancelled ? 0 : sendingState.sentCount;
  const displayPlanned = isCancelled ? 0 : sendingState.plannedTotal;
  const displayQueued = isCancelled ? 0 : sendingState.queuedCount;
  const progressPercent = isCancelled
    ? 0
    : Math.min(100, (100 * displaySent) / Math.max(1, displayPlanned));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.8px]">
            Outreach overview
          </h1>
          <p className="text-[14px] text-[var(--color-muted)] mt-1">
            Live sending, today’s replies, and connected Gmail accounts.
          </p>
        </div>
        <PortfolioPillButton onClick={() => onNavigate('sending')}>
          Open sending queue
        </PortfolioPillButton>
      </div>

      <TrackingAnalytics campaignId={sendingState.id}/>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard
          label="CONFIRMED SENT"
          value={displaySent}
          subtitle={isCancelled ? 'No active direct send' : 'Latest direct send run'}
          icon={<SendIcon size={20} />}
          onClick={() => onNavigate('sending')}
        />
        <MetricCard
          label="REPLY THREADS · 24 HOURS"
          value={threads.length}
          subtitle="Rolling 24-hour window"
          icon={<InboxIcon size={20} />}
          onClick={() => onNavigate('inbox')}
        />
        <MetricCard
          label="ACTIVE LEADS"
          value={leadTotal}
          subtitle={`${campaignCount} campaigns recorded`}
          icon={<UsersIcon size={20} />}
          onClick={() => onNavigate('leads')}
        />
        <MetricCard
          label="CONNECTED ACCOUNTS"
          value={accounts.filter((a) => a.connection === 'Connected' && a.hasCredentials).length}
          subtitle={`${accounts.filter((a) => a.status === 'Paused').length} paused · ${accounts.filter((a) => a.status === 'Needs attention').length} need attention`}
          icon={<AccountIcon size={20} />}
          onClick={() => onNavigate('accounts')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <SurfacePanel className="lg:col-span-7 p-6 space-y-4">
          <h2 className="text-[17px] font-semibold">
            {isCancelled ? 'No active direct send' : sendingState.runTitle}
          </h2>
          <p className="text-[13px] text-[var(--color-muted)]">
            {isCancelled
              ? 'Campaign cancelled. Initiate a new send when ready.'
              : sendingState.runSubtitle}
          </p>
          <div className="h-2 bg-[var(--color-subtle)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-brand)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-[12px]">
            {isCancelled
              ? '0 sent of 0 planned · 0 queued'
              : `${displaySent} sent of ${displayPlanned} planned · ${displayQueued} queued`}
          </p>
        </SurfacePanel>

        <SurfacePanel className="lg:col-span-5 p-6 space-y-3">
          <h2 className="text-[17px] font-semibold">Scouting plans</h2>
          {!plans.length && (
            <p className="text-[13px] text-[var(--color-muted)]">No scouting plans yet.</p>
          )}
          {plans.map((p) => (
            <button
              key={p.id}
              onClick={() => onNavigate('scouting-plans')}
              className="block w-full text-left p-3 bg-[var(--color-subtle)] rounded-[12px]"
            >
              <span className="text-[13px] font-semibold">{p.name}</span>
              <span className="float-right text-[12px] text-[var(--color-muted)]">
                {p.status}
              </span>
            </button>
          ))}
        </SurfacePanel>
      </div>

      <SurfacePanel className="p-6 space-y-4">
        <h2 className="text-[17px] font-semibold">Recent inbox replies</h2>
        {!threads.length && (
          <p className="text-[13px] text-[var(--color-muted)]">No replies received today.</p>
        )}
        {threads.slice(0, 5).map((t) => (
          <button
            key={t.id}
            className="block w-full text-left border-b border-[var(--color-border)] py-3"
            onClick={() => {
              onSelectThread(t.id);
              onNavigate('inbox');
            }}
          >
            <p className="text-[13px] font-semibold">
              {t.contactName} · {t.subject}
            </p>
            <p className="text-[12px] text-[var(--color-muted)] truncate">{t.snippet}</p>
          </button>
        ))}
      </SurfacePanel>
    </div>
  );
}
