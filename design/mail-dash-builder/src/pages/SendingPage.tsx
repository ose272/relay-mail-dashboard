import {FeatureControls,type FeatureFlags} from '../components/FeatureControls';
import {DailyUsage} from '../components/DailyUsage';
import { TrackingAnalytics } from '../components/TrackingAnalytics';
import React, { useMemo, useState } from 'react';
import { ArrowUpDown, RotateCcw, CheckCircle2, Trash2 } from 'lucide-react';
import {
  ConnectedAccount,
  DeliveryRecord,
  DeliveryResultStatus,
  SendingState,
} from '../types/maildash';
import {
  AlertCircleIcon,
  ClockIcon,
  SendIcon,
  XMarkIcon,
} from '../components/ui/BrandIcons';
import {
  MetricCard,
  ModalShell,
  NoticeBanner,
  PortfolioPillButton,
  StatusBadge,
  SurfacePanel,
} from '../components/ui/DesignSystem';

interface SendingPageProps {
  features:FeatureFlags;
  onFeatureChange:(flags:Partial<FeatureFlags>)=>Promise<void>;
  onUsageRefresh:(usage:{sendingHeld:boolean})=>void;
  sendingState: SendingState;
  accounts: ConnectedAccount[];
  onResumePreparation:()=>void;
  preparationRequestFailed?:boolean;
  onCancel:()=>Promise<unknown>;
  onRebalance:()=>Promise<unknown>;
  onToggleRunStatus: () => Promise<unknown>;
  onInitiateSending: (payload: {
    runTitle: string;
    sender: string;
    subject: string;
    recipients: string[];
  }) => Promise<unknown>;
  onResolveAll?:(resolution:'retry'|'dismiss')=>Promise<unknown>;
  onResolveRecord: (recordId: string, resolution: 'retry' | 'dismiss') => Promise<unknown>;
}

type TableFilter = 'All' | DeliveryResultStatus;

