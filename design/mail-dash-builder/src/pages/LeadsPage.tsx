import { parseLeads } from '../../../../src/domain.mjs';
import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Search,
  Send,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import { Lead, LeadBatch, LeadStatus, ScoutingPlan } from '../types/maildash';
import {
  AlertCircleIcon,
  CheckMarkIcon,
  ClockIcon,
  UsersIcon,
} from '../components/ui/BrandIcons';
import {
  MetricCard,
  ModalShell,
  PortfolioPillButton,
  StatusBadge,
  SurfacePanel,
} from '../components/ui/DesignSystem';

interface LeadsPageProps {
  totalCount:number; hasMore:boolean; onNextPage:()=>void; onFirstPage:()=>void;
  leads: Lead[];
  leadBatches: LeadBatch[];
  plans: ScoutingPlan[];
  onAddLead: (lead: Omit<Lead, 'id' | 'lastActivity'>) => Promise<unknown>;
  onImportLeadBatch: (payload: {
    rawText:string;
    batchName: string;
    sourceLabel: string;
    planName: string;
    leads: Array<Omit<Lead, 'id' | 'lastActivity' | 'batchId'>>;
  }) => Promise<unknown>;
  onDeleteBatches: (batchIds: string[]) => Promise<unknown>;
  onUpdateLeadStatus: (leadId: string, status: LeadStatus) => Promise<unknown>;
  onAssignLeadsToPlan: (leadIds: string[], planName: string) => void;
  onQueueLeadsForSending: (leadsToSend: Lead[]) => void;
}

function parseBatchRows(
  rawText: string,
  listName: string,
  planName: string
): Array<Omit<Lead, 'id' | 'lastActivity' | 'batchId'>> {
  return parseLeads(rawText, []).leads.map((lead:any)=>({id:lead.id,name:lead.name,email:lead.email,company:lead.store,role:'',listName,status:'Ready' as const,planName:'Unassigned',verified:false}));
}

