import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Account } from '../src/models/Account.js';
import { Video } from '../src/models/Video.js';
import { googleDriveService } from '../src/services/googleDriveService.js';
import videoRoutes from '../src/routes/videoRoutes.js';
import accountRoutes from '../src/routes/accountRoutes.js';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  await closeDatabase();
});

test('Drive catalog: Videos are purged and 0 returned when no drive accounts are connected', async () => {
  const testTag = `test_${Date.now()}`;
  await Account.deleteMany({ accountId: { $regex: '^yt_test_' } });
  await Video.deleteMany({ driveFileId: { $regex: '^file_test_' } });

  // 1. Create a connected YouTube/Drive account
  const accountA = await Account.create({
    platform: 'youtube',
    accountId: `yt_acc_${Date.now()}`,
    accountName: 'Channel A',
    googleEmail: 'channelA@gmail.com',
    status: 'connected',
    encryptedAccessToken: 'dummy_enc_token',
    isDemo: false,
  });

  // 2. Create videos attached to Account A
  const videoA1 = await Video.create({
    driveFileId: `file_a1_${Date.now()}`,
    originalName: 'videoA1.mp4',
    cleanTitle: 'Video A1',
    mimeType: 'video/mp4',
    accountId: accountA._id,
    googleEmail: accountA.googleEmail,
    status: 'discovered',
  });

  const videoA2 = await Video.create({
    driveFileId: `file_a2_${Date.now()}`,
    originalName: 'videoA2.mp4',
    cleanTitle: 'Video A2',
    mimeType: 'video/mp4',
    accountId: accountA._id,
    googleEmail: accountA.googleEmail,
    status: 'discovered',
  });

  // Verify videos exist
  const countBefore = await Video.countDocuments({ accountId: accountA._id });
  assert.equal(countBefore, 2);

  // 3. Simulate account deletion / disconnect cleanup logic
  await Video.deleteMany({
    $or: [{ accountId: accountA._id }, { googleEmail: accountA.googleEmail }],
  });
  await Account.findByIdAndDelete(accountA._id);

  // If no remaining connected accounts exist, ensure DB has 0 videos
  const remaining = await Account.countDocuments({ platform: 'youtube', status: 'connected' });
  if (remaining === 0) {
    await Video.deleteMany({});
  }

  const countAfter = await Video.countDocuments({});
  assert.equal(countAfter, 0, 'All videos should be removed when drive is deleted');
});

test('Drive catalog: Multi-drive separation displays only selected connected drive videos', async () => {
  await Account.deleteMany({ platform: 'youtube' });
  await Video.deleteMany({});

  const account1 = await Account.create({
    platform: 'youtube',
    accountId: `yt_acc1_${Date.now()}`,
    accountName: 'Channel 1',
    googleEmail: 'channel1@gmail.com',
    status: 'connected',
    encryptedAccessToken: 'dummy_enc_token',
    isDemo: false,
  });

  const account2 = await Account.create({
    platform: 'youtube',
    accountId: `yt_acc2_${Date.now()}`,
    accountName: 'Channel 2',
    googleEmail: 'channel2@gmail.com',
    status: 'connected',
    encryptedAccessToken: 'dummy_enc_token',
    isDemo: false,
  });

  await Video.create({
    driveFileId: `file_1_${Date.now()}`,
    originalName: 'drive1_video.mp4',
    cleanTitle: 'Drive 1 Video',
    mimeType: 'video/mp4',
    accountId: account1._id,
    googleEmail: account1.googleEmail,
  });

  await Video.create({
    driveFileId: `file_2_${Date.now()}`,
    originalName: 'drive2_video.mp4',
    cleanTitle: 'Drive 2 Video',
    mimeType: 'video/mp4',
    accountId: account2._id,
    googleEmail: account2.googleEmail,
  });

  // Query videos specifically for Account 1
  const videosDrive1 = await Video.find({ accountId: account1._id });
  assert.equal(videosDrive1.length, 1);
  assert.equal(videosDrive1[0].cleanTitle, 'Drive 1 Video');

  // Query videos specifically for Account 2
  const videosDrive2 = await Video.find({ accountId: account2._id });
  assert.equal(videosDrive2.length, 1);
  assert.equal(videosDrive2[0].cleanTitle, 'Drive 2 Video');

  // Deleting Account 2 only deletes Account 2 videos
  await Video.deleteMany({
    $or: [{ accountId: account2._id }, { googleEmail: account2.googleEmail }],
  });
  await Account.findByIdAndDelete(account2._id);

  const remainingAfterAcc2Delete = await Video.find({});
  assert.equal(remainingAfterAcc2Delete.length, 1);
  assert.equal(remainingAfterAcc2Delete[0].cleanTitle, 'Drive 1 Video');

  // Cleanup
  await Video.deleteMany({});
  await Account.deleteMany({ platform: 'youtube' });
});

