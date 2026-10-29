# Google Drive API v3 Setup (20,000+ Videos Library)

This guide walks through configuring official Google Drive API v3 to discover, index, filter, and stream your existing 20,000+ video library without downloading video binaries locally.

---

## 1. Google Cloud Console Configuration (100% Free)

1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a project (e.g., `video-automation-agent`).
3. In the left navigation, click **APIs & Services** > **Library**.
4. Search for and click **Enable** for:
   - **Google Drive API**
   - **YouTube Data API v3** *(if also publishing to YouTube)*

---

## 2. OAuth Consent Screen & Scopes

1. Go to **APIs & Services** > **OAuth consent screen**.
2. User Type: Select **External** (or **Internal** if using Google Workspace).
3. Fill in:
   - **App name**: `Video Automation Agent`
   - **User support email**: Your Google email
   - **Developer contact information**: Your Google email
4. Click **Save and Continue**.
5. On the **Scopes** screen, keep YouTube and Drive apart:
   - YouTube channel connect, including Brand Accounts, requests only `youtube.upload`, `youtube`, and `youtube.readonly`. Do not add Drive or userinfo scopes to that consent. Brand Accounts cannot grant them.
   - Drive library and Drive Transfer use a separate sign-in. Its scopes are `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/userinfo.email`. See `docs/DRIVE_TRANSFER.md`.
6. On the **Test users** screen, add your personal or workspace Google Account email.
7. Click **Save and Continue**.

---

## 3. Create OAuth 2.0 Client Credentials

1. Go to **APIs & Services** > **Credentials** > **Create Credentials** > **OAuth client ID**.
2. Application type: Select **Web application**.
3. Name: `Video Automation Agent Web Client`.
4. Under **Authorized redirect URIs**, click **Add URI** and enter:
   ```
   http://localhost:5000/api/accounts/google/callback
   ```
5. Click **Create**.
6. Copy your **Client ID** and **Client Secret**.

---

## 4. Configure Backend Environment

In `backend/.env`, set:
```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:5000/api/accounts/google/callback
GOOGLE_DRIVE_FOLDER_ID=your_target_folder_id_here
```

### How to Find Your Google Drive Folder ID:
1. Open Google Drive in your web browser.
2. Navigate into the folder containing your 20,000+ videos.
3. Inspect the browser address bar:
   `https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvW`
4. The string after `/folders/` is your `GOOGLE_DRIVE_FOLDER_ID`.
*(Note: If left blank or set to `root`, the indexer searches your top-level Google Drive).*

---

## 5. Authorizing Your Account in Dashboard

1. Start the application:
   ```powershell
   npm run dev
   ```
2. Open [http://localhost:5173](http://localhost:5173).
3. Navigate to **Social Accounts** > Click **Add YouTube** (which authenticates your Google Account for both Drive read access and YouTube).
4. Google will display the consent dialog. Select your account and grant permission.
5. The backend captures the authorization code, exchanges it for long-lived OAuth tokens, encrypts them at rest with AES-256-GCM, and connects your library.

---

## 6. Starting & Resuming Indexing for 20,000+ Videos

1. In the dashboard, navigate to **Video Library**.
2. The **Google Drive Library** banner will confirm: `Drive Connected: you@gmail.com`.
3. Click **Configure Folder & Sync**:
   - Verify or enter your target Folder ID.
   - Click **Validate Access** — the backend immediately verifies that the folder exists, is not trashed, and that your account has read permissions.
   - Check **Include Subfolders** if your videos are organized in subdirectories.
4. Click **Start Fresh Indexing**:
   - The indexer runs asynchronously in the background.
   - A live progress card displays scanned count, newly indexed, updated files, pages, and last processed file.
5. **Pausing & Resumption**:
   - Click **Pause / Cancel** at any time. The system saves the exact cursor continuation token (`pageToken`) and folder queue in MongoDB.
   - Click **Resume Previous Sync** to pick up exactly where you left off without creating duplicate records or starting over.

---

## 7. Troubleshooting & Quota Management

| Issue / Error Code | Cause | Resolution |
| :--- | :--- | :--- |
| `404 Folder not found` | Invalid Folder ID or deleted folder | Verify the ID from the URL; check that the folder is not in Trash. |
| `403 Permission denied` | Account lacks read access | Verify that the authorized Google account has at least "Viewer" permission on the folder. |
| `403 rateLimitExceeded` | Google Drive API rate limits (1000 req/100s) | The system automatically applies exponential backoff with jitter and retries. |
| `Google authorization expired` | Refresh token revoked or expired | Click **Social Accounts** > Disconnect old account and re-connect via OAuth. |
| `redirect_uri_mismatch` | Redirect URI doesn't match Google Console | Ensure `http://localhost:5000/api/accounts/google/callback` is added under Authorized redirect URIs in Google Cloud Console. |