export const LeadsPage: React.FC<LeadsPageProps> = ({
  totalCount,hasMore,onNextPage,onFirstPage,
  leads,
  leadBatches,
  plans,
  onAddLead,
  onImportLeadBatch,
  onDeleteBatches,
  onUpdateLeadStatus,
  onAssignLeadsToPlan,
  onQueueLeadsForSending,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | LeadStatus>('All');
  const [listFilter, setListFilter] = useState<string>('All lists');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Batch import section state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [batchName, setBatchName] = useState('');
  const [batchPlan, setBatchPlan] = useState('Unassigned');
  const [batchSourceLabel, setBatchSourceLabel] = useState('manual_paste.csv');
  const [batchText, setBatchText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  // Batch delete section state
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchesPendingDelete, setBatchesPendingDelete] = useState<LeadBatch[]>(
    []
  );

  // Add lead form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [listName, setListName] = useState('');
  const [planName, setPlanName] = useState('Unassigned');

  const uniqueLists = useMemo(
    () => ['All lists', ...Array.from(new Set(leads.map((l) => l.listName)))],
    [leads]
  );

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (statusFilter !== 'All' && l.status !== statusFilter) return false;
      if (listFilter !== 'All lists' && l.listName !== listFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          l.name.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          l.company.toLowerCase().includes(q) ||
          l.role.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [leads, statusFilter, listFilter, searchQuery]);

  const parsedBatchPreview = useMemo(
    () =>
      parseBatchRows(
        batchText,
        batchName.trim() || 'Imported Batch',
        batchPlan
      ),
    [batchText, batchName, batchPlan]
  );

  const readyCount = leads.filter((l) => l.status === 'Ready').length;
  const sequenceCount = leads.filter((l) => l.status === 'In sequence').length;
  const repliedCount = leads.filter((l) => l.status === 'Replied').length;

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredLeads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredLeads.map((l) => l.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if(file.size>9_500_000){setImportFeedback('File exceeds the upload limit. Use a smaller file.');return;}
    setBatchSourceLabel(file.name);
    const baseName = file.name.replace(/\.(csv|txt)$/i, '').replace(/[_-]+/g, ' ');
    if (baseName) {
      setBatchName(baseName);
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBatchText(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [importing,setImporting]=useState(false);
  const handleImportBatchSubmit=async(e:React.FormEvent)=>{e.preventDefault();if(!batchText.trim() || importing)return;setImporting(true);setImportFeedback(null);try{await onImportLeadBatch({rawText:batchText,batchName:batchName.trim() || batchSourceLabel,sourceLabel:batchSourceLabel,planName:'Unassigned',leads:[]});setImportFeedback('Import saved. Actual imported, duplicate and invalid counts appear in the batch list.');setBatchText('');}catch{}finally{setImporting(false);}};
  const toggleSelectBatch = (batchId: string) => {
    setSelectedBatchIds((prev) =>
      prev.includes(batchId)
        ? prev.filter((id) => id !== batchId)
        : [...prev, batchId]
    );
  };

  const toggleSelectAllBatches = () => {
    if (selectedBatchIds.length === leadBatches.length) {
      setSelectedBatchIds([]);
    } else {
      setSelectedBatchIds(leadBatches.map((b) => b.id));
    }
  };

  const handleConfirmDeleteBatches = async () => {
    if (batchesPendingDelete.length === 0) return;
    const ids = batchesPendingDelete.map((b) => b.id);
    await onDeleteBatches(ids);
    setSelectedBatchIds((prev) => prev.filter((id) => !ids.includes(id)));
    if (listFilter !== 'All lists') {
      const removedNames = new Set(batchesPendingDelete.map((b) => b.name));
      if (removedNames.has(listFilter)) {
        setListFilter('All lists');
      }
    }
    setBatchesPendingDelete([]);
  };

  const handleExportCsv = () => {
    const targetLeads =
      selectedIds.length > 0
        ? leads.filter((l) => selectedIds.includes(l.id))
        : filteredLeads;
    const csvRows = [
      ['Name', 'Email', 'Company', 'Role', 'List', 'Status', 'Plan'].join(','),
      ...targetLeads.map((l) =>
        [
          `"${l.name}"`,
          l.email,
          `"${l.company}"`,
          `"${l.role}"`,
          `"${l.listName}"`,
          l.status,
          `"${l.planName}"`,
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mail-dash-leads.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    await onAddLead({
      name: name.trim(),
      email: email.trim(),
      company: company.trim() || 'Independent',
      role: role.trim() || 'Contact',
      listName,
      status: planName === 'Unassigned' ? 'Ready' : 'In sequence',
      planName,
      verified: false,
    });
    setName('');
    setEmail('');
    setCompany('');
    setRole('');
    setAddModalOpen(false);
  };

  const renderLeadStatusBadge = (status: LeadStatus) => {
    switch (status) {
      case 'Replied':
        return <StatusBadge label="Replied" tone="success" icon="check" />;
      case 'In sequence':
        return <StatusBadge label="In sequence" tone="brand" icon="none" />;
      case 'Ready':
        return <StatusBadge label="Ready" tone="neutral" icon="none" />;
      case 'Paused':
        return <StatusBadge label="Paused" tone="warning" icon="pause" />;
      case 'Bounced':
        return <StatusBadge label="Bounced" tone="danger" icon="x" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold text-[var(--color-text)] tracking-[-0.8px] leading-[1.25]">
            Leads directory
          </h1>
          <p className="text-[14px] text-[var(--color-muted)] mt-1">
            Import prospect batches, track outreach status, and enroll lists into scouting plans.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <PortfolioPillButton
            variant="secondary"
            size="md"
            onClick={handleExportCsv}
            hideArrow
          >
            <span className="inline-flex items-center gap-2">
              <Download size={14} />
              <span>Export CSV</span>
            </span>
          </PortfolioPillButton>

          <PortfolioPillButton
            variant="primary"
            size="lg"
            onClick={() => setAddModalOpen(true)}
            className="min-w-[196px]"
          >
            + Add lead
          </PortfolioPillButton>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard
          label="TOTAL LEADS"
          value={totalCount}
          subtitle={`Across ${leadBatches.length} lead batches`}
          icon={<UsersIcon size={20} />}
          active={statusFilter === 'All'}
          onClick={() => setStatusFilter('All')}
        />
        <MetricCard
          label="READY TO CONTACT"
          value={totalCount}
          subtitle="Not verified & unassigned"
          icon={<CheckMarkIcon size={18} />}
          active={statusFilter === 'Ready'}
          onClick={() =>
            setStatusFilter((prev) => (prev === 'Ready' ? 'All' : 'Ready'))
          }
        />
        <MetricCard
          label="IMPORT BATCHES"
          value={leadBatches.length}
          subtitle="Saved uploaded files"
          icon={<ClockIcon size={20} />}
          active={statusFilter === 'In sequence'}
          onClick={() =>
            setStatusFilter((prev) =>
              prev === 'In sequence' ? 'All' : 'In sequence'
            )
          }
        />
        <MetricCard
          label="EMAIL VERIFICATION"
          value="—"
          subtitle="Mailbox validity not checked"
          icon={<AlertCircleIcon size={20} />}
          active={statusFilter === 'Replied'}
          onClick={() =>
            setStatusFilter((prev) => (prev === 'Replied' ? 'All' : 'Replied'))
          }
        />
      </div>

      <div className="flex flex-wrap gap-3 text-[12px] text-[var(--color-muted)]"><span>Showing {leads.length} of {totalCount} active leads. Search and export apply to this page.</span><button onClick={onFirstPage} className="underline">First page</button><button onClick={onNextPage} disabled={!hasMore} className="underline disabled:opacity-40">Next 100</button></div>
      {/* Import Leads Batch Section */}
      <SurfacePanel className="overflow-hidden">
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <span className="w-10 h-10 rounded-[12px] bg-[var(--color-tint)] text-[var(--color-brand)] inline-flex items-center justify-center shrink-0">
              <Upload size={19} />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold text-[var(--color-text)]">
                Import leads batch
              </h2>
              <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                Upload a CSV file or paste prospect rows to create a tracked batch
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {importFeedback && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-success)] bg-[var(--color-successTint)] px-3 py-1.5 rounded-full">
                <CheckCircle2 size={14} />
                <span>{importFeedback}</span>
              </span>
            )}

          </div>
        </div>

        <form onSubmit={handleImportBatchSubmit} className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left controls: Batch name, Plan, CSV Upload */}
            <div className="lg:col-span-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div>
                  <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1.5">
                    Batch / list name
                  </label>
                  <input
                    type="text"
                    required
                    value={batchName}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="e.g. Series B RevOps Nov"
                    className="w-full h-[40px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1.5">
                    Assign to scouting plan (optional)
                  </label>
                  <select
                    disabled value="Unassigned"
                    onChange={(e) => setBatchPlan(e.target.value)}
                    className="w-full h-[40px] px-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)] cursor-pointer"
                  >
                    <option value="Unassigned">Unassigned (Ready to contact)</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-[14px] border border-dashed border-[var(--color-border)] bg-[var(--color-subtle)]/55 hover:bg-[var(--color-tint)]/45 hover:border-[var(--color-brand)]/60 transition-colors px-4 py-4 flex items-center justify-center gap-3 cursor-pointer text-left"
                >
                  <span className="w-9 h-9 rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-brand)] inline-flex items-center justify-center shrink-0">
                    <FileSpreadsheet size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-[var(--color-text)] truncate">
                      Choose CSV or TXT file
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)] truncate">
                      Supports Name, Email, Company, Role columns
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Right controls: Paste rows & Submit */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-3">
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="text-[12px] font-medium text-[var(--color-text)]">
                    Paste CSV rows or email addresses
                  </label>
                  <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                    {parsedBatchPreview.length} valid lead
                    {parsedBatchPreview.length === 1 ? '' : 's'} detected
                  </span>
                </div>
                <textarea
                  rows={5}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder={
                    'Paste CSV with name,email,store headers, or one email address per line.'
                  }
                  className="w-full flex-1 min-h-[140px] p-3.5 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-canvas)] text-[12px] font-mono text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
                <span className="text-[11px] text-[var(--color-muted)]">
                  Source: {batchSourceLabel} · Duplicates are automatically skipped.
                </span>
                <PortfolioPillButton
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={!batchText.trim() || importing}
                >
                  Import {parsedBatchPreview.length > 0 ? `${parsedBatchPreview.length} ` : ''}
                  batch
                </PortfolioPillButton>
              </div>
            </div>
          </div>
        </form>
      </SurfacePanel>

      {/* Leads Table Panel */}
      <SurfacePanel className="overflow-hidden">
        {/* Toolbar */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative w-full sm:w-[270px]">
              <Search
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, or company..."
                className="w-full h-[38px] pl-9 pr-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>

            <select
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              aria-label="Filter by lead list"
              className="h-[38px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)] cursor-pointer"
            >
              {uniqueLists.map((list) => (
                <option key={list} value={list}>
                  {list}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'All' | LeadStatus)
              }
              aria-label="Filter by lead status"
              className="h-[38px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)] cursor-pointer"
            >
              <option value="All">All statuses</option>
              <option value="Ready">Ready</option>


              <option value="Paused">Remove / archive</option>

            </select>
          </div>

          {/* Bulk action controls */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2.5 flex-wrap bg-[var(--color-tint)] px-3.5 py-2 rounded-[10px]">
              <span className="text-[12px] font-semibold text-[var(--color-brand)] tabular-nums">
                {selectedIds.length} selected
              </span>
              <span className="text-[11px]">Plans are assigned automatically when sending begins.</span>
              <button
                type="button"
                onClick={() => {
                  const chosen = leads.filter((l) => selectedIds.includes(l.id));
                  onQueueLeadsForSending(chosen);
                  setSelectedIds([]);
                }}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-[7px] bg-[var(--color-brand)] text-white text-[11px] font-medium cursor-pointer hover:opacity-95"
              >
                <Send size={11} />
                <span>Open sending</span>
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="p-6 pt-4 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[780px]">
            <thead>
              <tr className="bg-[var(--color-subtle)]">
                <th className="py-2.5 px-4 rounded-l-[8px] w-10">
                  <input
                    type="checkbox"
                    checked={
                      filteredLeads.length > 0 &&
                      selectedIds.length === filteredLeads.length
                    }
                    onChange={toggleSelectAll}
                    aria-label="Select all visible leads"
                    className="rounded border-[var(--color-border)] accent-[var(--color-brand)] cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  CONTACT
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  COMPANY &amp; ROLE
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  LIST / PLAN
                </th>
                <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                  STATUS
                </th>
                <th className="py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] text-right rounded-r-[8px]">
                  LAST ACTIVITY
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredLeads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => setActiveLead(lead)}
                  className="hover:bg-[var(--color-subtle)]/60 transition-colors cursor-pointer"
                >
                  <td
                    className="py-3 px-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(lead.id)}
                      onChange={() => toggleSelectOne(lead.id)}
                      aria-label={`Select ${lead.name}`}
                      className="rounded border-[var(--color-border)] accent-[var(--color-brand)] cursor-pointer"
                    />
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-[13px] font-semibold text-[var(--color-text)]">
                      {lead.name}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {lead.email}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-[12px] font-medium text-[var(--color-text)]">
                      {lead.company}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {lead.role}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-[12px] text-[var(--color-text)]">
                      {lead.listName}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {lead.planName}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    {renderLeadStatusBadge(lead.status)}
                  </td>
                  <td className="py-3 px-4 text-[12px] text-[var(--color-muted)] text-right tabular-nums whitespace-nowrap">
                    {lead.lastActivity}
                  </td>
                </tr>
              ))}
              {filteredLeads.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-10 text-center text-[13px] text-[var(--color-muted)]"
                  >
                    No leads on this page match your filters. Import a list to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SurfacePanel>

      {/* Bottom Section: Delete Lead Batches */}
      <SurfacePanel className="overflow-hidden">
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="w-10 h-10 rounded-[12px] bg-[var(--color-dangerTint)] text-[var(--color-danger)] inline-flex items-center justify-center shrink-0">
              <Trash2 size={19} />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold text-[var(--color-text)]">
                Lead batches &amp; cleanup
              </h2>
              <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                Delete a batch to remove its links; shared leads and send history are preserved.
              </p>
            </div>
          </div>

          {selectedBatchIds.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setBatchesPendingDelete(
                  leadBatches.filter((b) => selectedBatchIds.includes(b.id))
                )
              }
              className="inline-flex items-center gap-2 h-[40px] px-4 rounded-[70px] bg-[var(--color-dangerTint)] text-[var(--color-danger)] text-[12px] font-semibold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 size={14} />
              <span>
                Delete {selectedBatchIds.length} selected batch
                {selectedBatchIds.length === 1 ? '' : 'es'}
              </span>
            </button>
          )}
        </div>

        <div className="p-6 pt-4 overflow-x-auto">
          {leadBatches.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[var(--color-muted)]">
              No lead batches remaining. Use the Import leads batch section above to upload or paste a new batch.
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[740px]">
              <thead>
                <tr className="bg-[var(--color-subtle)]">
                  <th className="py-2.5 px-4 rounded-l-[8px] w-10">
                    <input
                      type="checkbox"
                      checked={
                        leadBatches.length > 0 &&
                        selectedBatchIds.length === leadBatches.length
                      }
                      onChange={toggleSelectAllBatches}
                      aria-label="Select all batches"
                      className="rounded border-[var(--color-border)] accent-[var(--color-brand)] cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                    BATCH NAME
                  </th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                    SOURCE FILE
                  </th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                    PLAN
                  </th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                    LEADS
                  </th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                    IMPORTED
                  </th>
                  <th className="py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] text-right rounded-r-[8px]">
                    ACTION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {leadBatches.map((batch) => {
                  const liveCount = leads.filter(
                    (l) => l.batchId === batch.id
                  ).length;
                  return (
                    <tr
                      key={batch.id}
                      className="hover:bg-[var(--color-subtle)]/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={selectedBatchIds.includes(batch.id)}
                          onChange={() => toggleSelectBatch(batch.id)}
                          aria-label={`Select batch ${batch.name}`}
                          className="rounded border-[var(--color-border)] accent-[var(--color-brand)] cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-3 text-[13px] font-semibold text-[var(--color-text)]">
                        {batch.name}
                      </td>
                      <td className="py-3 px-3 text-[12px] font-mono text-[var(--color-muted)]">
                        {batch.sourceLabel}
                      </td>
                      <td className="py-3 px-3 text-[12px] text-[var(--color-text)]">
                        {batch.planName}
                      </td>
                      <td className="py-3 px-3 text-[12px] font-semibold text-[var(--color-text)] tabular-nums">
                        {liveCount}
                      </td>
                      <td className="py-3 px-3 text-[12px] text-[var(--color-muted)] tabular-nums whitespace-nowrap">
                        {batch.importedAt}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setBatchesPendingDelete([batch])}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] bg-[var(--color-dangerTint)] text-[var(--color-danger)] text-[11px] font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          <Trash2 size={12} />
                          <span>Delete batch</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </SurfacePanel>

      {/* Confirm Delete Batch Modal */}
      <ModalShell
        open={batchesPendingDelete.length > 0}
        onClose={() => setBatchesPendingDelete([])}
        title={
          batchesPendingDelete.length === 1
            ? `Delete "${batchesPendingDelete[0]?.name}"?`
            : `Delete ${batchesPendingDelete.length} lead batches?`
        }
        subtitle="Batch-only unused leads are deleted. Leads shared with other batches remain; leads with send history are archived."
      >
        <div className="space-y-4">
          <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-subtle)]/60 p-4 space-y-2">
            {batchesPendingDelete.map((b) => {
              const count = b.leadCount;
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between text-[12px]"
                >
                  <span className="font-semibold text-[var(--color-text)]">
                    {b.name}
                  </span>
                  <span className="text-[var(--color-muted)] tabular-nums">
                    {count} lead{count === 1 ? '' : 's'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setBatchesPendingDelete([])}
              className="px-4 py-2.5 rounded-[70px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-muted)] hover:text-[var(--color-text)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDeleteBatches}
              className="inline-flex items-center gap-2 h-[44px] px-5 rounded-[70px] bg-[var(--color-danger)] text-white text-[13px] font-medium hover:opacity-95 transition-opacity cursor-pointer"
            >
              <Trash2 size={14} />
              <span>Confirm delete</span>
            </button>
          </div>
        </div>
      </ModalShell>

      {/* Lead Detail Modal */}
      <ModalShell
        open={Boolean(activeLead)}
        onClose={() => setActiveLead(null)}
        title={activeLead?.name ?? ''}
        subtitle={
          activeLead
            ? `${activeLead.role} at ${activeLead.company} · ${activeLead.email}`
            : ''
        }
      >
        {activeLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div className="p-3 rounded-[10px] bg-[var(--color-subtle)]">
                <span className="text-[11px] text-[var(--color-muted)] block">
                  List
                </span>
                <span className="font-semibold text-[var(--color-text)]">
                  {activeLead.listName}
                </span>
              </div>
              <div className="p-3 rounded-[10px] bg-[var(--color-subtle)]">
                <span className="text-[11px] text-[var(--color-muted)] block">
                  Assigned plan
                </span>
                <span className="font-semibold text-[var(--color-text)]">
                  {activeLead.planName}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1.5">
                Outreach status
              </label>
              <select
                value={activeLead.status}
                onChange={async(e) => {
                  const nextStatus = e.target.value as LeadStatus;
                  await onUpdateLeadStatus(activeLead.id, nextStatus);
                  setActiveLead(null);
                }}
                className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)]"
              >
                <option value="Ready">Ready</option>


                <option value="Paused">Remove / archive</option>

              </select>
            </div>

            {activeLead.notes && (
              <div className="p-3.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)]">
                <span className="text-[11px] font-medium text-[var(--color-muted)] block mb-1">
                  Notes
                </span>
                <p className="text-[12px] text-[var(--color-text)]">
                  {activeLead.notes}
                </p>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <PortfolioPillButton
                variant="primary"
                size="md"
                onClick={() => {
                  onQueueLeadsForSending([activeLead]);
                  setActiveLead(null);
                }}
              >
                Queue for direct send
              </PortfolioPillButton>
            </div>
          </div>
        )}
      </ModalShell>

      {/* Add Lead Modal */}
      <ModalShell
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add new lead"
        subtitle="Add a contact to the active lead list."
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
                Full name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sophia Alvarez"
                className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
                Work email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sophia@company.com"
                className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
                Company
              </label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Labs"
                className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
                Role
              </label>
              <input
                type="text"
                disabled value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="VP of Growth"
                className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
                List
              </label>
              <input
                type="text"
                disabled value={listName}
                onChange={(e) => setListName(e.target.value)}
                className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1">
                Assign scouting plan
              </label>
              <select
                disabled value="Unassigned"
                onChange={(e) => setPlanName(e.target.value)}
                className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
              >
                <option value="Unassigned">Unassigned</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setAddModalOpen(false)}
              className="px-4 py-2.5 rounded-[70px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-muted)] hover:text-[var(--color-text)] cursor-pointer"
            >
              Cancel
            </button>
            <PortfolioPillButton type="submit" variant="primary" size="md">
              <span className="inline-flex items-center gap-1.5">
                <UserPlus size={14} />
                Save lead
              </span>
            </PortfolioPillButton>
          </div>
        </form>
      </ModalShell>
    </div>
  );
};
