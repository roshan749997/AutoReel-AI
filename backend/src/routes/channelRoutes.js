import { Router } from 'express';
import { ChannelPair } from '../models/ChannelPair.js';
import { Account } from '../models/Account.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

function serializePair(pair) {
  return {
    folderId: pair.folderId,
    folderName: pair.folderName || '',
    youtubeAccountId: pair.youtubeAccountId || '',
    instagramAccountId: pair.instagramAccountId || '',
    updatedAt: pair.updatedAt,
  };
}

async function assertAccountPlatform(accountId, platform) {
  if (!accountId) return;
  const account = await Account.findById(accountId);
  if (!account) {
    throw new AppError(`${platform === 'youtube' ? 'YouTube' : 'Instagram'} account was not found`, 400);
  }
  if (account.platform !== platform) {
    throw new AppError(`That account is not a ${platform} account`, 400);
  }
}

router.get('/', async (req, res, next) => {
  try {
    const pairs = await ChannelPair.find({}).sort({ folderName: 1, createdAt: 1 });
    res.json({ status: 'success', data: pairs.map(serializePair) });
  } catch (err) {
    next(err);
  }
});

router.put('/:folderId', requireAdminAuth, async (req, res, next) => {
  try {
    const folderId = String(req.params.folderId || '').trim();
    if (!folderId) {
      throw new AppError('Drive folder id is required', 400);
    }

    const folderName = String(req.body.folderName || '').trim();
    const youtubeAccountId = String(req.body.youtubeAccountId || '').trim();
    const instagramAccountId = String(req.body.instagramAccountId || '').trim();

    await assertAccountPlatform(youtubeAccountId, 'youtube');
    await assertAccountPlatform(instagramAccountId, 'instagram');

    const pair = await ChannelPair.findOneAndUpdate(
      { folderId },
      {
        folderId,
        folderName,
        youtubeAccountId,
        instagramAccountId,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ status: 'success', data: serializePair(pair) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:folderId', requireAdminAuth, async (req, res, next) => {
  try {
    const folderId = String(req.params.folderId || '').trim();
    await ChannelPair.deleteOne({ folderId });
    res.json({ status: 'success', data: { folderId } });
  } catch (err) {
    next(err);
  }
});

export default router;
