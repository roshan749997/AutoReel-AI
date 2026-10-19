# Self-Hosted n8n Workflow Automation (Docker on Windows)

This setup runs **n8n Community Edition (100% Free)** locally using Docker Compose, strictly bound to `127.0.0.1` (localhost) with persistent storage and encrypted credentials.

## Prerequisites
- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) installed and running.

## Starting n8n

From the project root:
```powershell
npm run n8n:up
```
Or directly with Docker Compose:
```powershell
docker compose -f automation/n8n/docker-compose.yml up -d
```

## Stopping n8n
```powershell
npm run n8n:down
```

## Viewing Logs
```powershell
npm run n8n:logs
```

## Security & Access
- The web interface is available at: [http://127.0.0.1:5678](http://127.0.0.1:5678)
- The container is configured with `127.0.0.1:5678:5678` port mapping, preventing access from local network (LAN) or public interfaces.
- Workflows and credentials are saved in the persistent Docker volume `video_automation_n8n_data`.
- An encryption key is set via `N8N_ENCRYPTION_KEY` to protect credentials at rest.

## Importing the Sample Pipeline Workflow
1. Open [http://127.0.0.1:5678](http://127.0.0.1:5678) in your browser.
2. Follow the one-time owner account setup.
3. Click **Workflows** > **Import from File...**
4. Select `automation/n8n/workflows/sample_video_pipeline.json`.
5. Click **Save** and toggle the workflow to **Active**.
