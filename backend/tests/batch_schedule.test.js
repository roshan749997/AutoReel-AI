import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Video } from '../src/models/Video.js';
import { Account } from '../src/models/Account.js';
import { Post } from '../src/models/Post.js';
import axios from 'axios';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  await closeDatabase();
});

test('Batch Scheduling: Schedules multiple videos with custom channels and staggered times', async () => {
  // Create test fixtures
  const ytAccount = await Account.create({
    platform: 'youtube',
    accountId: `yt_batch_${Date.now()}`,
    accountName: 'Batch YT Test',
    encryptedAccessToken: 'dummy_enc_token',
    status: 'connected',
    isDemo: true,
  });

  const igAccount = await Account.create({
    platform: 'instagram',
    accountId: `ig_batch_${Date.now()}`,
    accountName: 'Batch IG Test',
    encryptedAccessToken: 'dummy_enc_token',
    status: 'connected',
    isDemo: true,
  });

  const video1 = await Video.create({
    driveFileId: `vid_batch_1_${Date.now()}`,
    originalName: 'test_vid_1.mp4',
    cleanTitle: 'Batch Video 1',
    mimeType: 'video/mp4',
    status: 'metadata_ready',
    aiMetadata: {
      youtubeTitle: 'Batch Video 1 Title #Shorts',
      instagramCaption: 'Batch Video 1 Caption #Reels',
      approvalStatus: 'approved',
    },
  });

  const video2 = await Video.create({
    driveFileId: `vid_batch_2_${Date.now()}`,
    originalName: 'test_vid_2.mp4',
    cleanTitle: 'Batch Video 2',
    mimeType: 'video/mp4',
    status: 'metadata_ready',
    aiMetadata: {
      youtubeTitle: 'Batch Video 2 Title #Shorts',
      instagramCaption: 'Batch Video 2 Caption #Reels',
      approvalStatus: 'approved',
    },
  });

  try {
    const time1 = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const time2 = new Date(Date.now() + 4 * 3600 * 1000).toISOString();

    const payload = {
      items: [
        {
          videoId: video1._id.toString(),
          targets: [
            { accountId: ytAccount._id.toString(), platform: 'youtube' },
            { accountId: igAccount._id.toString(), platform: 'instagram' },
          ],
          title: 'Custom Title 1',
          caption: 'Custom Caption 1',
          hashtags: ['#Shorts', '#Reels'],
          scheduledAt: time1,
          timezone: 'Asia/Kolkata',
          allowDuplicate: true,
          autoApprove: true,
        },
        {
          videoId: video2._id.toString(),
          targets: [
            { accountId: ytAccount._id.toString(), platform: 'youtube' },
          ],
          title: 'Custom Title 2',
          caption: 'Custom Caption 2',
          hashtags: ['#Shorts'],
          scheduledAt: time2,
          timezone: 'Asia/Kolkata',
          allowDuplicate: true,
          autoApprove: true,
        },
      ],
    };

    const res = await axios.post('http://localhost:5000/api/posts/batch-schedule', payload);
    assert.equal(res.status, 201);
    assert.equal(res.data.status, 'success');
    assert.equal(res.data.data.totalScheduled, 3); // 2 for video1 + 1 for video2

    const posts = await Post.find({
      videoId: { $in: [video1._id, video2._id] },
    });
    assert.equal(posts.length, 3);

    const vid1Posts = posts.filter((p) => p.videoId.toString() === video1._id.toString());
    assert.equal(vid1Posts.length, 2);
    assert.equal(new Date(vid1Posts[0].scheduledAt).toISOString(), time1);

    const vid2Posts = posts.filter((p) => p.videoId.toString() === video2._id.toString());
    assert.equal(vid2Posts.length, 1);
    assert.equal(new Date(vid2Posts[0].scheduledAt).toISOString(), time2);
  } finally {
    // Cleanup test posts and fixtures
    await Post.deleteMany({ videoId: { $in: [video1._id, video2._id] } });
    await Video.deleteMany({ _id: { $in: [video1._id, video2._id] } });
    await Account.deleteMany({ _id: { $in: [ytAccount._id, igAccount._id] } });
  }
});
