# AutoReel AI — Multi-Account Social Media Management Guide

This document details the multi-account architecture and setup for AutoReel AI, allowing you to manage multiple independent YouTube channels and Instagram Professional accounts from one unified dashboard.

---

## 1. Overview & Architecture

AutoReel AI supports connecting multiple social accounts across platforms, as well as multiple distinct accounts on the same platform (for example, managing 3 distinct YouTube channels and 2 Instagram business profiles simultaneously).

### Key Architectural Tenets
1. **Account Isolation**: Every connected YouTube channel and Instagram account is saved as an independent document in the MongoDB `accounts` collection with its own stable `_id`, credentials, publishing preferences, and live statistics.
2. **Compound Unique Index**: `Account` enforces `{ platform: 1, accountId: 1 }` as a unique index, preventing duplicate records while allowing different platforms to share IDs if applicable.
3. **Zero Token Exposure**: Access tokens and refresh tokens are strictly encrypted at rest with AES-256-GCM using `cryptoService.js`. Neither raw nor encrypted tokens are ever sent to the browser (`toSafeJSON()` strips them).
4. **Independent Publishing Jobs**: When a video is scheduled for multiple channels (e.g. 2 YouTube channels and 1 Instagram profile), the system creates distinct `Post` documents referencing each `accountId`. A failure or retry on Channel A never impacts Channel B or Instagram.
5. **Deterministic Idempotency Key**: `post_${videoId}_${platform}_${accountId}_${timeEpochSeconds}` ensures atomic scheduling without collisions.

---

## 2. Multi-Account OAuth Workflows

### A. YouTube Channels (Google OAuth 2.0)
- **Callback Endpoint**: `GET /api/accounts/google/callback`
- **Redirect URI**: `http://localhost:5000/api/accounts/google/callback`
- **Scopes**:
  - `https://www.googleapis.com/auth/youtube.upload` (Video uploads)
  - `https://www.googleapis.com/auth/youtube` (Channel management)
  - `https://www.googleapis.com/auth/youtube.readonly` (Channel metadata)
  - `https://www.googleapis.com/auth/userinfo.profile` (Profile verification)
- **Multi-Channel Enumeration**: When a user authorizes a Google account, the backend queries `youtube.channels.list({ part: 'snippet,statistics', mine: true })`. If the identity has multiple YouTube channels, each channel is enumerated, its unique `channel.id` is saved, and tokens are stored securely.
- **Testing Mode Note**: While your Google Cloud app is in *Testing* status:
  - Add your YouTube account emails to the **Test Users** list in the Google Cloud Console (OAuth consent screen).
  - Refresh tokens in testing mode expire after 7 days; the dashboard clearly marks the account with an `expired` badge and provides a one-click **Reconnect** button.

### B. Instagram Professional Accounts (Meta Graph API v20.0)
- **Callback Endpoint**: `GET /api/accounts/meta/callback`
- **Redirect URI**: `http://localhost:5000/api/accounts/meta/callback`
- **Scopes**:
  - `instagram_basic`
  - `instagram_content_publish`
  - `pages_show_list`
  - `pages_read_engagement`
- **Multi-Account Discovery**: Meta OAuth exchanges the authorization code for a 60-day long-lived access token, then queries `GET /me/accounts` with `fields: 'id,name,instagram_business_account{...}'`. If you manage multiple Facebook Pages linked to different Instagram Professional accounts, each Instagram account is saved as an independent `Account` record.
- **Requirements**:
  - The Instagram account must be switched to **Professional** (Creator or Business).
  - The Instagram account must be linked to a Facebook Page you manage.

---

## 3. Account Publishing Preferences

Each account supports customized publishing preferences configured through the **Account Settings** modal:
- `defaultTitlePrefix`: Custom prefix prepended to all titles scheduled for this channel (e.g., `[TECH] `).
- `defaultTitleSuffix`: Custom suffix appended to all titles (e.g., ` | ChannelName`).
- `defaultTags`: Array of channel-specific tags (e.g., `['#Shorts', '#TechDaily']`) merged automatically with AI-generated tags.
- `privacyStatus`: Default YouTube visibility (`public`, `unlisted`, `private`).
- `isMadeForKids`: COPPA compliance flag (defaults to `false`).
- `preferredPublishHourUtc`: Recommended posting hour in UTC.

---

## 4. API Reference

### Connected Accounts

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/accounts` | List accounts with `platform`, `status`, `search`, `page`, and `limit` query parameters. |
| `GET` | `/api/accounts/:id` | Get details and live publishing statistics for a specific account. |
| `PATCH` | `/api/accounts/:id/preferences` | Update per-account publishing defaults and preferences. |
| `POST` | `/api/accounts/:id/test` | Test token validity and refresh channel subscriber count. |
| `POST` | `/api/accounts/:id/disconnect` | Safe disconnect (revokes token and marks status as disconnected). |
| `DELETE` | `/api/accounts/:id` | Permanently delete account record (requires admin auth). |
| `GET` | `/api/accounts/:id/history` | View recent publishing jobs and audit logs for this specific account. |

### Multi-Target Publishing

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/posts/multi-platform` | Schedules a video for multiple accounts simultaneously. Accepts `targets: [{ accountId, platform }]` or `platforms: [...]`. |
| `GET` | `/api/posts?accountId=:id` | Filter publishing queue jobs by specific account. |

---

## 5. Verification & Testing

The backend includes a dedicated test suite verifying multi-account capabilities:
```powershell
cd "e:\4444\video automation\backend"
npm test
```
The test suite validates:
1. Connecting multiple independent accounts on the same platform.
2. Compound unique index `{ platform: 1, accountId: 1 }` enforcement.
3. Multi-account publishing target dispatch with separate `Post` IDs and idempotency keys.
4. Per-account duplicate prevention (allows same video on different channels, blocks same video on same channel).
5. Account isolation during job failures.
6. Rejection of scheduling to expired or disconnected accounts.
7. Account publishing preference merging (title prefix/suffix, tags).
8. Safe token revocation and disconnect.
