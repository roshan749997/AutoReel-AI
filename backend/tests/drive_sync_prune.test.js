import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Video } from '../src/models/Video.js';
import { googleDriveService } from '../src/services/googleDriveService.js';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  await closeDatabase();
});

test('Drive sync prune: archives videos missing from completed sync job', async () => {
  const folderId = `folder_prune_${Date.now()}`;
  const jobId = `sync_prune_${Date.now()}`;

  const kept = await Video.create({
    driveFileId: `drive_kept_${Date.now()}`,
    originalName: 'kept.mp4',
    mimeType: 'video/mp4',
    folderId,
    folderName: 'Prune Test',
    syncJobId: jobId,
    isArchived: false,
  });

  const gone = await Video.create({
    driveFileId: `drive_gone_${Date.now()}`,
    originalName: 'deleted_in_drive.mp4',
    mimeType: 'video/mp4',
    folderId,
    folderName: 'Prune Test',
    syncJobId: 'older_sync_job',
    isArchived: false,
  });

  const otherFolder = await Video.create({
    driveFileId: `drive_other_${Date.now()}`,
    originalName: 'other_folder.mp4',
    mimeType: 'video/mp4',
    folderId: `other_${folderId}`,
    folderName: 'Other',
    syncJobId: 'older_sync_job',
    isArchived: false,
  });

  const removed = await googleDriveService.pruneMissingVideosAfterSync({
    jobId,
    folderId,
    foldersCompleted: [folderId],
  });

  assert.equal(removed, 1);

  const keptAfter = await Video.findById(kept._id);
  const goneAfter = await Video.findById(gone._id);
  const otherAfter = await Video.findById(otherFolder._id);

  assert.equal(keptAfter.isArchived, false);
  assert.equal(goneAfter.isArchived, true);
  assert.equal(goneAfter.archiveReason, 'not_found_in_drive_during_sync');
  assert.equal(otherAfter.isArchived, false);

  await Video.deleteMany({ _id: { $in: [kept._id, gone._id, otherFolder._id] } });
});