export const SendingPage: React.FC<SendingPageProps> = ({
  sendingState, features,onFeatureChange,onUsageRefresh,
  accounts,
  onToggleRunStatus,
  onInitiateSending, onRebalance, onCancel, onResumePreparation, preparationRequestFailed,
  onResolveRecord,onResolveAll,
}) => {
  const [sortLatestFirst, setSortLatestFirst] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TableFilter>('All');
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [initiateModalOpen, setInitiateModalOpen] = useState(false);

  const flaggedRecords = useMemo(
    () =>
      sendingState.records.filter(
        (r) => r.result === 'Failed' || r.result === 'Needs review'
      ),
    [sendingState.records]
  );

  const visibleRecords = useMemo(() => {
    const filtered =
      statusFilter === 'All'
        ? sendingState.records
        : sendingState.records.filter((r) => r.result === statusFilter);

    return [...filtered].sort((a, b) =>
      sortLatestFirst
        ? b.timestampMs - a.timestampMs
        : a.timestampMs - b.timestampMs
    );
  }, [sendingState.records, statusFilter, sortLatestFirst]);

  const progressPct = Math.min(
    100,
    Math.round(
      (sendingState.sentCount / Math.max(1, sendingState.plannedTotal)) * 10000
    ) / 100
  );

  const [submitting,setSubmitting]=useState(false);
  const [cancelOpen,setCancelOpen]=useState(false),[cancelling,setCancelling]=useState(false);
  const handleCreateSend=async(e:React.FormEvent)=>{e.preventDefault();if(submitting)return;setSubmitting(true);try{await onInitiateSending({runTitle:'Direct send',sender:'',subject:'',recipients:[]});setInitiateModalOpen(false);}catch{}finally{setSubmitting(false);}};
  const renderResultBadge = (result: DeliveryResultStatus) => {
    switch (result) {
      case 'Sent':
        return <StatusBadge label="Sent" tone="success" icon="check" />;
      case 'Failed':
        return <StatusBadge label="Failed" tone="danger" icon="x" />;
      case 'Needs review':
        return <StatusBadge label="Needs review" tone="warning" icon="alert" />;
      case 'Queued':
        return <StatusBadge label="Queued" tone="brand" icon="none" />;
    }
  };

  return (
    <div className="space-y-6">
      {cancelOpen && <ModalShell open={cancelOpen} title="Cancel this campaign?" subtitle={`Stop the remaining ${Math.max(0,sendingState.queuedCount-(sendingState.inFlight || 0))} queued emails. Completed sends remain in history.`} onClose={()=>{if(!cancelling)setCancelOpen(false);}}><div className="flex justify-end gap-3"><PortfolioPillButton variant="secondary" disabled={cancelling} onClick={()=>setCancelOpen(false)}>Keep campaign</PortfolioPillButton><PortfolioPillButton variant="primary" disabled={cancelling} onClick={async()=>{setCancelling(true);try{await onCancel();setCancelOpen(false);}catch{}finally{setCancelling(false);}}}>{cancelling?'Cancelling…':'Confirm cancellation'}</PortfolioPillButton></div></ModalShell>}
      {sendingState.backendStatus==='Cancelled' && <p role="status" className="text-[13px] text-[var(--color-muted)]">Campaign cancelled · {sendingState.cancelledCount || 0} queued emails stopped. You can import leads and initiate a new campaign.</p>}
      {/* Page Title & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold text-[var(--color-text)] tracking-[-0.8px] leading-[1.25]">
            Sending activity
          </h1>
          <p className="text-[14px] text-[var(--color-muted)] mt-1">
            Manage live outreach runs and review delivery status.
          </p>
        </div>

        <PortfolioPillButton
          variant="primary"
          size="lg"
          onClick={() => setInitiateModalOpen(true)}
          className="min-w-[228px]"
        >
          + Initiate sending
        </PortfolioPillButton>
      </div>

      {/* Review Notice Banner */}
      {(!!sendingState.id && (sendingState.status === 'paused' || flaggedRecords.length > 0)) && (
        <NoticeBanner
          title={
            sendingState.status === 'paused'
              ? 'Sending is paused'
              : `${flaggedRecords.length} message${flaggedRecords.length === 1 ? '' : 's'} flagged for delivery review`
          }
          subtitle="Unconfirmed messages stay in review without automatic retries. Other eligible queued messages can continue sending."
          actionLabel="Review messages"
          onAction={() => setReviewModalOpen(true)}
          tone="brand"
        />
      )}

      <DailyUsage onRefresh={onUsageRefresh}/>
      <FeatureControls features={features} onChange={onFeatureChange}/>
      <TrackingAnalytics key={`${features.openTracking}:${features.planOpenTracking}:${features.linkTracking}`} campaignId={sendingState.id}/>
      {/* 4 KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard
          label="SENT"
          value={sendingState.sentCount}
          subtitle="Accepted · no recorded bounce"
          icon={<SendIcon size={20} />}
          active={statusFilter === 'Sent'}
          onClick={() =>
            setStatusFilter((prev) => (prev === 'Sent' ? 'All' : 'Sent'))
          }
        />
        <MetricCard
          label="QUEUED"
          value={sendingState.queuedCount}
          subtitle="Waiting to send"
          icon={<ClockIcon size={20} />}
          active={statusFilter === 'Queued'}
          onClick={() =>
            setStatusFilter((prev) => (prev === 'Queued' ? 'All' : 'Queued'))
          }
        />
        <MetricCard
          label="FAILED"
          value={sendingState.failedCount}
          subtitle="Rejected or bounced"
          icon={<XMarkIcon size={20} />}
          active={statusFilter === 'Failed'}
          onClick={() =>
            setStatusFilter((prev) =>
              prev === 'Failed' ? 'All' : 'Failed'
            )
          }
        />
        <MetricCard
          label="NEEDS REVIEW"
          value={sendingState.needsReviewCount}
          subtitle="Unconfirmed delivery"
          icon={<AlertCircleIcon size={20} />}
          active={statusFilter === 'Needs review'}
          onClick={() =>
            setStatusFilter((prev) =>
              prev === 'Needs review' ? 'All' : 'Needs review'
            )
          }
        />
      </div>

      {/* Main Direct Send Activity Panel */}
      <SurfacePanel className="overflow-hidden">
        {/* Panel Header */}
        <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="w-10 h-10 rounded-[12px] bg-[var(--color-tint)] text-[var(--color-brand)] inline-flex items-center justify-center shrink-0">
              <SendIcon size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold text-[var(--color-text)] leading-[1.35]">
                {sendingState.runTitle}
              </h2>
              <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                {sendingState.runSubtitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {!sendingState.id ? <StatusBadge label="NO CAMPAIGN" tone="neutral" /> : sendingState.status === 'completed' ? <StatusBadge label={sendingState.backendStatus==='Cancelled'?'CANCELLED':'COMPLETE'} tone={sendingState.backendStatus==='Cancelled'?'neutral':'success'} /> : sendingState.status === 'paused' ? (
              <StatusBadge label="PAUSED" tone="warning" icon="pause" size="md" />
            ) : (
              <StatusBadge label={sendingState.backendStatus==='Preparing'?'PREPARING':sendingState.backendStatus==='Scheduled'?'SCHEDULED':'RUNNING'} tone="success" icon="check" size="md" />
            )}

            {sendingState.id && <PortfolioPillButton
              variant="primary"
              size="md"
              disabled={!sendingState.id || sendingState.status === 'completed' || sendingState.backendStatus==='Preparing'}
              onClick={onToggleRunStatus}
              className="min-w-[140px]"
            >
              {sendingState.status === 'paused' ? 'Resume queued' : 'Pause'}
            </PortfolioPillButton>}
            {sendingState.id && sendingState.status!=='completed' && <PortfolioPillButton variant="secondary" size="md" onClick={()=>setCancelOpen(true)}>Cancel campaign</PortfolioPillButton>}
          </div>
        </div>

        {/* Panel Body */}
        <div className="p-6 space-y-6">
          {sendingState.id && sendingState.sentCount===0 && sendingState.queuedCount>0 && <p className="text-[13px] text-[var(--color-muted)]">No messages have been confirmed sent yet. Delivery progress increases only after the sender confirms a send.</p>}
          {sendingState.id && sendingState.status==='paused' && !sendingState.needsReviewCount && sendingState.queuedCount>0 && <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-[12px] text-[var(--color-muted)]"><PortfolioPillButton variant="secondary" onClick={onRebalance}>Use newly connected accounts</PortfolioPillButton><span>Redistribute queued work across connected accounts before resuming.</span></div>}
          {sendingState.backendStatus==='Preparing' && <div role="status" className="space-y-3 p-4 rounded-[12px] bg-[var(--color-subtle)]"><strong className="text-[14px]">{(sendingState.preparation?.error || preparationRequestFailed)?'Preparation interrupted':'Preparing campaign'}</strong><p className="text-[13px]">{sendingState.preparation?.prepared || 0} of {sendingState.preparation?.total || sendingState.plannedTotal} delivery records saved · {sendingState.preparation?.readySenders || 0} of {sendingState.preparation?.senders || 0} sender queues ready</p><progress aria-label="Campaign preparation progress" className="w-full h-2" max={(sendingState.preparation?.total || 0)+(sendingState.preparation?.senders || 0)||1} value={(sendingState.preparation?.prepared || 0)+(sendingState.preparation?.readySenders || 0)}/><p className="text-[12px] text-[var(--color-muted)]">Sending begins after delivery records and sender queues are ready. Progress is saved after each batch.</p>{(sendingState.preparation?.error || preparationRequestFailed) && sendingState.preparation?.error!=='LEGACY_PREPARATION_REVIEW' && <button type="button" className="underline text-[13px]" onClick={onResumePreparation}>Resume preparation</button>}</div>}
          {/* Delivery Progress */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                DELIVERY PROGRESS
              </span>
              <span className="text-[12px] text-[var(--color-muted)] tabular-nums">
                {sendingState.sentCount} sent of {sendingState.plannedTotal} planned ({progressPct}%)
              </span>
            </div>
            <div role="progressbar" aria-label="Confirmed delivery progress" aria-valuemin={0} aria-valuemax={sendingState.plannedTotal || 1} aria-valuenow={sendingState.sentCount} className="w-full h-2 rounded-full bg-[var(--color-subtle)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-1000 ease-out motion-reduce:transition-none"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {sendingState.id && <p role="status" className="text-[12px] text-[var(--color-muted)] tabular-nums">{sendingState.status==='running' ? sendingState.inFlight ? `${sendingState.inFlight} accounts sending now · ` : sendingState.backendStatus==='Scheduled' && sendingState.nextSendAt ? `Scheduled for ${new Date(sendingState.nextSendAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})} Lagos time · ` : 'Waiting for the next background batch · ' : ''}{sendingState.updatedAt ? `Updated ${new Date(sendingState.updatedAt).toLocaleTimeString('en-GB',{timeZone:'Africa/Lagos'})} · ` : ''}Accepted sends minus recorded bounces · Check bounces with manual inbox sync{sendingState.status==='running' && sendingState.backendStatus==='Sending' ? ' · Live counters refresh every 2 seconds' : ''}</p>}

          {/* Activity Table Header Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-[15px] font-semibold text-[var(--color-text)]">
                Delivery activity · latest 50 per status
              </h3>
              {statusFilter !== 'All' && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('All')}
                  className="text-[11px] font-medium text-[var(--color-brand)] bg-[var(--color-tint)] px-2.5 py-1 rounded-full cursor-pointer hover:opacity-90"
                >
                  Filter: {statusFilter} ×
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--color-subtle)]">
                {(['All', 'Sent', 'Failed', 'Needs review'] as TableFilter[]).map(
                  (filterOption) => (
                    <button
                      key={filterOption}
                      type="button"
                      onClick={() => setStatusFilter(filterOption)}
                      className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        statusFilter === filterOption
                          ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs'
                          : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      {filterOption}
                    </button>
                  )
                )}
              </div>

              <button
                type="button"
                onClick={() => setSortLatestFirst((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors whitespace-nowrap cursor-pointer"
              >
                <ArrowUpDown size={12} />
                <span>{sortLatestFirst ? 'Latest first' : 'Oldest first'}</span>
              </button>
            </div>
          </div>

          {/* Table */}
          {!visibleRecords.length ? <p className="py-8 text-[13px] text-center text-[var(--color-muted)]">No delivery records to show.</p> : <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="bg-[var(--color-subtle)] rounded-[8px]">
                  <th className="py-2 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] rounded-l-[8px]">
                    RECIPIENT
                  </th>
                  <th className="py-2 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                    SENDER
                  </th>
                  <th className="py-2 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                    RESULT
                  </th>
                  <th className="py-2 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] rounded-r-[8px] text-right">
                    TIME
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {visibleRecords.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (row.result === 'Failed' || row.result === 'Needs review') {
                        setReviewModalOpen(true);
                      }
                    }}
                    className={`h-[42px] transition-colors ${
                      row.result === 'Failed' || row.result === 'Needs review'
                        ? 'hover:bg-[var(--color-subtle)]/70 cursor-pointer'
                        : 'hover:bg-[var(--color-subtle)]/40'
                    }`}
                  >
                    <td className="py-2.5 px-4 text-[12px] font-medium text-[var(--color-text)]">
                      {row.recipient}
                    </td>
                    <td className="py-2.5 px-4 text-[12px] text-[var(--color-muted)]">
                      {row.sender}
                    </td>
                    <td className="py-2.5 px-4">
                      {renderResultBadge(row.result)}
                    </td>
                    <td className="py-2.5 px-4 text-[12px] text-[var(--color-muted)] text-right tabular-nums whitespace-nowrap">
                      {row.time}
                    </td>
                  </tr>
                ))}
                {visibleRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-8 text-center text-[13px] text-[var(--color-muted)]"
                    >
                      No delivery records match the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>}

          {/* Panel Footer Hint */}
          <div className="pt-1 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <AlertCircleIcon size={14} className="shrink-0" />
            <span>
              Showing recent messages. Unconfirmed messages require review before retry.
            </span>
          </div>
        </div>
      </SurfacePanel>

      {/* Review Flagged Messages Modal */}
      <ModalShell
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        title="Review flagged messages"
        subtitle="Inspect SMTP rejections and unconfirmed deliveries before resuming background sending."
        maxWidth="max-w-[640px]"
      >
        {flaggedRecords.length === 0 ? (
          <div className="py-8 text-center space-y-3">
            <span className="w-12 h-12 rounded-full bg-[var(--color-successTint)] text-[var(--color-success)] inline-flex items-center justify-center">
              <CheckCircle2 size={22} />
            </span>
            <p className="text-[14px] font-semibold text-[var(--color-text)]">
              No flagged messages in this activity window
            </p>
            <p className="text-[12px] text-[var(--color-muted)]">
              Review the campaign totals above. Unconfirmed deliveries stay blocked until reconciled.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] text-[13px]">
              <span className="text-[var(--color-muted)]">
                {flaggedRecords.length} message{flaggedRecords.length === 1 ? '' : 's'} to review
              </span>
              {onResolveAll && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onResolveAll?.('dismiss')}
                    className="px-3 py-1.5 rounded-[8px] border border-[var(--color-border)] text-[var(--color-danger)] text-[12px] font-medium hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer"
                  >
                    Dismiss failed notices
                  </button>
                  <button
                    type="button"
                    onClick={() => onResolveAll?.('retry')}
                    className="px-3 py-1.5 rounded-[8px] bg-[var(--color-brand)] text-white text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Retry rejected messages
                  </button>
                </div>
              )}
            </div>
            {flaggedRecords.map((rec: DeliveryRecord) => (
              <div
                key={rec.id}
                className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-subtle)]/50 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[13px] font-semibold text-[var(--color-text)]">
                        {rec.recipient}
                      </span>
                      {renderResultBadge(rec.result)}
                    </div>
                    <p className="text-[12px] text-[var(--color-muted)] mt-1">
                      From {rec.sender} · {rec.subject}
                    </p>
                  </div>
                  <span className="text-[11px] text-[var(--color-muted)] tabular-nums shrink-0">
                    {rec.time}
                  </span>
                </div>

                {rec.diagnosticNote && (
                  <p className="text-[12px] font-mono text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[8px] px-3 py-2">
                    {rec.diagnosticNote}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    disabled={rec.result==='Needs review'}
                    onClick={() => onResolveRecord(rec.id, 'dismiss')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] border border-[var(--color-border)] text-[var(--color-danger)] text-[12px] font-medium hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Dismiss</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onResolveRecord(rec.id, 'retry')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-[var(--color-brand)] text-white text-[12px] font-medium hover:opacity-95 transition-opacity cursor-pointer"
                  >
                    <RotateCcw size={13} />
                    <span>{rec.result === 'Needs review' ? 'Retry with duplicate risk' : 'Retry message'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ModalShell>

      {/* Initiate Sending Modal */}
      <ModalShell
        open={initiateModalOpen}
        onClose={() => setInitiateModalOpen(false)}
        title="Initiate direct send"
        subtitle="Use the imported lead list and saved scouting plans."
      >
        <form onSubmit={handleCreateSend} className="space-y-4">
          <p className="text-[13px] text-[var(--color-muted)]">Start sending to all eligible imported leads using active, connected senders and compatible scouting plans. Existing suppression rules and each sender’s rolling 24-hour cap apply. This starts real email delivery.</p>
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setInitiateModalOpen(false)}
              className="px-4 py-2.5 rounded-[70px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-muted)] hover:text-[var(--color-text)] cursor-pointer"
            >
              Cancel
            </button>
            <PortfolioPillButton type="submit" variant="primary" size="md" disabled={submitting}>
              Launch send batch
            </PortfolioPillButton>
          </div>
        </form>
      </ModalShell>
    </div>
  );
};
