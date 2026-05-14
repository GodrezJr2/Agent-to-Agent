# Updating from Upstream 9Router

This project is built on top of [9Router](https://github.com/decolua/9router). When 9Router releases updates, follow this guide to pull in their changes safely.

---

## Setup (one-time)

```bash
git remote add upstream https://github.com/decolua/9router
```

---

## Safe files vs Risky files

| Category | Files | Risk |
|----------|-------|------|
| **Our custom code** | `src/app/api/offices/`, `src/app/api/agents/`, `src/lib/agentTools.js`, `src/office/`, `src/lib/db/repos/agentsRepo.js`, `officesRepo.js`, `a2aTasksRepo.js` | ✅ 9Router never touches these |
| **9Router routing engine** | `open-sse/`, `src/app/api/v1/`, `src/app/api/pricing/` | ✅ Safe to blindly overwrite |
| **Shared DB files** | `src/lib/db/schema.js`, `src/lib/db/index.js` | ⚠️ Always review manually |
| **Sidebar nav** | `src/shared/components/Sidebar.js` | ⚠️ Re-add Offices link after pulling |

---

## Update workflow

```bash
# 1. Fetch latest upstream changes
git fetch upstream

# 2. Check what changed in upstream
git log upstream/master --oneline -10

# 3. Safely overwrite routing engine files (no custom code here)
git checkout upstream/master -- open-sse/
git checkout upstream/master -- src/app/api/v1/
git checkout upstream/master -- src/app/api/pricing/
git checkout upstream/master -- src/app/api/auth/
git checkout upstream/master -- src/app/api/providers/

# 4. Review shared DB files BEFORE updating
git diff upstream/master src/lib/db/schema.js
git diff upstream/master src/lib/db/index.js
# If upstream added new columns/tables that don't conflict → apply:
# git checkout upstream/master -- src/lib/db/schema.js
# If there are conflicts → manually merge the changes

# 5. Commit and push
git add -A
git commit -m "chore: sync routing engine from upstream 9Router vX.X.X"
git push origin main
```

---

## The one file that can actually break things

**`src/lib/db/schema.js`** — we added these tables that 9Router doesn't have:

- `officeAgents` — agent definitions (name, role, model, hierarchy)
- `a2aTasks` — delegation task lifecycle
- `chatMessages` — office-wide conversation history
- `memoryEntries` — agent persistent memory (already in upstream)
- `cronJobs` — scheduled tasks (already in upstream)

If upstream changes `schema.js`, make sure their changes don't drop or rename columns we rely on. Merge manually when in doubt.

---

## After updating

Rebuild the Docker image on your server:

```bash
# On the server
cd /DATA/AppData/9router/source
git pull origin main
cd /DATA/AppData/9router
docker compose build --no-cache app
docker compose up -d --force-recreate app
```
