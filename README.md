# AI Video Automation Agent (Free-Only SaaS Pipeline)

A production-minded, 100% free-tier AI video automation dashboard and publishing pipeline. Built to index **20,000+ videos** from an existing Google Drive library, generate viral hooks and metadata using zero-cost AI (Google Gemini free tier or local Ollama), schedule posts, and publish via official YouTube Data API v3 and Meta Instagram Graph API endpoints.

---

## Key Features

- **20,000+ Video Drive Indexer**: Discovers and streams videos directly from Google Drive without duplicating massive files locally.
- **Official Platform APIs Only**: Strictly compliant with YouTube Data API v3 (Shorts/Videos) and Meta Graph API v20.0+ (Instagram Reels). No unofficial scrapers, password bots, or browser automation.
- **Zero-Cost Pluggable AI**: Uses Google Gemini Free Tier (15 RPM / 1M TPM / 1500 RPD) or local Ollama models (0 API cost), with deterministic heuristic fallback.
- **Enterprise-Grade Token Security**: OAuth tokens are encrypted at rest using AES-256-GCM before storage in MongoDB. Secrets are never exposed to the frontend.
- **Self-Hosted Workflow Automation**: Includes Docker Compose configuration for n8n Community Edition, strictly bound to `127.0.0.1:5678` with persistent storage.
- **Modern SaaS Dashboard**: Neutral charcoal surfaces, responsive sidebar navigation, publishing queue, visual calendar, setup checklist, and live diagnostics.

---

## Tech Stack

| Layer | Technology | Cost |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite, Tailwind CSS, Lucide React | $0 (Open Source) |
| **Backend** | Node.js 20+, Express.js (ESM), Helmet, CORS | $0 (Open Source) |
| **Database** | MongoDB Atlas (M0 Free Cluster) or Local MongoDB | $0 (Free Tier) |
| **AI Metadata** | Google Gemini Free Tier / Local Ollama (`llama3.2`) | $0 (Free Tier / Offline) |
| **Automation** | Self-hosted n8n Community Edition in Docker | $0 (Open Source) |
| **Video Storage** | Google Drive API v3 (accesses your existing Drive files) | $0 (Included with Drive) |
| **Publishing** | Official YouTube Data API v3 & Meta Instagram Graph API | $0 (Official Free Quota) |

---

## Monorepo Directory Structure

```
├── package.json               # Root monorepo scripts & dev orchestrator
├── .gitignore                 # Excludes secrets, node_modules, build artifacts
├── .env.example               # Safe environment variable template
├── docs/                      # Setup guides and architecture documentation
│   ├── ARCHITECTURE.md
│   ├── GOOGLE_DRIVE_SETUP.md
│   ├── YOUTUBE_API_SETUP.md
│   ├── INSTAGRAM_GRAPH_API_SETUP.md
│   └── FREE_AI_SETUP.md
├── automation/
│   └── n8n/                   # Self-hosted n8n Community Edition
│       ├── docker-compose.yml # Bound strictly to 127.0.0.1:5678
│       ├── .env.example
│       └── workflows/         # Starter pipeline webhook workflow
├── backend/
│   ├── package.json           # Node ESM backend
│   ├── src/
│   │   ├── server.js          # Express entrypoint & graceful shutdown
│   │   ├── config/            # Database & environment configurations
│   │   ├── middleware/        # Security, validation, centralized error handler
│   │   ├── models/            # Mongoose schemas (Account, Video, Post, WorkflowLog)
│   │   ├── services/          # Crypto (AES-256-GCM), Drive, YouTube, Instagram, AI, FFmpeg
│   │   └── routes/            # REST API endpoints
│   └── tests/                 # Unit tests (crypto, health, config)
└── frontend/
    ├── package.json           # React + Vite + Tailwind CSS
    ├── index.html
    └── src/                   # Dashboard shell, modules, and API client
```

---

## Windows Setup Instructions

### 1. Prerequisites
- **Node.js**: v18 or v20+ installed (`node -v` in PowerShell).
- **Git**: installed on Windows.
- **MongoDB**: A free MongoDB Atlas M0 Cluster URI OR a local MongoDB instance.
- **Docker Desktop for Windows** *(optional, for running local n8n)*.

---

### 2. Clone & Install Dependencies

Open **PowerShell** in the project directory:

```powershell
# 1. Install root dependencies
npm install

# 2. Install backend dependencies
cd backend
npm install
cd ..

# 3. Install frontend dependencies
cd frontend
npm install
cd ..
```

---

### 3. Configure Environment Variables

1. Copy `.env.example` in `backend/` to `backend/.env`:
```powershell
Copy-Item backend/.env.example backend/.env
```

2. Generate a secure 32-byte AES-256 encryption key in PowerShell:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste this value into `backend/.env` as `ENCRYPTION_KEY`.

3. Update `backend/.env` with your settings:
   - `MONGODB_URI`: Your MongoDB connection string (e.g. `mongodb://127.0.0.1:27017/video_automation` or Atlas SRV string).
   - `GEMINI_API_KEY`: Get a 100% free key at [Google AI Studio](https://aistudio.google.com/) (Optional: or set `AI_PROVIDER=manual` or `AI_PROVIDER=ollama`).
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: See [docs/GOOGLE_DRIVE_SETUP.md](file:///e:/4444/video%20automation/docs/GOOGLE_DRIVE_SETUP.md).
   - `META_APP_ID` & `META_APP_SECRET`: See [docs/INSTAGRAM_GRAPH_API_SETUP.md](file:///e:/4444/video%20automation/docs/INSTAGRAM_GRAPH_API_SETUP.md).

---

### 4. Run the Project on Windows

#### Option A: Run Both Backend and Frontend Concurrently (Single Terminal)
```powershell
npm run dev
```

#### Option B: Run in Separate Terminals
**Terminal 1 (Backend API on port 5000):**
```powershell
cd backend
npm run dev
```

**Terminal 2 (Frontend Dashboard on port 5173):**
```powershell
cd frontend
npm run dev
```

Open your browser to: **[http://localhost:5173](http://localhost:5173)**.

---

### 5. Running Automated Tests

Run backend unit tests verifying AES-256-GCM encryption, token roundtrips, and health checks:
```powershell
npm --prefix backend test
```

---

### 6. Starting Local n8n (Docker on Windows)

In a PowerShell terminal:
```powershell
npm run n8n:up
```
n8n will be available at [http://127.0.0.1:5678](http://127.0.0.1:5678). To stop it, run `npm run n8n:down`.

---

## Security Policies
- **No Hardcoded Secrets**: Secrets are loaded from `.env` files which are strictly excluded by `.gitignore`.
- **Token Encryption**: Access and refresh tokens are stored encrypted using AES-256-GCM.
- **Localhost Binding**: Development servers and n8n are bound to `127.0.0.1`, preventing local network exposure.
- **Official APIs**: Only official Google Drive API v3, YouTube Data API v3, and Meta Graph API v20.0+ are utilized.
