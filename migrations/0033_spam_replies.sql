-- 0033_spam_replies.sql: Spam folder synchronization and reply handling

-- Add spam sync tracking columns to accounts table
ALTER TABLE accounts ADD COLUMN last_spam_sync_uid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN last_spam_sync_uid_validity TEXT;

-- Add mailbox source column to messages table (Inbox, Sent, Spam, etc.)
ALTER TABLE messages ADD COLUMN mailbox_source TEXT NOT NULL DEFAULT 'Inbox';