test('HTTP API: GET /api/videos and /stats return empty when no drive is connected, and filter by accountId when connected', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/videos', videoRoutes);
  app.use('/api/accounts', accountRoutes);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. With NO connected accounts, verify /api/videos and /api/videos/stats return 0
    await Account.deleteMany({ platform: 'youtube' });
    await Video.deleteMany({});

    const resEmpty = await fetch(`${baseUrl}/api/videos`);
    assert.equal(resEmpty.status, 200);
    const dataEmpty = await resEmpty.json();
    assert.equal(dataEmpty.data.length, 0);
    assert.equal(dataEmpty.pagination.total, 0);

    const statsEmpty = await (await fetch(`${baseUrl}/api/videos/stats`)).json();
    assert.equal(statsEmpty.data.total, 0);

    // 2. Connect a drive and add videos
    const driveA = await Account.create({
      platform: 'youtube',
      accountId: `yt_http_a_${Date.now()}`,
      accountName: 'HTTP Drive A',
      googleEmail: 'driveA@test.com',
      status: 'connected',
      encryptedAccessToken: 'enc_token_a',
      isDemo: false,
    });

    const driveB = await Account.create({
      platform: 'youtube',
      accountId: `yt_http_b_${Date.now()}`,
      accountName: 'HTTP Drive B',
      googleEmail: 'driveB@test.com',
      status: 'connected',
      encryptedAccessToken: 'enc_token_b',
      isDemo: false,
    });

    await Video.create({
      driveFileId: `file_http_a_${Date.now()}`,
      originalName: 'a_video.mp4',
      cleanTitle: 'A Video',
      mimeType: 'video/mp4',
      accountId: driveA._id,
      googleEmail: driveA.googleEmail,
    });

    await Video.create({
      driveFileId: `file_http_b_${Date.now()}`,
      originalName: 'b_video.mp4',
      cleanTitle: 'B Video',
      mimeType: 'video/mp4',
      accountId: driveB._id,
      googleEmail: driveB.googleEmail,
    });

    // 3. Query all connected drives -> 2 videos
    const resAll = await (await fetch(`${baseUrl}/api/videos`)).json();
    assert.equal(resAll.data.length, 2);

    // 4. Query specifically for Drive A -> 1 video
    const resA = await (await fetch(`${baseUrl}/api/videos?accountId=${driveA._id}`)).json();
    assert.equal(resA.data.length, 1);
    assert.equal(resA.data[0].cleanTitle, 'A Video');

    // 5. Query specifically for Drive B -> 1 video
    const resB = await (await fetch(`${baseUrl}/api/videos?accountId=${driveB._id}`)).json();
    assert.equal(resB.data.length, 1);
    assert.equal(resB.data[0].cleanTitle, 'B Video');

    // 6. Delete Drive A via DELETE /api/accounts/:id
    const delResA = await fetch(`${baseUrl}/api/accounts/${driveA._id}`, { method: 'DELETE' });
    assert.equal(delResA.status, 200);

    // After deleting Drive A, only Drive B videos exist
    const resAfterDelA = await (await fetch(`${baseUrl}/api/videos`)).json();
    assert.equal(resAfterDelA.data.length, 1);
    assert.equal(resAfterDelA.data[0].cleanTitle, 'B Video');

    // 7. Delete Drive B -> no connected drives remain, so all videos purged
    const delResB = await fetch(`${baseUrl}/api/accounts/${driveB._id}`, { method: 'DELETE' });
    assert.equal(delResB.status, 200);

    const resAfterDelAll = await (await fetch(`${baseUrl}/api/videos`)).json();
    assert.equal(resAfterDelAll.data.length, 0);
    assert.equal(resAfterDelAll.pagination.total, 0);

    const statsFinal = await (await fetch(`${baseUrl}/api/videos/stats`)).json();
    assert.equal(statsFinal.data.total, 0);
  } finally {
    server.close();
    await Video.deleteMany({});
    await Account.deleteMany({ platform: 'youtube' });
  }
});
