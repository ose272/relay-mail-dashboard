import {DailyUsage} from '../components/DailyUsage';
import { useEffect, useState } from 'react';
import type { WorkspaceSettings } from '../types/maildash';
import { PortfolioPillButton, SurfacePanel } from '../components/ui/DesignSystem';

interface Props {
  onUsageRefresh:(usage:{sendingHeld:boolean})=>void;
  settings: WorkspaceSettings;
  onSaveSettings: (s: WorkspaceSettings) => Promise<unknown>;
  theme: 'light' | 'dark';
  onSetTheme: (s: 'light' | 'dark') => void;
}

export function SettingsPage({ settings, onSaveSettings, theme, onSetTheme,onUsageRefresh }: Props) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const save = async (e: any) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await onSaveSettings(draft);
      setSaved(true);
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.8px]">Workspace settings</h1>
          <p className="text-[14px] text-[var(--color-muted)] mt-1">Sending limits and appearance.</p>
        </div>
        <PortfolioPillButton onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </PortfolioPillButton>
      </div>
      {saved && <p role="status">Changes saved.</p>}
      <DailyUsage onRefresh={onUsageRefresh}/>

      <SurfacePanel className="p-6">
        <form onSubmit={save} className="space-y-6 max-w-[780px]">
          <label className="block text-[13px] font-medium">
            Workspace name
            <input
              required
              value={draft.workspaceName}
              onChange={e => setDraft({ ...draft, workspaceName: e.target.value })}
              className="block mt-2 w-full h-[42px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)]"
            />
          </label>

          <label className="block text-[13px] font-medium">
            Default cap per sender / rolling 24 hours
            <input
              type="number"
              min="1"
              max="40"
              required
              value={draft.dailyWorkspaceCap}
              onChange={e => setDraft({ ...draft, dailyWorkspaceCap: Number(e.target.value) })}
              className="block mt-2 w-full h-[42px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)]"
            />
          </label>
          <p className="text-[12px] text-[var(--color-muted)]">
            Saving applies this cap to all senders. Individual caps can then be adjusted in Accounts. Inbox day boundary: Africa/Lagos. Mailbox syncing runs only when you trigger it. Background sending processes up to 2250 messages per scheduler batch across 150 concurrent senders, subject to available quota and provider speed; temporary rejections have at most three delayed retries.
          </p>

          <label className="block text-[13px] font-medium">
            Account-health alert email (optional)
            <input
              type="email"
              value={draft.healthNotificationEmail || ''}
              onChange={e => setDraft({ ...draft, healthNotificationEmail: e.target.value })}
              className="block mt-2 w-full h-[42px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)]"
            />
          </label>
          <p className="text-[12px] text-[var(--color-muted)]">
            Saving the recipient does not send an email. The manual connection check updates dashboard health without sending a notification.
          </p>

          <div className="pt-2 border-t border-[var(--color-border)] space-y-4">
            <label className="block text-[13px] font-medium">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(draft.openTracking)}
                  onChange={e => setDraft({ ...draft, openTracking: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 focus-visible:outline focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                />
                <span>Open tracking</span>
              </span>
              <p className="text-[12px] text-[var(--color-muted)] mt-1 ml-6">
                Add invisible tracking pixel to sent emails. Recipients will be counted when they open the email.
              </p>
            </label>

            <label className="block text-[13px] font-medium">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(draft.planOpenTracking)}
                  onChange={e => setDraft({ ...draft, planOpenTracking: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 focus-visible:outline focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                />
                <span>Plan open tracking</span>
              </span>
              <p className="text-[12px] text-[var(--color-muted)] mt-1 ml-6">
                Track opens for future sends, attributed to the scouting plan used. Privacy settings can affect reported opens.
              </p>
            </label>

            <label className="block text-[13px] font-medium">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(draft.includeSpamFolders)}
                  onChange={e => setDraft({ ...draft, includeSpamFolders: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 focus-visible:outline focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                />
                <span>Include spam folders</span>
              </span>
              <p className="text-[12px] text-[var(--color-muted)] mt-1 ml-6">
                Synchronize Gmail spam folder messages and replies.
              </p>
            </label>
          </div>

          <label className="block text-[13px]"><input type="checkbox" checked={Boolean(draft.linkTracking)} onChange={e=>setDraft({...draft,linkTracking:e.target.checked})}/> Track link clicks in future messages</label>
          <div className="flex gap-3">
            {(['light', 'dark'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => onSetTheme(t)}
                className={`px-5 py-3 border rounded-[14px] ${theme === t ? 'border-[var(--color-brand)] bg-[var(--color-tint)]' : 'border-[var(--color-border)]'}`}
              >
                {t === 'light' ? 'Light mode' : 'Dark mode'}
              </button>
            ))}
          </div>

          <p className="text-[12px] text-[var(--color-muted)]">
            Automated warmup, signatures, follow-up sequences and configurable send delays are unavailable in this version.
          </p>
        </form>
      </SurfacePanel>
    </div>
  );
}

export default SettingsPage;
