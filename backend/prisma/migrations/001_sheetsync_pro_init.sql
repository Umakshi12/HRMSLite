-- SheetSync Pro — Initial Migration
-- Generated for Neon (Postgres)
-- Run via: npm run db:migrate

-- Users table
CREATE TABLE IF NOT EXISTS "User" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "login_id"       TEXT NOT NULL,
  "name"           TEXT NOT NULL DEFAULT '',
  "identifier"     TEXT NOT NULL,
  "phone"          TEXT,
  "password"       TEXT NOT NULL,
  "role"           TEXT NOT NULL DEFAULT 'user',
  "plan"           TEXT NOT NULL DEFAULT 'pro',
  "status"         TEXT NOT NULL DEFAULT 'active',
  "max_user_quota" INTEGER NOT NULL DEFAULT 10,
  "notes"          TEXT,
  "last_login"     TIMESTAMP(3),
  "created_by"     TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_login_id_key" ON "User"("login_id");
CREATE UNIQUE INDEX IF NOT EXISTS "User_identifier_key" ON "User"("identifier");

-- Spreadsheets table
CREATE TABLE IF NOT EXISTS "Spreadsheet" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sheet_id"        TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "owner_id"        TEXT NOT NULL,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "verified_count"  INTEGER NOT NULL DEFAULT 0,
  "last_synced_at"  TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Spreadsheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Spreadsheet_sheet_id_key" ON "Spreadsheet"("sheet_id");

-- SpreadsheetTab table
CREATE TABLE IF NOT EXISTS "SpreadsheetTab" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "spreadsheet_id" TEXT NOT NULL,
  "tab_name"       TEXT NOT NULL,
  "headers"        JSONB NOT NULL DEFAULT '[]'::jsonb,
  "row_count"      INTEGER NOT NULL DEFAULT 0,
  "last_synced_at" TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpreadsheetTab_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SpreadsheetTab_spreadsheet_id_tab_name_key"
  ON "SpreadsheetTab"("spreadsheet_id", "tab_name");

ALTER TABLE "SpreadsheetTab"
  ADD CONSTRAINT "SpreadsheetTab_spreadsheet_id_fkey"
  FOREIGN KEY ("spreadsheet_id") REFERENCES "Spreadsheet"("id") ON DELETE CASCADE;

-- SheetRow cache table
CREATE TABLE IF NOT EXISTS "SheetRow" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "spreadsheet_id" TEXT NOT NULL,
  "tab_name"       TEXT NOT NULL,
  "row_index"      INTEGER NOT NULL,
  "data"           JSONB NOT NULL,
  "created_by"     TEXT,
  "modified_by"    TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SheetRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SheetRow_spreadsheet_id_tab_name_row_index_key"
  ON "SheetRow"("spreadsheet_id", "tab_name", "row_index");
CREATE INDEX IF NOT EXISTS "SheetRow_spreadsheet_id_tab_name_idx"
  ON "SheetRow"("spreadsheet_id", "tab_name");

ALTER TABLE "SheetRow"
  ADD CONSTRAINT "SheetRow_spreadsheet_id_fkey"
  FOREIGN KEY ("spreadsheet_id") REFERENCES "Spreadsheet"("id") ON DELETE CASCADE;

-- UserTabAccess table
CREATE TABLE IF NOT EXISTS "UserTabAccess" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"        TEXT NOT NULL,
  "spreadsheet_id" TEXT NOT NULL,
  "tab_name"       TEXT NOT NULL,
  "granted_by"     TEXT NOT NULL,
  "granted_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserTabAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserTabAccess_user_id_spreadsheet_id_tab_name_key"
  ON "UserTabAccess"("user_id", "spreadsheet_id", "tab_name");
CREATE INDEX IF NOT EXISTS "UserTabAccess_user_id_idx" ON "UserTabAccess"("user_id");
CREATE INDEX IF NOT EXISTS "UserTabAccess_spreadsheet_id_tab_name_idx"
  ON "UserTabAccess"("spreadsheet_id", "tab_name");

ALTER TABLE "UserTabAccess"
  ADD CONSTRAINT "UserTabAccess_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("login_id") ON DELETE CASCADE;

ALTER TABLE "UserTabAccess"
  ADD CONSTRAINT "UserTabAccess_spreadsheet_id_fkey"
  FOREIGN KEY ("spreadsheet_id") REFERENCES "Spreadsheet"("id") ON DELETE CASCADE;

-- AuditLog table (immutable)
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "actor_id"          TEXT NOT NULL,
  "actor_name"        TEXT NOT NULL,
  "actor_role"        TEXT NOT NULL,
  "action_type"       TEXT NOT NULL,
  "target_sheet_name" TEXT,
  "target_tab_name"   TEXT,
  "target_row_id"     TEXT,
  "before_snapshot"   JSONB,
  "after_snapshot"    JSONB,
  "ip_address"        TEXT,
  "metadata"          JSONB,
  "timestamp"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_actor_id_idx" ON "AuditLog"("actor_id");
CREATE INDEX IF NOT EXISTS "AuditLog_action_type_idx" ON "AuditLog"("action_type");
CREATE INDEX IF NOT EXISTS "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_target_idx"
  ON "AuditLog"("target_sheet_name", "target_tab_name");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "User"("login_id") ON DELETE CASCADE;

-- ActivityLog table (lightweight feed)
CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action"    TEXT NOT NULL,
  "user"      TEXT NOT NULL,
  "details"   TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);
