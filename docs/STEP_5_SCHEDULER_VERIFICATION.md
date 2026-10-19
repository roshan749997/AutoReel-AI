# Step 5: Smart Publishing Scheduler, Queue Management & n8n Automation Verification Report

**Date**: 2026-10-17  
**Workspace**: `E:\4444\video automation`  
**Pipeline Module**: Smart Publishing Scheduler, Atomic Queue Management, Timezone Handling & n8n Orchestration  
**Host Platform**: Windows 11 (PowerShell) / Node.js v20.19.6  

---

## 1. Executive Summary

Step 5 has implemented a production-grade, fault-tolerant scheduling and queue orchestration pipeline for approved video drafts. It introduces timezone-aware scheduling, atomic job claiming, exponential backoff retries with jitter, server restart recovery, pause/resume/reschedule lifecycle operations, and secure n8n Community Edition webhook integration.

Key architectural guarantees implemented in Step 5:
1. **Approval Enforcement**: Videos with unapproved (`draft`) metadata cannot be scheduled. The scheduler strictly verifies `video.aiMetadata.approvalStatus === 'approved'`.
2. **Platform Publishing Status Separation**: Scheduling status (`scheduled`, `queued`, `processing`, `retrying`, `paused`, `cancelled`, `failed`) is strictly decoupled from platform publishing status (`publishingStatus: 'unattempted' | 'ready_for_dispatch' | 'verified_mock' | 'published'`). Jobs are never marked as published merely because they entered the queue.
3. **No Automatic Real Publishing in this Step**: The queue worker performs thorough pre-flight validation (account connectivity, Google Drive video stream accessibility, platform character constraints) and transitions jobs to `ready_for_dispatch`. Real API publishing is never triggered without confirmed creator intent.
4. **Atomic Job Claiming & Idempotency**: Powered by MongoDB atomic `findOneAndUpdate` queries. Multiple workers cannot claim the same job. Deterministic `idempotencyKey` values (`post_{videoId}_{platform}_{epoch}`) prevent duplicate active dispatches.
5. **Crash & Restart Recovery**: On backend boot, `schedulerService.recoverInterruptedJobs()` scans for jobs left in `processing` due to previous server crashes or restarts, safely moving them back to `queued` with audit logs.
6. **n8n Automation & Offline Resilience**: n8n triggers and webhooks are secured with secret headers and replay protection. If the self-hosted n8n container is offline, core scheduling and MongoDB operations continue without disruption or data loss.

---

## 2. Queue Lifecycle & State Transitions

```
                    +---------------------------------------+
                    | Video Metadata Approved by Creator    |
                    +-------------------+-------------------+
                                        |
                                        v
                    +---------------------------------------+
                    |           POST /api/posts             |
                    | (Validates Approval, Account, Future  |
                    | Date, Timezone & Idempotency Key)     |
                    +-------------------+-------------------+
                                        |
                                        v
                 +-------------------> status: 'scheduled' <-------------------+
                 |                     publishingStatus: 'unattempted'         |
                 |                      |                                      |
         User Reschedules /             | Time reaches scheduledAt             | User Resumes
         Retries Failed Post            v                                      | Paused Post
                 |            +-------------------+                            |
                 |            | Atomic Job Claim  |                            |
                 |            | (status -> 'proc')|                            |
                 |            +---------+---------+                            |
                 |                      |                                      |
                 |                      v                                      |
                 |            +-------------------+                            |
                 |            | Pre-flight Checks |                            |
                 |            | (Account, Stream, |                            |
                 |            | Platform Payload) |                            |
                 |            +---------+---------+                            |
                 |                      |                                      |
                 |        Success       |       Transient Failure              |
                 |      +---------------+---------------+                      |
                 |      |                               |                      |
                 |      v                               v                      |
                 |  status: 'queued'            status: 'retrying'             |
                 |  publishingStatus:           (Backoff with Jitter)          |
                 |  'ready_for_dispatch'                |                      |
                 |                                      | Max attempts reached |
                 |                                      v                      |
                 |                              status: 'failed'               |
                 |                                                             |
                 +----------------- status: 'paused' --------------------------+
                               (User pauses schedule)
```

---

## 3. Endpoints Implemented & Verified

