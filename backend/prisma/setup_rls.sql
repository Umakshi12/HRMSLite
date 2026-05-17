-- 1. Enable RLS on sensitive tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Spreadsheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SpreadsheetTab" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SheetRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserTabAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- 2. Create policies for the User table
-- Users can read/write data if their tenant_id matches the session variable
CREATE POLICY tenant_isolation_user ON "User"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- 3. Create policies for Spreadsheet
CREATE POLICY tenant_isolation_spreadsheet ON "Spreadsheet"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- 4. Create policies for SpreadsheetTab
CREATE POLICY tenant_isolation_spreadsheettab ON "SpreadsheetTab"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- 5. Create policies for SheetRow
CREATE POLICY tenant_isolation_sheetrow ON "SheetRow"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- 6. Create policies for UserTabAccess
CREATE POLICY tenant_isolation_usertabaccess ON "UserTabAccess"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- 7. Create policies for AuditLog
CREATE POLICY tenant_isolation_auditlog ON "AuditLog"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- Bypass RLS for Super Admins (Optional, requires careful implementation in app)
-- CREATE POLICY super_admin_bypass ON "User" FOR ALL USING (current_setting('app.is_super_admin', true) = 'true');
