import { Router } from 'express';
import axios from 'axios';
import { config } from '../config/env.js';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { Post } from '../models/Post.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// In-memory LRU-like set for webhook replay prevention (stores last 500 event keys for 1 hour)
const processedWebhooks = new Map();

function isDuplicateWebhook(eventId) {
  if (!eventId) return false;
  const now = Date.now();
  if (processedWebhooks.has(eventId)) {
    const timestamp = processedWebhooks.get(eventId);
    if (now - timestamp < 3600000) {
      return true; // Already processed within 1 hour
    }
  }

  // Cleanup old entries if map grows
  if (processedWebhooks.size > 500) {
    const cutoff = now - 3600000;
    for (const [key, ts] of processedWebhooks.entries()) {
      if (ts < cutoff) processedWebhooks.delete(key);
    }
  }

  processedWebhooks.set(eventId, now);
  return false;
}

// 1. Check n8n automation status
router.get('/status', async (req, res) => {
  let isReachable = false;
  let statusInfo = null;

  try {
    const response = await axios.get('http://127.0.0.1:5678/healthz', { timeout: 2000 });
    isReachable = response.status === 200;
    statusInfo = response.data;
  } catch (err) {
    isReachable = false;
  }

  res.json({
    status: 'success',
    data: {
      isReachable,
      webhookUrl: config.n8n.webhookUrl,
      dockerStatus: isReachable ? 'running' : 'stopped_or_unreachable',
      statusInfo,
    },
  });
});

// 2. Trigger an n8n webhook workflow
router.post('/trigger', requireAdminAuth, async (req, res, next) => {
  try {
    const { workflow = 'video-pipeline', payload = {} } = req.body;
    const targetUrl = `${config.n8n.webhookUrl}`;

    await WorkflowLog.create({
      level: 'info',
      module: 'n8n',
      action: 'workflow_trigger',
      message: `Triggering n8n workflow "${workflow}" at ${targetUrl}`,
      metadata: payload,
    });

    const response = await axios.post(targetUrl, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-WEBHOOK-SECRET': config.n8n.webhookSecret,
        ...(config.n8n.apiKey && { 'X-N8N-API-KEY': config.n8n.apiKey }),
      },
    });

    res.json({
      status: 'success',
      message: 'n8n workflow triggered successfully',
      data: response.data,
    });
  } catch (err) {
    await WorkflowLog.create({
      level: 'warn',
      module: 'n8n',
      action: 'workflow_trigger_failed',
      message: `Failed to trigger n8n: ${err.message}`,
    });
    next(new AppError(`n8n trigger failed (is n8n running at 127.0.0.1:5678?): ${err.message}`, 502));
  }
});

// 3. Webhook callback received from n8n (Secured with Secret + Replay Idempotency)
router.post('/callback', async (req, res, next) => {
  try {
    // 1. Authenticate webhook caller via secret header or query param
    const providedSecret =
      req.headers['x-n8n-webhook-secret'] ||
      req.headers['x-api-key'] ||
      req.query.secret;

    const expectedSecret = config.n8n.webhookSecret || config.dashboardApiKey;

    if (expectedSecret && providedSecret !== expectedSecret) {
      await WorkflowLog.create({
        level: 'warn',
        module: 'n8n',
        action: 'unauthorized_webhook',
        message: 'Rejected unauthorized n8n webhook callback (invalid or missing secret)',
      }).catch(() => {});
      return next(new AppError('Unauthorized: Invalid webhook secret', 401));
    }

    const {
      eventId,
      postId,
      status,
      workflowName,
      message,
      metadata,
    } = req.body;

    // 2. Replay & Idempotency check
    const dedupeKey = eventId || (postId && status ? `${postId}_${status}` : null);
    if (dedupeKey && isDuplicateWebhook(dedupeKey)) {
      return res.json({
        status: 'skipped_duplicate',
        message: `Webhook event '${dedupeKey}' was already processed`,
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Optional status sync on referenced Post (MongoDB remains sole source of truth)
    if (postId) {
      const post = await Post.findById(postId);
      if (post) {
        post.executionLogs.push({
          step: 'n8n_callback',
          message: message || `Status notification from n8n: ${status || 'received'}`,
          level: status === 'error' ? 'error' : 'info',
        });
        await post.save();
      }
    }

    await WorkflowLog.create({
      level: status === 'error' ? 'error' : 'info',
      module: 'n8n',
      action: 'workflow_callback',
      message: message || `Callback from n8n workflow "${workflowName || 'Video Pipeline'}"`,
      metadata: metadata || req.body,
    });

    res.json({
      status: 'success',
      received: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
