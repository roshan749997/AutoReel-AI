import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Post } from '../src/models/Post.js';
import { Video } from '../src/models/Video.js';
import { WorkflowLog } from '../src/models/WorkflowLog.js';

export async function resetPublishingHistory({ dryRun = true } = {}) {
  await connectDatabase();

  const postCount = await Post.countDocuments();
  const logCount = await WorkflowLog.countDocuments();
  const queuedVideosCount = await Video.countDocuments({ status: { $in: ['queued', 'published'] } });
  const totalVideos = await Video.countDocuments();

  console.log(`[Reset History] Current Status:`);
  console.log(`  - Total Posts in Queue/History: ${postCount}`);
  console.log(`  - Total Workflow Logs: ${logCount}`);
  console.log(`  - Videos marked 'queued' or 'published': ${queuedVideosCount}`);
  console.log(`  - Total Videos in Library (will be preserved): ${totalVideos}`);

  if (dryRun) {
    console.log(`\n[DRY RUN] No changes were made. Pass --confirm to execute the cleanup.`);
    await closeDatabase();
    return { postCount, logCount, queuedVideosCount, totalVideos };
  }

  console.log(`\n[CLEANUP] Executing reset...`);

  // 1. Delete all posts
  const postResult = await Post.deleteMany({});
  console.log(`  ✔ Deleted ${postResult.deletedCount} posts from Publishing Queue/History.`);

  // 2. Delete all workflow logs
  const logResult = await WorkflowLog.deleteMany({});
  console.log(`  ✔ Deleted ${logResult.deletedCount} workflow logs.`);

  // 3. Reset video statuses back to metadata_ready (only for videos that were never actually published to social channels)
  const videoResult = await Video.updateMany(
    {
      status: { $in: ['queued', 'published'] },
      $or: [
        { publishedPlatforms: { $exists: false } },
        { publishedPlatforms: { $size: 0 } },
      ],
    },
    [
      {
        $set: {
          status: {
            $cond: {
              if: {
                $or: [
                  { $gt: [{ $strLenCP: { $ifNull: ['$aiMetadata.generatedTitle', ''] } }, 0] },
                  { $gt: [{ $strLenCP: { $ifNull: ['$aiMetadata.youtubeTitle', ''] } }, 0] },
                ],
              },
              then: 'metadata_ready',
              else: 'discovered',
            },
          },
        },
      },
    ]
  );
  console.log(`  ✔ Reset status for ${videoResult.modifiedCount} videos back to 'metadata_ready'.`);

  console.log(`\n✨ Publishing history successfully cleared! All ${totalVideos} videos are ready for fresh scheduling.`);

  await closeDatabase();
  return {
    deletedPosts: postResult.deletedCount,
    deletedLogs: logResult.deletedCount,
    resetVideos: videoResult.modifiedCount,
  };
}

if (process.argv[1] && process.argv[1].endsWith('reset_publishing_history.js')) {
  const isConfirmed = process.argv.includes('--confirm');
  resetPublishingHistory({ dryRun: !isConfirmed })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error during reset:', err);
      process.exit(1);
    });
}

