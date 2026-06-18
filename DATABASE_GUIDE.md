# SheetSync Pro — Database Technical Guide

**For:** Client / System Administrator  
**Application:** SheetSync Pro (HRMS)  
**Prepared by:** Development Team

---

## 1. Overview — How the Database Fits In

SheetSync Pro uses **two data stores** that work together:

```
Google Sheets  ──────►  Postgres (Neon)  ──────►  Your App (SheetSync Pro)
 (live source)           (fast cache)              (reads from Postgres)
```

| Store | Purpose | Who manages it |
|---|---|---|
| **Google Sheets** | Live data — candidates, staff, records | You (the client) |
| **Postgres (Neon)** | Cached copy for fast search, filters, access control, user accounts | SheetSync Pro (automatic) |

**Important:** Postgres is a cache + control layer. If you delete the Postgres database, the actual data in Google Sheets is NOT affected. The app will re-sync from Google Sheets when you reconnect.

---

## 2. Current Database Setup

| Item | Value |
|---|---|
| **Database Engine** | PostgreSQL 15 |
| **Hosting Provider** | Neon (neon.tech) |
| **Region** | ap-southeast-1 (Singapore) |
| **Connection Mode** | Pooled (PgBouncer) for app, Direct for migrations |
| **ORM** | Prisma v5 |

### What is stored in Postgres

| Table | What it holds |
|---|---|
| `User` | Login accounts, passwords (bcrypt hashed), roles |
| `Spreadsheet` | Registered Google Sheets with their IDs and names |
| `SpreadsheetTab` | Individual tabs/sheets inside each spreadsheet |
| `SheetRow` | Cached copy of every data row from Google Sheets |
| `UserTabAccess` | Which user has access to which tab |
| `AuditLog` | Full history of who did what and when |
| `ActivityLog` | Simplified action log (import, sync, etc.) |
| `GoogleOAuthToken` | OAuth tokens for Google account connections |

---

## 3. Setting Up the Database (Fresh Start)

Follow these steps when deploying to a new server or setting up for the first time.

### Step 1 — Create a Neon Account and Database

