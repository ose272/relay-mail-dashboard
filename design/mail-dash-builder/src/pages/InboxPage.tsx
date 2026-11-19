import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, MailOpen, Search, Star, Send } from 'lucide-react';
import { InboxThread, ThreadTag } from '../types/maildash';
import { InboxIcon } from '../components/ui/BrandIcons';
import {
  Avatar,
  MetricCard,
  PortfolioPillButton,
  StatusBadge,
  SurfacePanel,
} from '../components/ui/DesignSystem';

interface InboxPageProps {
  onSync: () => Promise<void>;
  threads: InboxThread[];
  selectedThreadId: string;
  onSelectThread: (id: string) => void;
  onSendReply: (threadId: string, body: string) => Promise<unknown>;
  onUpdateThreadTag: (threadId: string, tag: ThreadTag) => void;
  onToggleStar: (threadId: string) => void;
  onToggleArchive: (threadId: string) => void;
  onToggleRead: (threadId: string) => void;
}

type InboxFilter = 'All' | 'Unread' | 'Interested' | 'Starred' | 'Archived';

export const InboxPage: React.FC<InboxPageProps> = ({
  onSync,
  threads,
  selectedThreadId,
  onSelectThread,
  onSendReply,
  onUpdateThreadTag,
  onToggleStar,
  onToggleArchive,
  onToggleRead,
}) => {
  const [filter, setFilter] = useState<InboxFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [replyText, setReplyText] = useState('');
  const replyDrafts=useRef<Record<string,string>>({});
  const [sending,setSending]=useState(false), [syncing,setSyncing]=useState(false);

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      if (filter === 'Archived') {
        if (!t.archived) return false;
      } else {
        if (t.archived) return false;
        if (filter === 'Unread' && !t.unread) return false;
        if (filter === 'Interested' && t.tag !== 'Interested') return false;
        if (filter === 'Starred' && !t.starred) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.contactName.toLowerCase().includes(q) ||
          t.contactEmail.toLowerCase().includes(q) ||
          t.company.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.snippet.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [threads, filter, searchQuery]);

  const activeThread =
    filteredThreads.find((t) => t.id === selectedThreadId) ??
    filteredThreads[0] ??
    null;

  const unreadCount = threads.filter((t) => t.unread && !t.archived).length;
  const interestedCount = threads.filter(
    (t) => t.tag === 'Interested' && !t.archived
  ).length;
  const followUpCount = threads.filter(
    (t) => t.tag === 'Follow up' && !t.archived
  ).length;

  const getTagTone = (tag: ThreadTag) => {
    switch (tag) {
      case 'Interested':
        return 'success';
      case 'Question':
        return 'brand';
      case 'Follow up':
        return 'warning';
      case 'Not now':
        return 'neutral';
    }
  };

  useEffect(()=>{if(activeThread && activeThread.id !== selectedThreadId)onSelectThread(activeThread.id);},[activeThread?.id,selectedThreadId]);
  useEffect(()=>{setReplyText(replyDrafts.current[activeThread?.id || ''] || '');},[activeThread?.id]);
  const handleReplySubmit=async(e:React.FormEvent)=>{e.preventDefault();if(!activeThread || !replyText.trim() || sending)return;setSending(true);try{await onSendReply(activeThread.id,replyText.trim());replyDrafts.current[activeThread.id]='';setReplyText('');}catch{}finally{setSending(false);}};
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold text-[var(--color-text)] tracking-[-0.8px] leading-[1.25]">
            Unified inbox
          </h1>
          <p className="text-[14px] text-[var(--color-muted)] mt-1">
            Check replies manually with Sync connected inboxes, then respond from the receiving account.
          </p>
        </div>

        <PortfolioPillButton
          variant="secondary"
          size="md"
          disabled={syncing}
          onClick={async()=>{setSyncing(true);try{await onSync();}finally{setSyncing(false);}}}
        >
          {syncing ? 'Syncing…' : 'Sync connected inboxes'}
        </PortfolioPillButton>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard
          label="CONVERSATIONS"
          value={threads.filter((t) => !t.archived).length}
          subtitle="Since midnight · Africa/Lagos"
          icon={<InboxIcon size={20} />}
          active={filter === 'All'}
          onClick={() => setFilter('All')}
        />
        <MetricCard
          label="UNREAD"
          value={unreadCount}
          subtitle="Awaiting review"
          icon={<InboxIcon size={20} />}
          active={filter === 'Unread'}
          onClick={() => setFilter('Unread')}
        />
        <MetricCard
          label="INTERESTED"
          value={interestedCount}
          subtitle="Positive buyer intent"
          icon={<InboxIcon size={20} />}
          active={filter === 'Interested'}
          onClick={() => setFilter('Interested')}
        />
        <MetricCard
          label="FOLLOW UP"
          value={followUpCount}
          subtitle="Tagged for follow-up"
          icon={<InboxIcon size={20} />}
          onClick={() => setFilter('All')}
        />
      </div>

      {/* Main Split Inbox Panel */}
      <SurfacePanel className="overflow-hidden">
        {/* Filter & Search Toolbar */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--color-subtle)] overflow-x-auto">
            {(
              ['All', 'Unread', 'Interested', 'Starred', 'Archived'] as InboxFilter[]
            ).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 rounded-[7px] text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  filter === tab
                    ? 'bg-[var(--color-surface)] text-[var(--color-brand)] shadow-xs'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-[290px]">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contact, company, or subject..."
              className="w-full h-[38px] pl-9 pr-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-brand)]"
            />
          </div>
        </div>

        {/* 2-Pane Reader */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[540px]">
          {/* Thread List */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-[var(--color-border)] divide-y divide-[var(--color-border)] max-h-[600px] overflow-y-auto">
            {filteredThreads.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-[14px] font-semibold text-[var(--color-text)]">
                  No matching conversations
                </p>
                <p className="text-[12px] text-[var(--color-muted)]">
                  Try clearing your search or switching inbox filters.
                </p>
              </div>
            ) : (
              filteredThreads.map((thr) => {
                const selected = activeThread?.id === thr.id;
                return (
                  <button
                    key={thr.id}
                    type="button"
                    onClick={() => onSelectThread(thr.id)}
                    className={`relative w-full px-5 py-4 text-left transition-colors cursor-pointer flex items-start gap-3.5 ${
                      selected
                        ? 'bg-[var(--color-tint)]/65'
                        : 'hover:bg-[var(--color-subtle)]/60'
                    }`}
                  >
                    {selected && (
                      <span
                        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[var(--color-brand)]"
                        aria-hidden="true"
                      />
                    )}
                    <Avatar src={thr.avatarUrl} name={thr.contactName} size={38} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[13px] truncate ${
                            thr.unread
                              ? 'font-semibold text-[var(--color-text)]'
                              : 'font-medium text-[var(--color-text)]'
                          }`}
                        >
                          {thr.contactName}
                        </span>
                        <span className="text-[11px] text-[var(--color-muted)] tabular-nums shrink-0">
                          {thr.timestamp}
                        </span>
                      </div>
                      <p className="text-[12px] font-medium text-[var(--color-text)] truncate">
                        {thr.subject}
                      </p>
                      <p className="text-[12px] text-[var(--color-muted)] truncate">
                        {thr.snippet}
                      </p>
                      <div className="pt-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[var(--color-muted)] truncate">
                          {thr.company} · {thr.accountEmail}
                        </span>
                        <StatusBadge
                          label={thr.tag}
                          tone={getTagTone(thr.tag)}
                        />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Conversation Detail & Reply Composer */}
          <div className="lg:col-span-7 flex flex-col justify-between bg-[var(--color-surface)]">
            {activeThread ? (
              <>
                <div>
                  {/* Thread Header */}
                  <div className="px-6 py-5 border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <Avatar
                        src={activeThread.avatarUrl}
                        name={activeThread.contactName}
                        size={44}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-[16px] font-semibold text-[var(--color-text)]">
                            {activeThread.contactName}
                          </h2>
                          <span className="text-[12px] text-[var(--color-muted)]">
                            &lt;{activeThread.contactEmail}&gt;
                          </span>
                        </div>
                        <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                          {activeThread.role} at {activeThread.company} · Plan:{' '}
                          <span className="text-[var(--color-text)] font-medium">
                            {activeThread.planName}
                          </span>
                        </p>
                        <p className="text-[13px] font-medium text-[var(--color-text)] mt-2">
                          {activeThread.subject}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={activeThread.tag}
                        onChange={(e) =>
                          onUpdateThreadTag(
                            activeThread.id,
                            e.target.value as ThreadTag
                          )
                        }
                        aria-label="Conversation status tag"
                        className="h-8 px-2.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-subtle)] text-[11px] font-medium text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)] cursor-pointer"
                      >
                        <option value="Interested">Interested</option>
                        <option value="Question">Question</option>
                        <option value="Follow up">Follow up</option>
                        <option value="Not now">Not now</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => onToggleStar(activeThread.id)}
                        className={`w-8 h-8 rounded-[8px] border border-[var(--color-border)] inline-flex items-center justify-center transition-colors cursor-pointer ${
                          activeThread.starred
                            ? 'bg-[var(--color-warningTint)] text-[var(--color-warning)]'
                            : 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                        }`}
                        title="Star conversation"
                        aria-label="Star conversation"
                      >
                        <Star
                          size={14}
                          fill={activeThread.starred ? 'currentColor' : 'none'}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleRead(activeThread.id)}
                        className="w-8 h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors cursor-pointer"
                        title={
                          activeThread.unread ? 'Mark as read' : 'Mark as unread'
                        }
                        aria-label="Toggle read status"
                      >
                        <MailOpen size={14} />
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleArchive(activeThread.id)}
                        className="w-8 h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors cursor-pointer"
                        title={
                          activeThread.archived
                            ? 'Restore to inbox'
                            : 'Archive thread'
                        }
                        aria-label="Archive thread"
                      >
                        <Archive size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Message History */}
                  <div className="p-6 space-y-4 max-h-[340px] overflow-y-auto">
                    {activeThread.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`rounded-[14px] p-4 border ${
                          msg.isOutbound
                            ? 'bg-[var(--color-subtle)]/70 border-[var(--color-border)]'
                            : 'bg-[var(--color-tint)]/45 border-[var(--color-brand)]/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-[12px] font-semibold text-[var(--color-text)]">
                            {msg.senderName}{' '}
                            <span className="font-normal text-[var(--color-muted)]">
                              ({msg.senderEmail})
                            </span>
                          </div>
                          <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                            {msg.timestamp}
                          </span>
                        </div>
                        <p className="text-[13px] text-[var(--color-text)] whitespace-pre-line leading-[1.55]">
                          {msg.body}
                          {msg.sendState && !['sent','received'].includes(msg.sendState) && <span className="block mt-2 text-[var(--color-warning)]">Delivery status: {msg.sendState}. Check the sender’s Sent folder before retrying.</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reply Composer */}
                <form
                  onSubmit={handleReplySubmit}
                  className="p-5 border-t border-[var(--color-border)] bg-[var(--color-canvas)]/45 space-y-3"
                >
                  <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                    <span>
                      Replying from{' '}
                      <strong className="font-medium text-[var(--color-text)]">
                        {activeThread.accountEmail}
                      </strong>
                    </span>
                    <span>To: {activeThread.contactEmail}</span>
                  </div>
                  <textarea
                    rows={3}
                    value={replyText}
                    onChange={(e) => {setReplyText(e.target.value);if(activeThread)replyDrafts.current[activeThread.id]=e.target.value;}}
                    placeholder={`Write a reply to ${activeThread.contactName}...`}
                    className="w-full p-3.5 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-brand)] resize-none"
                  />
                  <div className="flex items-center justify-end gap-3">
                    <PortfolioPillButton
                      type="submit"
                      variant="primary"
                      size="md"
                      disabled={sending || !replyText.trim()}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Send size={13} />
                        Send reply
                      </span>
                    </PortfolioPillButton>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-12 text-center">
                <div className="space-y-2">
                  <p className="text-[15px] font-semibold text-[var(--color-text)]">
                    Select a conversation
                  </p>
                  <p className="text-[12px] text-[var(--color-muted)]">
                    Choose a thread from the left list to read messages and reply.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </SurfacePanel>
    </div>
  );
};
