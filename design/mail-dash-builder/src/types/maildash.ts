export type NavPage =
  | 'dashboard'
  | 'inbox'
  | 'sending'
  | 'leads'
  | 'scouting-plans'
  | 'accounts'
  | 'settings'
  | 'notifications';

export type DeliveryResultStatus = 'Sent' | 'Failed' | 'Needs review' | 'Queued';

export interface DeliveryRecord {
  id: string;
  recipient: string;
  recipientName: string;
  sender: string;
  subject: string;
  result: DeliveryResultStatus;
  time: string;
  timestampMs: number;
  planName: string;
  diagnosticNote?: string;
}

export interface SendingState {
  id?: string;
  backendStatus?: string;
  inFlight?: number;
  nextSendAt?: string;
  updatedAt?: number;
  status: 'paused' | 'running' | 'completed';
  runTitle: string;
  runSubtitle: string;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
  cancelledCount?:number;
  needsReviewCount: number;
  plannedTotal: number;
  records: DeliveryRecord[];
}

export type ThreadTag = 'Interested' | 'Follow up' | 'Question' | 'Not now';

export interface InboxMessage {
  sendState?: string;
  id: string;
  senderName: string;
  senderEmail: string;
  isOutbound: boolean;
  body: string;
  timestamp: string;
}

export interface InboxThread {
  historyBeforeUid?:number|null;
  inboundDay?: string;
  id: string;
  contactName: string;
  contactEmail: string;
  company: string;
  role: string;
  avatarUrl?: string;
  accountEmail: string;
  planName: string;
  subject: string;
  snippet: string;
  timestamp: string;
  unread: boolean;
  starred: boolean;
  archived: boolean;
  tag: ThreadTag;
  messages: InboxMessage[];
}

export type LeadStatus = 'Ready' | 'In sequence' | 'Replied' | 'Bounced' | 'Paused';

export interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  listName: string;
  batchId?: string;
  status: LeadStatus;
  planName: string;
  lastActivity: string;
  verified: boolean;
  notes?: string;
}

export interface LeadBatch {
  id: string;
  name: string;
  sourceLabel: string;
  leadCount: number;
  planName: string;
  importedAt: string;
}

export interface PlanStep {
  id: string;
  stepNumber: number;
  dayOffset: number;
  subject: string;
  preview: string;
  replyRate: number;
}

export type PlanStatus = 'Active' | 'Paused' | 'Draft';

export interface ScoutingPlan {
  id: string;
  name: string;
  description: string;
  status: PlanStatus;
  scheduleWindow: string;
  timezone: string;
  senderAccount: string;
  enrolledCount: number;
  sentCount: number;
  replyRate: number;
  steps: PlanStep[];
  nextRun: string;
}

export type AccountStatus = 'Connected' | 'Warming' | 'Needs attention' | 'Paused';

export interface ConnectedAccount {
  healthStatus?: string;
  healthMessage?: string;
  connection?: string;
  hasCredentials?: boolean;
  id: string;
  email: string;
  displayName: string;
  provider: 'Google Workspace' | 'Gmail OAuth';
  status: AccountStatus;
  sentToday: number;
  dailyLimit: number;
  warmupEnabled: boolean;
  deliverabilityScore: number;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  lastSynced: string;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  subtitle: string;
  ownerName: string;
  ownerEmail: string;
  avatarUrl: string;
}

export interface WorkspaceSettings {
  healthNotificationEmail?: string;
  workspaceName: string;
  timezone: string;
  dailyWorkspaceCap: number;
  delayBetweenSendsSec: number;
  maxRetries: number;
  stopOnReply: boolean;
  openTracking: boolean;
  linkTracking: boolean;
  unsubscribeFooter: boolean;
  customTrackingDomain: string;
  signature: string;
  notifyOnReply: boolean;
  notifyOnBouncePause: boolean;
  dailyDigestTime: string;
}