1. Go to [neon.tech](https://neon.tech) and sign up (free tier is sufficient to start)
2. Click **"New Project"**
3. Give it a name (e.g., `sheetsync-hrms`)
4. Select region closest to your server (Singapore for India-based deployments)
5. Click **"Create Project"**

### Step 2 — Get Your Connection Strings

After creating the project, Neon shows you connection strings.

1. Click **"Connection Details"** on your project dashboard
2. You need **two** URLs — switch between them using the dropdown:

**Pooled connection** (label: "Connection pooling"):
```
postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require
```

**Direct connection** (label: "Direct connection"):
```
postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
```

### Step 3 — Update the .env File

Open `backend/.env` and update these two lines:

```env
DATABASE_URL="<pooled connection URL>&pgbouncer=true&connect_timeout=30"
DIRECT_URL="<direct connection URL>&connect_timeout=30"
```

Example:
```env
DATABASE_URL="postgresql://neondb_owner:mypassword@ep-polished-sun-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=30"
DIRECT_URL="postgresql://neondb_owner:mypassword@ep-polished-sun.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30"
```

> **Why two URLs?**  
> `DATABASE_URL` uses a connection pool (PgBouncer) — faster for the live app.  
> `DIRECT_URL` connects directly — required for running migrations (schema changes).

### Step 4 — Create the Tables (Run Migration)

Open a terminal in the `backend` folder and run:

```bash
npx prisma db push
```

This reads `prisma/schema.prisma` and creates all the tables automatically in your Neon database. You should see:

```
✓ Generated Prisma Client
✓ Your database is now in sync with your Prisma schema.
```

### Step 5 — Create the First Admin Account

Run the bootstrap script (only once):

```bash
node bootstrap.js
```

This creates the `Users` and `ActivityLog` sheets in your Google Spreadsheet and registers the super admin account. Make sure these environment variables are set in `.env` first:

```env
BOOTSTRAP_ADMIN_EMAIL=admin@yourdomain.com
BOOTSTRAP_ADMIN_LOGIN_ID=your_admin_id
BOOTSTRAP_ADMIN_PASSWORD=YourSecurePassword@123
```

---

## 4. Switching to a Different Database Provider

If you want to move away from Neon to another provider (e.g., Supabase, Railway, AWS RDS, your own server), the process is straightforward because Prisma handles the abstraction.

### Option A — Stay on Postgres, Change the Host

This is the simplest switch. Any Postgres-compatible provider works without code changes.

**Supported providers that work as drop-in replacements:**

| Provider | Notes |
|---|---|
| Supabase | Free tier, good UI, built-in auth |
| Railway | Simple pricing, easy deploys |
| AWS RDS | Enterprise grade, more expensive |
| DigitalOcean Managed Postgres | Good balance of price and reliability |
| Self-hosted Postgres | Full control, requires server management |

**Steps to switch:**

1. Create a new Postgres database at your new provider
2. Get the connection string from them (format is always the same)
3. Update `DATABASE_URL` and `DIRECT_URL` in `backend/.env`
4. Run `npx prisma db push` to create the tables in the new database
5. Run `node bootstrap.js` to create the first admin account
6. Restart the server — done

> No code changes needed. Only `.env` values change.

### Option B — Switch to a Completely Different Database (MySQL, MongoDB, etc.)

This requires code changes and is **not recommended** unless there is a strong business reason. The steps would be:

1. Change `provider = "postgresql"` to your new provider in `prisma/schema.prisma`
2. Review and update any Prisma schema fields that use Postgres-specific types (e.g., `@db.Text`)
3. Update `DATABASE_URL` format to match the new database
4. Run `npx prisma db push`
5. Test all features thoroughly

**Estimated effort:** 2–4 days of development + full testing cycle.

---

## 5. Routine Maintenance Tasks

### Backup the Database

Neon provides automatic daily backups on all plans. To take a manual backup:

1. Go to your Neon project dashboard
2. Click **"Branches"** → **"Create Branch"** — this is an instant snapshot
3. Or use `pg_dump` for a portable file:

```bash
pg_dump "your_DIRECT_URL" > backup_$(date +%Y%m%d).sql
```

### Restore from Backup

```bash
psql "your_DIRECT_URL" < backup_20260614.sql
```

### Run a Schema Migration (After Code Updates)

When the development team delivers an update that includes schema changes:

```bash
cd backend
npx prisma db push
```

Then restart the server.

### Clean Up Stale Data

If you see errors about sheets that no longer exist in Google Sheets, run this in the Neon SQL Editor:

```sql
-- Remove tabs that were deleted from Google Sheets
DELETE FROM "SpreadsheetTab" 
WHERE tab_name IN ('OldSheetName1', 'OldSheetName2');
```

---

## 6. Checking Database Health

### Via Neon Dashboard
1. Go to neon.tech → your project
2. Click **"Monitoring"** — shows CPU, connections, storage usage

### Via SQL Editor (Neon)
Run these queries to check your data:

```sql
-- Count of users by role
SELECT role, COUNT(*) FROM "User" WHERE deleted_at IS NULL GROUP BY role;

-- Count of registered spreadsheets
SELECT name, is_active, last_synced_at FROM "Spreadsheet";

-- Count of cached rows per sheet tab
SELECT tab_name, COUNT(*) as rows FROM "SheetRow" GROUP BY tab_name ORDER BY rows DESC;

-- Recent activity
SELECT action, "user", details, timestamp FROM "ActivityLog" ORDER BY timestamp DESC LIMIT 20;
```

---

## 7. Environment Variables Reference

All database configuration lives in `backend/.env`:

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Pooled connection — used by the running app | Yes |
| `DIRECT_URL` | Direct connection — used only for `npx prisma db push` | Yes |

**Format:**
```
postgresql://USERNAME:PASSWORD@HOST/DATABASE?sslmode=require
```

---

## 8. Important Security Notes

- **Never commit `.env` to Git.** The file contains your database password.
- **Rotate your database password** if you suspect it has been exposed. Do this in Neon dashboard → Settings → Reset Password, then update `.env`.
- Passwords in the `User` table are **bcrypt hashed** — no one (including developers) can read them.
- All connections use **SSL** (`sslmode=require`) — data is encrypted in transit.
- The `DIRECT_URL` should never be used in the app itself — only for migrations.

---

## 9. Quick Reference Commands

Run all commands from the `backend/` folder:

```bash
# Create/update tables after a schema change
npx prisma db push

# View your database tables visually in a browser
npx prisma studio

# Create the first admin account (run once on fresh setup)
node bootstrap.js

# Check Prisma can connect to the database
npx prisma db execute --stdin <<< "SELECT 1"
```

---

*Document version: June 2026*  
*For technical support, contact the development team.*
