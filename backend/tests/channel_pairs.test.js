import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Account } from '../src/models/Account.js';
import { ChannelPair } from '../src/models/ChannelPair.js';
import channelRoutes from '../src/routes/channelRoutes.js';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  await closeDatabase();
});

test('Channel pairs: save one Drive folder to one YouTube and one Instagram account', async () => {
  const stamp = Date.now();
  const folderId = `folder_channel_${stamp}`;

  const youtube = await Account.create({
    platform: 'youtube',
    accountId: `yt_channel_${stamp}`,
    accountName: 'Channel YT',
    status: 'connected',
    encryptedAccessToken: 'enc_token_yt',
    isDemo: false,
  });
  const instagram = await Account.create({
    platform: 'instagram',
    accountId: `ig_channel_${stamp}`,
    accountName: 'Channel IG',
    username: 'channel_ig',
    status: 'connected',
    encryptedAccessToken: 'enc_token_ig',
    isDemo: false,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/channels', channelRoutes);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const saved = await (await fetch(`${baseUrl}/api/channels/${folderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: 'Tools reels',
        youtubeAccountId: String(youtube._id),
        instagramAccountId: String(instagram._id),
      }),
    })).json();

    assert.equal(saved.data.folderId, folderId);
    assert.equal(saved.data.folderName, 'Tools reels');
    assert.equal(saved.data.youtubeAccountId, String(youtube._id));
    assert.equal(saved.data.instagramAccountId, String(instagram._id));

    const listed = await (await fetch(`${baseUrl}/api/channels`)).json();
    const hit = listed.data.find((row) => row.folderId === folderId);
    assert.ok(hit);
    assert.equal(hit.youtubeAccountId, String(youtube._id));
  } finally {
    await ChannelPair.deleteMany({ folderId });
    await Account.deleteMany({ _id: { $in: [youtube._id, instagram._id] } });
    await new Promise((resolve) => server.close(resolve));
  }
});
