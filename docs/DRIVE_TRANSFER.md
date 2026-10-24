# Drive Transfer

Drive Transfer copies one Google Drive folder into another. It is a separate page, a separate API (`/api/drive-transfer/*`), and a separate Google sign-in. It does not change YouTube uploads, Instagram publishing, Drive indexing, scheduling, or the existing Google OAuth scopes.

Source files are only listed and copied. The copy is a server-side Drive API `files.copy`. The feature does not download file bytes, and it does not delete, trash, or update source files.

Live copies were not run as part of adding this feature. A successful transfer still has to be confirmed with a source folder and a destination folder the signed-in account can access.

## Google Cloud setup

Use a **new** OAuth client so the YouTube client’s redirect URI and consent scopes stay as they are.

1. Open the same Google Cloud project (or a new one) and enable the **Google Drive API**.
2. Create an OAuth client of type **Web application**. Do not edit the client used by `GOOGLE_CLIENT_ID`.
3. Add this authorized redirect URI exactly:

   `http://localhost:5000/api/drive-transfer/oauth/callback`

4. If the OAuth app is in Testing, add the Google account that can see both folders as a test user.
5. Put the new client’s id and secret in `backend/.env` using the names below. Leave `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` unchanged.

The sign-in asks for:

- `https://www.googleapis.com/auth/drive` — required to read an existing source folder and create copies in an existing destination folder. `drive.file` cannot see those folders.
- `https://www.googleapis.com/auth/userinfo.email` — used only to show which account is connected.

`include_granted_scopes` is off, so this consent is not merged into the YouTube grant by this app.

The account you connect must be able to list the source folder and add files to the destination. If the folders belong to two different people, share both folders with this account first. Disconnecting in the dashboard deletes only the Drive Transfer tokens stored by this app. It does not call Google’s revoke endpoint, so a shared OAuth client cannot revoke the YouTube refresh token.

## Environment variables

Add these to `backend/.env`. A template is in `backend/drive-transfer.env.example`.

| Variable | Purpose |
| :--- | :--- |
| `DRIVE_TRANSFER_GOOGLE_CLIENT_ID` | OAuth client id for Drive Transfer only |
| `DRIVE_TRANSFER_GOOGLE_CLIENT_SECRET` | OAuth client secret for Drive Transfer only |
| `DRIVE_TRANSFER_REDIRECT_URI` | Optional. Defaults to `http://localhost:5000/api/drive-transfer/oauth/callback` |
| `DRIVE_TRANSFER_OAUTH_SCOPE` | Optional. Defaults to `https://www.googleapis.com/auth/drive` |
| `DRIVE_TRANSFER_MAX_FILES` | Optional safety cap. Defaults to `50000` |

Restart the API after saving. The dashboard reads the existing `DASHBOARD_API_KEY` / `VITE_DASHBOARD_API_KEY` when that key is already configured. No existing variable is renamed or replaced.

On Render, add the same `DRIVE_TRANSFER_*` values to the backend service and set `DRIVE_TRANSFER_REDIRECT_URI` to `https://<your-backend>/api/drive-transfer/oauth/callback`. Add that exact URI on the Drive Transfer OAuth client. `render.yaml` is unchanged.

## What the page does

1. Connect the Drive Transfer account.
2. Paste a source folder URL and a destination folder URL.
3. **Check access** confirms the source is a readable folder and the destination is a writable folder, and rejects a destination inside the source.
4. **Dry-run preview** walks subfolders with Drive pagination and reports total files, videos, folders, duplicates, and items that cannot be copied. It does not create files.
5. **Copy files** creates missing subfolders under the destination and copies files with `files.copy`.
6. Duplicates (same name and checksum, size, or native Google file type) are skipped. A different file with the same name is left untouched and reported as a conflict.
7. Rate limits are retried with backoff. Permission, quota, inaccessible, and unsupported-copy errors are shown per file.
8. **Resume** continues an interrupted scan or copy. **Retry failed** tries failed items again. **Cancel** stops the job. Files already copied stay in the destination.

Tokens are encrypted with the existing AES-256-GCM helper and stored in `drive_transfer_credentials`. Jobs and files are stored in `drive_transfer_jobs` and `drive_transfer_items`. Those collections are not the video library or the publishing queue.