| Endpoint | Method | Security | Purpose |
| :--- | :--- | :--- | :--- |
| `/api/posts` | `GET` | Public / Local | Lists posts with granular status filtering (`all`, `scheduled`, `queued`, `processing`, `retrying`, `paused`, `failed`, `cancelled`, `published`), platform, and date ranges. |
| `/api/posts` | `POST` | Public / Local | Schedules an approved video draft with explicit timezone and duplicate prevention. |
| `/api/posts/multi-platform` | `POST` | Public / Local | Schedules an approved video to both YouTube Shorts and Instagram Reels simultaneously. |
| `/api/posts/:id` | `GET` | Public / Local | Retrieves full post details with populated video, account, and audit log history. |
| `/api/posts/:id` | `PATCH` | Public / Local | Edits post title, caption, hashtags, or timezone. |
| `/api/posts/:id/pause` | `POST` | Public / Local | Pauses an active post schedule. |
| `/api/posts/:id/resume` | `POST` | Public / Local | Resumes a paused post schedule. |
| `/api/posts/:id/reschedule` | `POST` | Public / Local | Reschedules post to a new future date and timezone. |
| `/api/posts/:id/cancel` | `POST` | Public / Local | Cancels post schedule with reason recorded in audit logs. |
| `/api/posts/:id/retry` | `POST` | Public / Local | Resets failed or cancelled post back to `scheduled` status. |
| `/api/posts/:id/publish-now` | `POST` | `requireAdminAuth` | Triggers pre-flight queue verification and claims post for execution. |
| `/api/posts/:id` | `DELETE` | `requireAdminAuth` | Permanently deletes a post from the publishing queue. |
| `/api/workflows/status` | `GET` | Public / Local | Checks n8n health at `http://127.0.0.1:5678/healthz`. |
| `/api/workflows/trigger` | `POST` | `requireAdminAuth` | Forwards an event payload to the n8n webhook orchestrator. |
| `/api/workflows/callback` | `POST` | Webhook Secret | Authenticated, idempotent callback endpoint for incoming n8n notifications. |

---

## 4. Self-Hosted n8n Integration

### Architecture
- **Docker Compose**: Pre-configured in `automation/n8n/docker-compose.yml`.
- **Network Binding**: Bound strictly to `127.0.0.1:5678` (prevents external LAN exposure).
- **Importable Workflow**: Created and verified at `automation/n8n/workflows/approved_publishing_pipeline.json`.
- **Webhook Security**: Verified using `X-N8N-WEBHOOK-SECRET` HTTP header. Replayed webhooks are tracked and skipped via in-memory event deduplication.
- **Offline Tolerance**: If Docker or n8n is stopped, the backend catches network errors silently; posts remain safely queued in MongoDB.

### n8n Setup & Import Instructions

1. Start n8n container via npm or docker compose:
   ```powershell
   npm run n8n:up
   ```
2. Open your browser at `http://127.0.0.1:5678` and complete the initial account setup (free Community Edition).
3. In n8n, click **Workflows** $\to$ **Import from File...** and select:
   `automation/n8n/workflows/approved_publishing_pipeline.json`
4. The workflow will appear with:
   - **Queue Webhook Receiver** (`POST /webhook/video-pipeline`)
   - **Verify Valid Event** condition
   - **Report to Backend Callback** (`POST http://127.0.0.1:5000/api/workflows/callback`)
5. Click **Publish / Activate** on the imported workflow.
6. To inspect logs or shut down:
   ```powershell
   npm run n8n:logs
   npm run n8n:down
   ```

---

## 5. Dashboard Enhancements

### Publishing Queue Module (`PublishingQueueModule.jsx`)
- **Granular Filter Tabs**: `all`, `scheduled`, `queued`, `processing`, `retrying`, `paused`, `failed`, `cancelled`, `published`.
- **Dispatch Badge**: Clearly separates queue status from `publishingStatus` (e.g. `unattempted`, `ready_for_dispatch`).
- **Post Action Bar**:
  - **Edit**: Inline modal to update title, caption, hashtags, and timezone.
  - **Reschedule**: Date picker modal with explicit timezone selector.
  - **Pause / Resume**: Instant schedule pause and resume buttons.
  - **Cancel**: Prompts for cancellation reason and records audit trail.
  - **Retry**: Re-activates dead-letter or failed jobs.
  - **Audit**: Comprehensive execution log modal showing timestamped steps (`scheduled`, `claimed`, `preflight_verified`, etc.).
  - **Verify Queue**: Runs atomic claiming and pre-flight validation.

### Calendar Module (`CalendarModule.jsx`)
- **Real API Data**: Dynamically groups scheduled posts by day of month.
- **Platform & Status Color Coding**: Distinct styling for YouTube Shorts, Instagram Reels, published, and failed items.
- **Interactive Post Inspector**: Clicking a post opens detailed metadata with scheduled time, timezone, and direct navigation to the queue.

### Video Library Module (`VideoLibraryModule.jsx`)
- **Approval Guard**: Clicking "Schedule" on a video with `draft` metadata prompts the user to review and approve the metadata first.
- **Timezone Selection**: Choose from UTC, Asia/Kolkata (IST), America/New_York (EST), America/Los_Angeles (PST), or Europe/London (GMT).
- **Multi-Platform Option**: Allows scheduling to both YouTube Shorts and Instagram Reels in a single click.

---

## 6. Required Environment Variables

Configured in `backend/.env` (no secrets logged):

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Backend Express server port | `5000` |
| `MONGODB_URI` | MongoDB Atlas or local connection string | `mongodb+srv://...` |
| `ENCRYPTION_KEY` | 32-byte hex key for OAuth token encryption | Hex string |
| `DASHBOARD_API_KEY` | Admin API key for protected actions | Configured |
| `N8N_WEBHOOK_URL` | Outgoing webhook endpoint for n8n | `http://127.0.0.1:5678/webhook/video-pipeline` |
| `N8N_API_KEY` | Optional n8n REST API key | Optional |
| `N8N_WEBHOOK_SECRET` | Secret header for callback verification | Configured |
| `N8N_ENCRYPTION_KEY` | n8n internal credential encryption key | 32-char string |

