import { useCallback, useEffect, useRef, useState } from 'react';

export type IconName = 'grid' | 'inbox' | 'send' | 'users' | 'plan' | 'accounts' | 'chart' | 'settings' | 'search' | 'bell' | 'help' | 'moon' | 'sun' | 'chevron' | 'plus' | 'arrow' | 'check' | 'clock' | 'close' | 'menu' | 'shield' | 'upload' | 'more' | 'archive';
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, string> = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    inbox: 'M4 4h16l2 12v4H2v-4L4 4z M2 15h6l2 3h4l2-3h6',
    send: 'm21 3-6 18-4-8-8-4 18-6z M11 13 21 3',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4',
    plan: 'M8 3h12v18H4V7h4V3z M8 3v4H4 M8 12h8 M8 16h6',
    accounts: 'M3 5h18v14H3z m0 1 9 7 9-7',
    chart: 'M4 3v18h18 M9 17v-5 M14 17V8 M19 17V4',
    settings: 'm9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 3 3 3-2v-3l3-2v-4l-3-1-1-4-4-1-2 3z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    help: 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    moon: 'M21 13A9 9 0 0 1 11 3 9 9 0 1 0 21 13',
    sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    chevron: 'm9 6 6 6-6 6', plus: 'M12 5v14 M5 12h14',
    arrow: 'M4 12h16 m-6-6 6 6-6 6', check: 'm5 12 4 4L19 6',
    clock: 'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    close: 'm6 6 12 12 M6 18 18 6', menu: 'M4 6h16 M4 12h16 M4 18h16',
    shield: 'm12 3 9 4v6c0 5-9 9-9 9s-9-4-9-9V7l9-4z m-4 9 3 3 5-6',
    upload: 'M12 16V3 m-5 5 5-5 5 5 M3 15v6h18v-6',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    archive: 'M3 3h18v5H3z M5 8v13h14V8 M10 12h4',
  };
  return <svg className={`h-[18px] w-[18px] shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export const navigation: { label: string; icon: IconName }[] = [
  { label: 'Overview', icon: 'grid' }, { label: 'Inbox', icon: 'inbox' }, { label: 'Sending', icon: 'send' },
  { label: 'Leads', icon: 'users' }, { label: 'Scouting Plans', icon: 'plan' }, { label: 'Accounts', icon: 'accounts' },
  { label: 'Analytics', icon: 'chart' }, { label: 'Settings', icon: 'settings' },
];
export const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium transition duration-200 hover:bg-[var(--hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:saturate-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none';
export const primary = `${button} !border-[#1237e8] !bg-[#1237e8] !text-white hover:!bg-blue-800`;
export const panel = 'rounded-xl border border-[var(--line)] bg-[var(--surface)]';
export function Badge({ children, tone = 'green' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${tone === 'green' ? 'bg-emerald-50 text-emerald-800' : tone === 'amber' ? 'bg-amber-50 text-amber-800' : tone === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>;
}
export function Logo() {
  return <div className="flex items-center gap-2.5"><img src="/sendar/sendar-logo.jpg" alt="Sendar logo" width="36" height="36" className="h-9 w-9 shrink-0 rounded-[11px] object-cover"/><span className="text-[26px] font-bold tracking-[-1.2px]">Sendar<span className="text-[#1237e8]">.</span></span></div>;
}
export function Modal({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('input,textarea,select') || el?.querySelector<HTMLElement>('button'))?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      if (e.key !== 'Tab' || !el) return;
      const all = el.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex="0"]');
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm motion-safe:animate-[veil_160ms_ease-out]" onClick={close}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()} className={`${panel} max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 shadow-xl motion-safe:animate-[arrive_220ms_ease-out]`}><div className="mb-5 flex items-center justify-between"><h2 id="modal-title" className="text-xl font-semibold">{title}</h2><button className={`${button} !px-3`} onClick={close} aria-label="Close dialog"><Icon name="close" /></button></div>{children}</div></div>;
}
export function Empty({ icon, title, description, action, onClick }: { icon: IconName; title: string; description: string; action?: string; onClick?: () => void }) {
  return <div className="flex flex-col items-center px-6 py-14 text-center"><span className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-blue-700"><Icon name={icon} className="!h-7 !w-7" /></span><h2 className="text-lg font-semibold tracking-tight">{title}</h2><p className="mt-2 max-w-sm leading-6 text-[var(--muted)]">{description}</p>{action && <button className={`${primary} mt-6`} onClick={onClick}><Icon name="plus" />{action}</button>}</div>;
}
