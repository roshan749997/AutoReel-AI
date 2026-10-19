# Architecture & System Design

The **AI Video Automation Agent** is built around strict production standards, zero paid dependencies, official platform APIs, and secure token management.

```
                           +----------------------------------------+
                           |     React + Tailwind CSS Frontend      |
                           |   (Dashboard Shell, Queue, Calendar)   |
                           +-------------------+--------------------+
                                               |
                                     REST / JSON HTTP
                                               |
                                               v
+-----------------------------------------------------------------------------------+
|                        Node.js / Express Backend (ESM)                            |
|                                                                                   |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|  | Request Validation |  | Helmet & CORS      |  | Centralized Error Handler   |  |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|                                                                                   |
|  [ Services Layer ]                                                               |
|  * cryptoService       : AES-256-GCM encryption for stored OAuth refresh tokens    |
|  * googleDriveService  : Drive API v3 paginated indexer for 20k+ video library    |
|  * aiService           : Pluggable (Gemini Free Tier / Ollama local / manual)     |
|  * youtubeService      : Official YouTube Data API v3 publisher & scheduler       |
|  * instagramService    : Meta Graph API Content Publishing API (IG Reels)         |
|  * ffmpegService       : Metadata inspector & optional thumbnail generation       |
|  * schedulerService    : In-process cron & status watchdog                        |
+-------------------+-------------------+--------------------+----------------------+
                    |                   |                    |
                    v                   v                    v
      +--------------------+     +-------------+      +-------------------+
      |   MongoDB Atlas    |     |  Local n8n  |      |   Official APIs   |
      | (M0 Free Cluster)  |     |  (Docker,   |      | - Google Drive v3 |
      | Accounts, Videos,  |     |  127.0.0.1) |      | - YouTube v3      |
      | Posts, Audit Logs  |     +-------------+      | - Meta Graph v20  |
      +--------------------+                          +-------------------+
```

## Core Tenets
1. **Zero Paid Subscriptions**:
   - Database: MongoDB Atlas M0 Free Tier (or local MongoDB).
   - Video Library: Google Drive API v3 accessing existing storage (files stay in Drive, streaming or temp download on-demand).
   - AI: Google Gemini API (Free tier @ 15 RPM / 1M TPM) or local Ollama (0 API cost).
   - Workflow engine: Self-hosted n8n Community Edition in Docker.
   - Social Publishing: Official developer APIs (YouTube Data API v3 and Instagram Graph API).

2. **Security & Credential Isolation**:
   - Access and refresh tokens for YouTube and Instagram are encrypted at rest using AES-256-GCM via `cryptoService`.
   - Client secrets never reach the browser. Frontend only consumes safe public views (e.g. account names, channel IDs, connection status, token validity expiration).
   - n8n is strictly bound to `127.0.0.1:5678` with random encryption keys, preventing exposure to public network interfaces.

3. **20,000+ Video Scale Handling**:
   - The video indexing engine uses cursor-based pagination with `pageToken` to stream and catalog file metadata from Google Drive without crashing memory.
   - Sync logs and deduplication ensure existing files are updated instead of re-indexed.