---

## 7. Verification & Automated Test Results

### Backend Automated Test Suite (`npm test`)

All 44 automated tests executed and passed cleanly:

```
TAP version 13
# [Database] MongoDB connection established successfully
ok 1 - AI Service: Rule-based fallback generates structured metadata in English
ok 2 - AI Service: Rule-based fallback generates Hindi metadata
ok 3 - AI Service: Rule-based fallback generates Marathi metadata
ok 4 - AI Service: Provider diagnostics handles unconfigured Gemini key safely without exposing secrets
ok 5 - AI Service: validateAndSanitizeMetadata strictly enforces YouTube <= 100 chars and appends #Shorts
ok 6 - AI Service: validateAndSanitizeMetadata sanitizes and deduplicates hashtags
ok 7 - AI Service: safeJsonParse extracts valid JSON from markdown code fences
ok 8 - AI Service: Bulk processing generates draft metadata for multiple videos and avoids conflicting jobs
ok 9 - AI Service: cancelBulkJob successfully cancels an active batch
ok 10 - AI Service: Draft approval workflow updates metadata and approvedAt date
ok 11 - cryptoService: encrypts and decrypts secret token correctly
ok 12 - cryptoService: outputs different IVs for same input (probabilistic encryption)
ok 13 - cryptoService: fails gracefully on tampered payload
ok 14 - GoogleDriveService: testConnection handles missing credentials gracefully
ok 15 - GoogleDriveService: retryWithBackoff retries transient 429 rate limits and succeeds
ok 16 - GoogleDriveService: retryWithBackoff throws if maxRetries exhausted
ok 17 - GoogleDriveService: validateFolder detects trashed folders
ok 18 - GoogleDriveService: validateFolder detects non-folder mimeTypes
ok 19 - GoogleDriveService: validateFolder handles 404 not found and 403 permission errors
ok 20 - Duplicate Prevention & Upsert: indexing identical driveFileId updates instead of duplicating
ok 21 - SyncJob: cancellation stops active sync and saves state for resumption
ok 22 - Video query: server-side filtering, aspect ratio, and pagination
ok 23 - database status: returns diagnostic object
ok 24 - config: defaults are properly defined
ok 25 - Scheduler: Rejects scheduling videos with unapproved metadata
ok 26 - Scheduler: Schedules approved video with explicit timezone and deterministic idempotencyKey
ok 27 - Scheduler: Rejects unintended past scheduled dates
ok 28 - Scheduler: Prevents duplicate active schedules for the same video & platform
ok 29 - Scheduler: Atomic job claiming prevents two workers from claiming the same job
ok 30 - Scheduler: Handles queue failure with exponential backoff and caps at maxAttempts
ok 31 - Scheduler: Pause, resume, reschedule, and cancellation state transitions
ok 32 - Scheduler: recoverInterruptedJobs resets jobs stuck in processing to queued
ok 33 - Scheduler: n8n offline does not prevent post scheduling
ok 34 - n8n Webhook: Rejects unauthorized callback when secret is missing or invalid
ok 35 - n8n Webhook: Processes callback with valid secret and skips replayed duplicate events
ok 36 - OAuth state: HMAC token generates and verifies successfully
ok 37 - OAuth state: rejects mismatched platform
ok 38 - OAuth state: rejects tampered state payload
ok 39 - OAuth state: rejects expired state timestamp
ok 40 - Account model: toSafeJSON() strips encrypted tokens completely
ok 41 - Validator middleware: rejects missing required fields with 400
ok 42 - Validator middleware: rejects empty/null request body with 400
ok 43 - Validator middleware: passes valid payload to next()
ok 44 - requireAdminAuth: enforces DASHBOARD_API_KEY when configured

1..44
# tests 44
# pass 44
# fail 0
# duration_ms 3741.1542
```

### Frontend Production Build (`npm run build`)

```
vite v6.4.4 building for production...
✓ 1604 modules transformed.
dist/index.html                   0.86 kB
dist/assets/index-D_Qng_KH.css   29.32 kB
dist/assets/index-CMycIog8.js   258.93 kB
✓ built in 2.56s
```

---

## 8. Remaining Manual Setup & Known Limitations

1. **No Automatic Real Publishing**: Step 5 validates queue readiness (`ready_for_dispatch`). Real YouTube and Instagram binary upload execution will be handled in Step 6 (Publishing Execution & Live Verification).
2. **Optional Docker for n8n**: n8n provides visual orchestration and webhooks. If Docker is not installed on the host system, the core scheduling queue runs completely natively via Node.js and MongoDB Atlas.
3. **Clock Synchronization**: The scheduler assumes the server clock is synchronized via NTP (allows a 2-minute clock skew window for client/server variance).
