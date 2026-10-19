# Instagram API Setup (Official Meta Publishing)

AutoReel AI supports official, compliant Instagram Reel publishing using Meta's official endpoints. No browser automation, no unauthorized reverse-engineered APIs, and no password scraping.

---

## Supported Flow: Instagram API with Instagram Login (Recommended & Default)

Meta's modern **Instagram API with Instagram Login** allows users to authenticate directly with their Instagram Professional account without requiring linked Facebook Pages.

### 1. Requirements
- An **Instagram Professional Account** (Creator or Business) — free to switch in the Instagram mobile app under *Settings > Account Type and Tools*.
- A **Meta Developer Account** at [developers.facebook.com](https://developers.facebook.com/).

### 2. Meta Developer App Configuration
1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps/).
2. Click **Create App** and select **Other** > **Business** (or select the **Instagram** use case).
3. Under **Use Cases**, set up **Access the Instagram API with Instagram Login**.
4. In **Use Cases > Customize**, add the required permissions:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
5. Go to **Instagram settings** or **Basic Settings** and add the **Valid OAuth Redirect URI**:
   ```
   http://localhost:5000/api/accounts/meta/callback
   ```
6. In **App Settings > Basic**, copy your **App ID** and **App Secret**.

### 3. Environment Variables (`backend/.env`)
```env
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_REDIRECT_URI=http://localhost:5000/api/accounts/meta/callback
META_AUTH_FLOW=instagram_login
```

### 4. Development Mode Note
If your Meta App is in **Development Mode**:
- Only users with a role on the app can authorize.
- In your Meta App Dashboard, navigate to **Roles** or **Instagram Testers** and add your Instagram username.
- On your Instagram account (mobile app or web), accept the tester invitation under *Settings > Apps and Websites > Tester Invites*.

---

## Alternative Flow: Instagram Graph API with Facebook Login

If you manage Instagram accounts strictly via linked Facebook Pages:
1. In `backend/.env`, set:
   ```env
   META_AUTH_FLOW=facebook_login
   ```
2. Required permissions in Facebook Login:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
3. Notice: AutoReel AI strictly isolates scopes per flow. Scopes from Facebook Login and Instagram Login are never mixed together in an authorization request.

---

## Token Security & Storage
1. The backend exchanges the authorization code for a short-lived user token, and immediately upgrades it to a **60-day long-lived access token**.
2. All tokens are encrypted at rest with **AES-256-GCM** using `cryptoService` before being saved to MongoDB.
3. Access tokens are never returned in plain text to frontend clients.
