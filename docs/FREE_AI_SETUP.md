# Free AI Provider Setup (Gemini Free Tier & Local Ollama)

This project features a pluggable AI service architecture that incurs $0 cost by using either Google Gemini's free tier, local Ollama models, or deterministic rule-based generation.

## Option 1: Google Gemini Free Tier (Recommended)
Google AI Studio offers a free tier for Gemini models:
- Free Limits: **15 Requests per minute (RPM)**, **1,000,000 Tokens per minute (TPM)**, **1,500 Requests per day (RPD)**.
- Plenty of capacity to generate titles, descriptions, viral hooks, and hashtags for hundreds of videos per day.

### Getting a Free Gemini API Key:
1. Visit [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click **Get API key** > **Create API key in new project**.
4. Set in `backend/.env`:
   ```env
   AI_PROVIDER=gemini
   GEMINI_API_KEY=AIzaSy...
   GEMINI_MODEL=gemini-1.5-flash
   ```

## Option 2: Ollama (100% Offline / Local, 0 Cost)
If you prefer running models entirely on your local machine without internet or API keys:
1. Download Ollama for Windows from [ollama.com](https://ollama.com/).
2. In PowerShell, pull a fast, high quality model:
   ```powershell
   ollama pull llama3.2
   ```
3. Ensure Ollama is running (`ollama serve`).
4. Set in `backend/.env`:
   ```env
   AI_PROVIDER=ollama
   OLLAMA_BASE_URL=http://127.0.0.1:11434
   OLLAMA_MODEL=llama3.2
   ```

## Option 3: Manual / Rule Fallback
If no API key is provided and Ollama is not running, the system automatically falls back to clean, rule-based algorithmic template generation extracted from video filenames, tags, and category taxonomies. Nothing breaks.
