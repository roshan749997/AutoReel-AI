# YouTube Data API v3 Setup Guide

Configure official OAuth 2.0 publishing for YouTube Shorts & Videos.

## Step 1: Enable API & Scopes
1. In the same Google Cloud Console project used for Google Drive, ensure **YouTube Data API v3** is enabled.
2. In **OAuth Consent Screen**, add the publishing scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube`
   - `https://www.googleapis.com/auth/youtube.readonly`

## Step 2: Quota Considerations (100% Free)
- Default free daily quota: **10,000 units/day**.
- Uploading one video costs approximately **1,600 units**.
- This enables uploading up to 6 videos per day per Google project completely free.
- If more volume is needed, submit a free Quota Increase Request directly in Google Cloud Console.

## Step 3: Connect Your Channel in Dashboard
1. Start the frontend and backend.
2. In the dashboard, navigate to **Social Accounts** > **Connect YouTube Channel**.
3. You will be directed to Google's official consent dialog.
4. Authorize the application. The backend exchanges the authorization code for an encrypted refresh token stored in your database.
