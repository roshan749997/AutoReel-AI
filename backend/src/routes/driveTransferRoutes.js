import { Router } from 'express';
import { requireAdminAuth } from '../middleware/auth.js';
import { getDriveTransferConfig } from '../drive-transfer/config.js';
import {
  buildAuthUrl,
  verifyTransferState,
  exchangeAuthCode,
  disconnectTransferAccount,
  getTransferAuthStatus,
} from '../drive-transfer/oauth.js';
import {
  validateTransferRequest,
  startPreview,
  startCopy,
  resumeJob,
  retryFailed,
  cancelJob,
  getJob,
  listJobs,
  listFailures,
  setParallelCopies,
  queueFolderCopies,
  cancelQueuedJobs,
} from '../drive-transfer/worker.js';

const router = Router();

router.get('/oauth/status', requireAdminAuth, async (req, res, next) => {
  try {
    const status = await getTransferAuthStatus();
    res.json({ status: 'success', data: status });
  } catch (err) {
    next(err);
  }
});

router.get('/oauth/url', requireAdminAuth, (req, res, next) => {
  try {
    const data = buildAuthUrl();
    res.json({ status: 'success', data: { authUrl: data.authUrl, redirectUri: data.redirectUri } });
  } catch (err) {
    next(err);
  }
});

router.get('/oauth/callback', async (req, res) => {
  const cfg = getDriveTransferConfig();
  const back = (query) => {
    const base = cfg.clientUrl.replace(/\/$/, '');
    res.redirect(`${base}/?tab=drive-transfer&${query}`);
  };

  try {
    if (req.query.error) {
      const message = req.query.error_description || req.query.error;
      return back(`dt_status=error&dt_error=${encodeURIComponent(message)}`);
    }
    if (!verifyTransferState(req.query.state)) {
      return back(`dt_status=error&dt_error=${encodeURIComponent('Invalid or expired Drive Transfer sign-in. Start the connection again.')}`);
    }
    if (!req.query.code) {
      return back(`dt_status=error&dt_error=${encodeURIComponent('Missing authorization code.')}`);
    }
    await exchangeAuthCode(req.query.code);
    return back('dt_status=connected');
  } catch (err) {
    return back(`dt_status=error&dt_error=${encodeURIComponent(err.message || 'Drive Transfer sign-in failed')}`);
  }
});

router.post('/oauth/disconnect', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await disconnectTransferAccount();
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/validate', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await validateTransferRequest({
      sourceUrl: req.body?.sourceUrl,
      destinationUrl: req.body?.destinationUrl,
    });
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/preview', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await startPreview({
      sourceUrl: req.body?.sourceUrl,
      destinationUrl: req.body?.destinationUrl,
    });
    res.status(202).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/batches', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await queueFolderCopies({
      pairs: req.body?.pairs,
      parallelCopies: req.body?.parallelCopies,
    });
    res.status(202).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/batches/cancel', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await cancelQueuedJobs();
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.get('/jobs', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await listJobs();
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/:jobId', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await getJob(req.params.jobId);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/:jobId/failures', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await listFailures(req.params.jobId);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:jobId/speed', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await setParallelCopies(req.params.jobId, req.body?.parallelCopies);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:jobId/copy', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await startCopy(req.params.jobId, req.body?.parallelCopies);
    res.status(202).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:jobId/resume', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await resumeJob(req.params.jobId, req.body?.parallelCopies);
    res.status(202).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:jobId/retry', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await retryFailed(req.params.jobId, req.body?.parallelCopies);
    res.status(202).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:jobId/cancel', requireAdminAuth, async (req, res, next) => {
  try {
    const data = await cancelJob(req.params.jobId);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

export default router;
