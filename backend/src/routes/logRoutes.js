import { Router } from 'express';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { requireAdminAuth } from '../middleware/auth.js';

const router = Router();

// Get paginated system audit logs
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.module) query.module = req.query.module;
    if (req.query.level) query.level = req.query.level;

    const [logs, total] = await Promise.all([
      WorkflowLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      WorkflowLog.countDocuments(query),
    ]);

    res.json({
      status: 'success',
      data: logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Clear logs
router.delete('/', requireAdminAuth, async (req, res, next) => {
  try {
    await WorkflowLog.deleteMany({});
    res.json({ status: 'success', message: 'Audit logs cleared' });
  } catch (err) {
    next(err);
  }
});

export default router;
