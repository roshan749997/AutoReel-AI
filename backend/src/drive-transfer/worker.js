import crypto from 'crypto';
import { AppError } from '../middleware/errorHandler.js';
import { getDriveTransferConfig } from './config.js';
import { parseDriveFolderInput } from './folderId.js';
import {
  decideFileAction,
  findExistingFolder,
  isFolderMime,
  isVideoMime,
  progressPercent,
  assertSafeParent,
} from './planner.js';
import { classifyDriveError } from './errors.js';
import {
  getAuthorizedDrive,
  getFolderMetadata,
  listChildrenPage,
  copyFile,
  createFolder,
} from './driveClient.js';
import { DriveTransferJob, DriveTransferItem } from './models.js';

const ACTIVE_STATUSES = ['scanning', 'copying'];
const PARALLEL_CHOICES = [1, 3, 5, 8];

export function clampParallelCopies(value) {
  const count = Number(value);
  return PARALLEL_CHOICES.includes(count) ? count : 5;
}
const runningJobs = new Set();
const STALE_MS = 120000;

export function isDriveTransferRunning(jobId) {
  return runningJobs.has(jobId);
}

export async function validateTransferRequest({ sourceUrl, destinationUrl }) {
  const source = parseDriveFolderInput(sourceUrl);
  if (!source.ok) throw new AppError(source.message, 400, { code: source.code });
  const destination = parseDriveFolderInput(destinationUrl);
  if (!destination.ok) throw new AppError(destination.message, 400, { code: destination.code });
  if (source.folderId === destination.folderId) {
    throw new AppError('Source and destination are the same folder. Nothing was copied.', 400, { code: 'SAME_FOLDER' });
  }

  const { drive, credential } = await getAuthorizedDrive();
  const sourceMeta = await resolveFolder(drive, source.folderId, 'Source');
  const destMeta = await resolveFolder(drive, destination.folderId, 'Destination');
  await assertDestinationOutsideSource(drive, sourceMeta.id, destMeta.id);

  if (sourceMeta.capabilities && sourceMeta.capabilities.canListChildren === false) {
    throw new AppError(
      `The connected account cannot list "${sourceMeta.name}". Share the source folder with read access.`,
      403,
      { code: 'PERMISSION' }
    );
  }
  if (destMeta.capabilities && destMeta.capabilities.canAddChildren === false) {
    throw new AppError(
      `The connected account cannot add files to "${destMeta.name}". Share the destination folder with edit access.`,
      403,
      { code: 'PERMISSION' }
    );
  }

  return {
    googleEmail: credential.googleEmail || null,
    source: publicFolder(sourceMeta),
    destination: publicFolder(destMeta),
  };
}

export async function startPreview({ sourceUrl, destinationUrl }) {
  await assertNoActiveJob();
  const checked = await validateTransferRequest({ sourceUrl, destinationUrl });
  const job = await DriveTransferJob.create({
    jobId: crypto.randomUUID(),
    mode: 'preview',
    status: 'scanning',
    sourceFolderId: checked.source.id,
    sourceFolderName: checked.source.name,
    sourceUrl: sourceUrl || '',
    destFolderId: checked.destination.id,
    destFolderName: checked.destination.name,
    destUrl: destinationUrl || '',
    googleEmail: checked.googleEmail,
    lastHeartbeatAt: new Date(),
  });
  enqueue(job.jobId);
  return serializeJob(job);
}

export async function queueFolderCopies({ pairs, parallelCopies }) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new AppError('Add at least one source folder and one destination folder.', 400);
  }
  if (pairs.length > 10) {
    throw new AppError('Queue up to 10 folders at a time.', 400);
  }

  const width = clampParallelCopies(parallelCopies);
  const batchId = crypto.randomUUID();
  const jobs = [];
  const errors = [];
  const seen = new Set();
  let order = Date.now();

  for (let index = 0; index < pairs.length; index += 1) {
    const sourceUrl = pairs[index]?.sourceUrl || '';
    const destinationUrl = pairs[index]?.destinationUrl || '';
    try {
      const source = parseDriveFolderInput(sourceUrl);
      const destination = parseDriveFolderInput(destinationUrl);
      if (source.ok && destination.ok) {
        const key = `${source.folderId}>${destination.folderId}`;
        if (seen.has(key)) {
          throw new AppError('That source and destination pair is already in this list.', 400, { code: 'SAME_FOLDER' });
        }
        seen.add(key);
      }
      const checked = await validateTransferRequest({ sourceUrl, destinationUrl });
      const job = await DriveTransferJob.create({
        jobId: crypto.randomUUID(),
        mode: 'preview',
        status: 'queued',
        autoCopy: true,
        batchId,
        queueOrder: order,
        parallelCopies: width,
        sourceFolderId: checked.source.id,
        sourceFolderName: checked.source.name,
        sourceUrl,
        destFolderId: checked.destination.id,
        destFolderName: checked.destination.name,
        destUrl: destinationUrl,
        googleEmail: checked.googleEmail,
        lastHeartbeatAt: new Date(),
      });
      order += 1;
      jobs.push(serializeJob(job));
    } catch (err) {
      errors.push({
        index,
        message: `Folder ${index + 1}: ${err.message || 'Could not queue this folder.'}`,
      });
    }
  }

  if (!jobs.length) {
    throw new AppError(errors[0]?.message || 'None of the folders could be queued.', 400);
  }

  const started = await startNextQueued();
  return { jobs, errors, started: Boolean(started) };
}

export async function cancelQueuedJobs() {
  const waiting = await DriveTransferJob.find({ status: 'queued' }).select('jobId');
  await DriveTransferJob.updateMany(
    { status: 'queued' },
    {
      $set: {
        status: 'cancelled',
        finishedAt: new Date(),
        errorMessage: 'Removed from the waiting list before copying. Source files were not changed.',
      },
    }
  );
  return { cancelled: waiting.length };
}

export async function startNextQueued() {
  if (runningJobs.size > 0) return null;
  const active = await DriveTransferJob.findOne({ status: { $in: ACTIVE_STATUSES } }).select('jobId');
  if (active) return null;
  const next = await DriveTransferJob.findOne({ status: 'queued' }).sort({ queueOrder: 1, createdAt: 1 });
  if (!next) return null;
  next.status = 'scanning';
  next.mode = 'preview';
  next.errorCode = null;
  next.errorMessage = null;
  next.finishedAt = null;
  next.startedAt = new Date();
  next.lastHeartbeatAt = new Date();
  await next.save();
  enqueue(next.jobId);
  console.log(`[DriveTransfer] Started queued folder ${next.sourceFolderName || next.jobId}`);
  return serializeJob(next);
}

export async function startCopy(jobId, parallelCopies) {
  const job = await DriveTransferJob.findOne({ jobId });
  if (!job) throw new AppError('Transfer job not found', 404);
  if (job.status === 'scanning' || job.status === 'copying') {
    throw new AppError('This transfer is already running.', 409);
  }
  if (job.status !== 'preview_ready' && !(job.mode === 'copy' && job.status === 'interrupted')) {
    throw new AppError('Run a dry-run preview before copying.', 400, { code: 'PREVIEW_REQUIRED' });
  }
  await assertNoActiveJob(job.jobId);
  job.mode = 'copy';
  job.status = 'copying';
  job.parallelCopies = clampParallelCopies(parallelCopies ?? job.parallelCopies);
  job.errorCode = null;
  job.errorMessage = null;
  job.finishedAt = null;
  job.lastHeartbeatAt = new Date();
  await job.save();
  enqueue(job.jobId);
  return serializeJob(job);
}

export async function resumeJob(jobId, parallelCopies) {
  const job = await DriveTransferJob.findOne({ jobId });
  if (!job) throw new AppError('Transfer job not found', 404);
  if (job.status === 'cancelled') {
    throw new AppError('This transfer was cancelled. Start a new preview to copy again.', 400);
  }
  if (ACTIVE_STATUSES.includes(job.status) && runningJobs.has(jobId)) {
    return serializeJob(job);
  }
  if (!['interrupted', 'failed', 'scanning', 'copying'].includes(job.status)) {
    throw new AppError('This transfer is not waiting to resume.', 400);
  }
  await assertNoActiveJob(job.jobId);
  if (parallelCopies != null) job.parallelCopies = clampParallelCopies(parallelCopies);
  job.status = job.mode === 'copy' ? 'copying' : 'scanning';
  job.errorCode = null;
  job.errorMessage = null;
  job.finishedAt = null;
  job.lastHeartbeatAt = new Date();
  await job.save();
  enqueue(job.jobId);
  return serializeJob(job);
}

export async function setParallelCopies(jobId, parallelCopies) {
  const job = await DriveTransferJob.findOne({ jobId });
  if (!job) throw new AppError('Transfer job not found', 404);
  job.parallelCopies = clampParallelCopies(parallelCopies);
  await job.save();
  return serializeJob(job);
}

export async function retryFailed(jobId, parallelCopies) {
  const job = await DriveTransferJob.findOne({ jobId });
  if (!job) throw new AppError('Transfer job not found', 404);
  if (job.mode !== 'copy' && job.status !== 'preview_ready') {
    throw new AppError('Retry is available after a preview has been copied.', 400);
  }
  await DriveTransferItem.updateMany(
    { jobId, status: 'failed' },
    { $set: { status: 'pending', plannedAction: 'copy', errorCode: null, errorMessage: null, retryable: true } }
  );
  job.mode = 'copy';
  job.status = 'copying';
  if (parallelCopies != null) job.parallelCopies = clampParallelCopies(parallelCopies);
  job.errorCode = null;
  job.errorMessage = null;
  job.finishedAt = null;
  job.lastHeartbeatAt = new Date();
  await job.save();
  enqueue(job.jobId);
  return serializeJob(job);
}

export async function cancelJob(jobId) {
  const job = await DriveTransferJob.findOne({ jobId });
  if (!job) throw new AppError('Transfer job not found', 404);
  if (['completed', 'cancelled'].includes(job.status)) return serializeJob(job);
  job.status = 'cancelled';
  job.finishedAt = new Date();
  job.errorMessage = 'Cancelled. Files already copied were left in the destination. Source files were not changed.';
  await job.save();
  return serializeJob(job);
}

export async function getJob(jobId) {
  const job = await DriveTransferJob.findOne({ jobId });
  if (!job) throw new AppError('Transfer job not found', 404);
  await markStale(job);
  return serializeJob(job);
}

export async function listJobs() {
  const jobs = await DriveTransferJob.find().sort({ createdAt: -1 }).limit(20);
  for (const job of jobs) {
    await markStale(job);
  }
  return jobs.map(serializeJob);
}

export async function listFailures(jobId) {
  const items = await DriveTransferItem.find({ jobId, status: 'failed' })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  return items.map((item) => ({
    name: item.name,
    path: item.relativePath,
    code: item.errorCode || 'DRIVE_ERROR',
    message: item.errorMessage || 'Failed',
    isFolder: item.isFolder,
    retryable: Boolean(item.retryable),
  }));
}

function enqueue(jobId) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  const beat = setInterval(() => {
    DriveTransferJob.updateOne({ jobId }, { $set: { lastHeartbeatAt: new Date() } }).catch(() => {});
  }, 15000);

  processJob(jobId)
    .catch((err) => {
      console.error(`[DriveTransfer] Job ${jobId} failed: ${err.message}`);
    })
    .finally(async () => {
      clearInterval(beat);
      runningJobs.delete(jobId);
      try {
        await startNextQueued();
      } catch (err) {
        console.error(`[DriveTransfer] Could not start the next folder: ${err.message}`);
      }
    });
}

async function processJob(jobId) {
  const job = await DriveTransferJob.findOne({ jobId });
  if (!job || job.status === 'cancelled') return;

  try {
    const { drive } = await getAuthorizedDrive();
    if (job.mode === 'preview') {
      const outcome = await scan(job, drive);
      if (outcome === 'cancelled') return;
      await refreshCounts(job);
      const fresh = await DriveTransferJob.findOne({ jobId: job.jobId }).select('status autoCopy');
      if (!fresh || fresh.status === 'cancelled') return;
      if (!fresh.autoCopy) {
        job.status = 'preview_ready';
        job.progressPercent = 0;
        job.finishedAt = new Date();
        job.scanCursor = null;
        await job.save();
        return;
      }
      job.mode = 'copy';
      job.status = 'copying';
      job.finishedAt = null;
      job.scanCursor = null;
      job.lastHeartbeatAt = new Date();
      await job.save();
    }

    await resolveFolder(drive, job.sourceFolderId, 'Source');
    await resolveFolder(drive, job.destFolderId, 'Destination');
    const outcome = await copyTree(job, drive);
    if (outcome === 'cancelled') return;
    await refreshCounts(job);
    job.status = 'completed';
    job.progressPercent = progressPercent({
      completed: job.completedFiles,
      skipped: job.skippedFiles,
      failed: job.failedFiles,
      total: job.totalFiles,
      copying: true,
    });
    if (!job.totalFiles) job.progressPercent = 100;
    job.finishedAt = new Date();
    await job.save();
  } catch (err) {
    const current = await DriveTransferJob.findOne({ jobId });
    if (!current || current.status === 'cancelled') return;
    const classified = err.classified || classifyDriveError(err);
    current.status = 'failed';
    current.errorCode = classified.code || err.code || 'DRIVE_ERROR';
    current.errorMessage = classified.message || err.message;
    current.finishedAt = new Date();
    await current.save();
  }
}

async function scan(job, drive) {
  const maxFiles = getDriveTransferConfig().maxFiles;
  const destCache = new Map();
  let stack = Array.isArray(job.scanCursor?.stack) && job.scanCursor.stack.length
    ? job.scanCursor.stack
    : [{
      sourceId: job.sourceFolderId,
      destParentId: job.destFolderId,
      path: '',
      depth: 0,
      pageToken: null,
      pendingChildren: [],
    }];
  const visited = new Set(job.scanCursor?.visited || []);

  while (stack.length) {
    if (await isCancelled(job.jobId)) return 'cancelled';
    const frame = stack[stack.length - 1];
    if (frame.depth > 0 && visited.has(frame.sourceId)) {
      stack.pop();
      continue;
    }

    let page;
    try {
      page = await listChildrenPage(drive, frame.sourceId, frame.pageToken);
    } catch (err) {
      if (frame.depth === 0) throw err;
      const classified = err.classified || classifyDriveError(err);
      await DriveTransferItem.updateOne(
        { jobId: job.jobId, sourceFileId: frame.sourceId },
        {
          $set: {
            status: 'failed',
            plannedAction: 'fail',
            errorCode: classified.code,
            errorMessage: classified.message,
            retryable: Boolean(classified.retryable),
          },
        }
      );
      pushRecent(job, {
        name: frame.path || frame.sourceId,
        relativePath: frame.path,
        errorCode: classified.code,
        errorMessage: classified.message,
        status: 'failed',
      });
      const children = frame.pendingChildren || [];
      stack.pop();
      visited.add(frame.sourceId);
      for (const child of children) {
        if (!visited.has(child.sourceId)) stack.push(child);
      }
      job.scanCursor = { stack, visited: [...visited] };
      job.markModified('scanCursor');
      await job.save();
      continue;
    }

    let destEntries = [];
    if (frame.destParentId) {
      destEntries = await listAllChildren(drive, frame.destParentId, destCache);
    }

    const batch = [];
    frame.pendingChildren = frame.pendingChildren || [];

    for (const raw of page.files) {
      const unwrapped = unwrapShortcut(raw);
      if (unwrapped.error) {
        batch.push(fileShell(job, frame, raw, {
          action: 'fail',
          code: unwrapped.error.code,
          message: unwrapped.error.message,
        }));
        continue;
      }

      const file = unwrapped.file;
      if (file.id === job.destFolderId || file.id === job.sourceFolderId) {
        continue;
      }

      const relativePath = frame.path ? `${frame.path}/${file.name}` : file.name;
      if (isFolderMime(file.mimeType)) {
        if (visited.has(file.id) || stack.some((entry) => entry.sourceId === file.id)) {
          batch.push(fileShell(job, frame, file, {
            action: 'fail',
            code: 'INACCESSIBLE',
            message: `Folder "${file.name}" is a shortcut cycle and was not copied.`,
            isFolder: true,
            relativePath,
            depth: frame.depth + 1,
          }));
          continue;
        }
        const existing = frame.destParentId ? findExistingFolder(file.name, destEntries) : null;
        batch.push({
          jobId: job.jobId,
          sourceFileId: file.id,
          parentSourceId: frame.sourceId,
          name: file.name,
          relativePath,
          depth: frame.depth + 1,
          isFolder: true,
          isVideo: false,
          mimeType: file.mimeType,
          plannedAction: existing ? 'skip_duplicate' : 'copy',
          status: existing ? 'skipped' : 'preview',
          existingDestId: existing?.id,
          destFileId: existing?.id,
        });
        frame.pendingChildren.push({
          sourceId: file.id,
          destParentId: existing?.id || null,
          path: relativePath,
          depth: frame.depth + 1,
          pageToken: null,
          pendingChildren: [],
        });
        continue;
      }

      let decision = frame.destParentId
        ? decideFileAction({
          name: file.name,
          size: file.size,
          md5: file.md5Checksum,
          mimeType: file.mimeType,
          destEntries,
        })
        : { action: 'copy' };

      if (file.capabilities && file.capabilities.canCopy === false) {
        decision = {
          action: 'fail',
          code: 'PERMISSION',
          message: `You can see "${file.name}" but Google Drive will not allow a copy. It was left in the source.`,
        };
      }

      batch.push(fileShell(job, frame, file, { ...decision, relativePath, depth: frame.depth + 1 }));
    }

    await insertItems(batch);

    if (page.nextPageToken) {
      frame.pageToken = page.nextPageToken;
    } else {
      const children = frame.pendingChildren || [];
      const finishedId = frame.sourceId;
      stack.pop();
      visited.add(finishedId);
      for (const child of children) {
        if (!visited.has(child.sourceId)) stack.push(child);
      }
    }

    const fileCount = await DriveTransferItem.countDocuments({ jobId: job.jobId, isFolder: false });
    if (fileCount > maxFiles) {
      throw Object.assign(new Error(
        `This folder has more than ${maxFiles} files. Raise DRIVE_TRANSFER_MAX_FILES to continue. Nothing in the source was changed.`
      ), { classified: { code: 'QUOTA', message: `File count exceeded the Drive Transfer limit of ${maxFiles}.` } });
    }

    job.scanCursor = { stack, visited: [...visited] };
    job.lastHeartbeatAt = new Date();
    job.markModified('scanCursor');
    await refreshCounts(job);
    await job.save();
  }

  return 'done';
}

async function copyTree(job, drive) {
  const allowed = new Set([job.destFolderId]);
  const destCache = new Map();

  const folders = await DriveTransferItem.find({ jobId: job.jobId, isFolder: true }).sort({ depth: 1, relativePath: 1 });
  for (const folder of folders) {
    if (await isCancelled(job.jobId)) return 'cancelled';
    if (folder.destFileId && (folder.status === 'copied' || folder.status === 'skipped')) {
      allowed.add(folder.destFileId);
      continue;
    }
    if (folder.plannedAction === 'fail' && folder.status === 'failed') continue;

    const parentDest = await resolveParentDest(job, folder);
    if (!parentDest) {
      await markItemFailed(job, folder, {
        code: 'PERMISSION',
        message: `Could not create "${folder.name}" because its destination parent was not available.`,
        retryable: true,
      });
      continue;
    }

    try {
      const siblings = await listAllChildren(drive, parentDest, destCache);
      const existing = findExistingFolder(folder.name, siblings);
      if (existing) {
        folder.destFileId = existing.id;
        folder.existingDestId = existing.id;
        folder.status = 'skipped';
        folder.plannedAction = 'skip_duplicate';
        allowed.add(existing.id);
        await folder.save();
        continue;
      }
      assertSafeParent(parentDest, allowed);
      const created = await createFolder(drive, {
        name: folder.name,
        parentId: parentDest,
        allowedParentIds: allowed,
      });
      folder.destFileId = created.id;
      folder.status = 'copied';
      allowed.add(created.id);
      const cached = destCache.get(parentDest) || [];
      cached.push({ id: created.id, name: folder.name, mimeType: 'application/vnd.google-apps.folder' });
      destCache.set(parentDest, cached);
      await folder.save();
    } catch (err) {
      if (err.code === 'UNSAFE_PARENT') throw err;
      const classified = err.classified || classifyDriveError(err);
      await markItemFailed(job, folder, classified);
    }
  }

  const parentLocks = new Map();
  while (true) {
    if (await isCancelled(job.jobId)) return 'cancelled';
    const fresh = await DriveTransferJob.findOne({ jobId: job.jobId }).select('parallelCopies status');
    if (!fresh || fresh.status === 'cancelled') return 'cancelled';
    const width = clampParallelCopies(fresh.parallelCopies);
    job.parallelCopies = width;

    const batch = await DriveTransferItem.find({
      jobId: job.jobId,
      isFolder: false,
      status: { $in: ['preview', 'pending'] },
    }).limit(width);
    if (!batch.length) return 'done';

    await Promise.all(batch.map((item) => copyOneFile(job, drive, item, allowed, destCache, parentLocks)));
    const still = await DriveTransferJob.findOne({ jobId: job.jobId }).select('status mode parallelCopies');
    if (!still || still.status === 'cancelled') return 'cancelled';
    job.status = still.status;
    job.mode = still.mode;
    job.parallelCopies = clampParallelCopies(still.parallelCopies);
    await refreshCounts(job);
    await DriveTransferJob.updateOne(
      { jobId: job.jobId, status: { $ne: 'cancelled' } },
      {
        $set: {
          folderCount: job.folderCount,
          totalFiles: job.totalFiles,
          videoCount: job.videoCount,
          completedFiles: job.completedFiles,
          skippedFiles: job.skippedFiles,
          failedFiles: job.failedFiles,
          progressPercent: job.progressPercent,
          lastHeartbeatAt: new Date(),
        },
      }
    );
  }
}

async function copyOneFile(job, drive, item, allowed, destCache, parentLocks) {
  if (item.plannedAction === 'skip_duplicate') {
    item.status = 'skipped';
    await item.save();
    return;
  }
  if (item.plannedAction === 'fail') {
    item.status = 'failed';
    item.retryable = item.retryable !== false;
    await item.save();
    return;
  }

  const parentDest = await resolveParentDest(job, item);
  if (!parentDest) {
    await markItemFailed(job, item, {
      code: 'PERMISSION',
      message: `Could not copy "${item.name}" because its destination folder was not created.`,
      retryable: true,
    });
    return;
  }

  const reservationId = `pending:${item.sourceFileId}`;
  let decision;
  try {
    decision = await withParentLock(parentLocks, parentDest, async () => {
      const siblings = await listAllChildren(drive, parentDest, destCache);
      const next = decideFileAction({
        name: item.name,
        size: item.size,
        md5: item.md5Checksum,
        mimeType: item.mimeType,
        destEntries: siblings,
      });
      if (next.action === 'copy') {
        siblings.push({
          id: reservationId,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
          md5Checksum: item.md5Checksum,
        });
      }
      return next;
    });
  } catch (err) {
    if (err.code === 'UNSAFE_PARENT') throw err;
    const classified = err.classified || classifyDriveError(err);
    await markItemFailed(job, item, classified);
    return;
  }

  if (decision.action !== 'copy') {
    item.status = decision.action === 'skip_duplicate' ? 'skipped' : 'failed';
    item.plannedAction = decision.action;
    item.errorCode = decision.code || null;
    item.errorMessage = decision.message || null;
    item.retryable = decision.action === 'fail';
    await item.save();
    if (item.status === 'failed') pushRecent(job, item);
    return;
  }

  try {
    assertSafeParent(parentDest, allowed);
    const copied = await copyFile(drive, {
      fileId: item.copyFileId || item.sourceFileId,
      name: item.name,
      parentId: parentDest,
      allowedParentIds: allowed,
    });
    item.destFileId = copied.id;
    item.status = 'copied';
    item.errorCode = null;
    item.errorMessage = null;
    const siblings = destCache.get(parentDest) || [];
    const reserved = siblings.find((entry) => entry.id === reservationId);
    if (reserved) reserved.id = copied.id;
    await item.save();
  } catch (err) {
    const siblings = destCache.get(parentDest) || [];
    const index = siblings.findIndex((entry) => entry.id === reservationId);
    if (index >= 0) siblings.splice(index, 1);
    if (err.code === 'UNSAFE_PARENT') throw err;
    const classified = err.classified || classifyDriveError(err);
    await markItemFailed(job, item, classified);
  }
}

function withParentLock(locks, key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

async function resolveParentDest(job, item) {
  if (!item.parentSourceId || item.parentSourceId === job.sourceFolderId) {
    return job.destFolderId;
  }
  const parent = await DriveTransferItem.findOne({
    jobId: job.jobId,
    sourceFileId: item.parentSourceId,
    isFolder: true,
  });
  return parent?.destFileId || null;
}

async function listAllChildren(drive, folderId, cache) {
  if (cache.has(folderId)) return cache.get(folderId);
  const all = [];
  let pageToken = null;
  do {
    const page = await listChildrenPage(drive, folderId, pageToken);
    all.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  cache.set(folderId, all);
  return all;
}

async function resolveFolder(drive, folderId, label) {
  let meta;
  try {
    meta = await getFolderMetadata(drive, folderId);
  } catch (err) {
    const classified = err.classified || classifyDriveError(err);
    throw new AppError(`${label} folder: ${classified.message}`, classified.code === 'PERMISSION' ? 403 : 400, { code: classified.code });
  }

  if (meta.mimeType === 'application/vnd.google-apps.shortcut' && meta.shortcutDetails?.targetId) {
    return resolveFolder(drive, meta.shortcutDetails.targetId, label);
  }
  if (meta.trashed) {
    throw new AppError(`${label} folder is in the trash.`, 400, { code: 'INACCESSIBLE' });
  }
  if (!isFolderMime(meta.mimeType)) {
    throw new AppError(`${label} link is not a folder.`, 400, { code: 'NOT_A_FOLDER' });
  }
  return meta;
}

async function assertDestinationOutsideSource(drive, sourceId, destId) {
  let current = destId;
  const seen = new Set();
  for (let depth = 0; current && depth < 40; depth += 1) {
    if (current === sourceId) {
      throw new AppError(
        'Destination folder is inside the source folder. Choose a destination outside that tree. Nothing was copied.',
        400,
        { code: 'DEST_INSIDE_SOURCE' }
      );
    }
    if (seen.has(current) || current === 'root') return;
    seen.add(current);
    const meta = await getFolderMetadata(drive, current);
    current = Array.isArray(meta.parents) ? meta.parents[0] : null;
  }
}

function publicFolder(meta) {
  return {
    id: meta.id,
    name: meta.name || meta.id,
    canRead: meta.capabilities?.canListChildren !== false,
    canWrite: meta.capabilities?.canAddChildren !== false,
  };
}

function unwrapShortcut(raw) {
  if (raw.mimeType !== 'application/vnd.google-apps.shortcut') return { file: raw };
  const targetId = raw.shortcutDetails?.targetId;
  const targetMime = raw.shortcutDetails?.targetMimeType;
  if (!targetId || !targetMime) {
    return {
      error: {
        code: 'UNSUPPORTED_COPY',
        message: `Shortcut "${raw.name}" has no accessible target.`,
      },
    };
  }
  return {
    file: {
      ...raw,
      id: targetId,
      mimeType: targetMime,
    },
  };
}

function fileShell(job, frame, file, decision) {
  const failed = decision.action === 'fail';
  const skipped = decision.action === 'skip_duplicate';
  return {
    jobId: job.jobId,
    sourceFileId: file.id,
    copyFileId: file.id,
    parentSourceId: frame.sourceId,
    name: file.name,
    relativePath: decision.relativePath || file.name,
    depth: decision.depth || frame.depth + 1,
    isFolder: Boolean(decision.isFolder),
    isVideo: isVideoMime(file.mimeType),
    mimeType: file.mimeType,
    size: file.size != null ? Number(file.size) : undefined,
    md5Checksum: file.md5Checksum,
    plannedAction: decision.action === 'skip_duplicate' ? 'skip_duplicate' : (failed ? 'fail' : 'copy'),
    status: skipped ? 'skipped' : (failed ? 'failed' : 'preview'),
    errorCode: decision.code || null,
    errorMessage: decision.message || null,
    retryable: failed,
  };
}

async function insertItems(batch) {
  if (!batch.length) return;
  try {
    await DriveTransferItem.insertMany(batch, { ordered: false });
  } catch (err) {
    const writeErrors = err?.writeErrors || err?.result?.result?.writeErrors || [];
    const unexpected = writeErrors.filter((entry) => entry.code !== 11000 && entry.err?.code !== 11000);
    if (err?.code === 11000 || (writeErrors.length && unexpected.length === 0)) return;
    throw err;
  }
}

async function markItemFailed(job, item, classified) {
  item.status = 'failed';
  item.errorCode = classified.code || 'DRIVE_ERROR';
  item.errorMessage = classified.message || 'Copy failed';
  item.retryable = Boolean(classified.retryable);
  await item.save();
  pushRecent(job, item);
}

function pushRecent(job, item) {
  if (!item.errorMessage && item.status !== 'failed') return;
  const entry = {
    path: item.relativePath || item.name,
    name: item.name,
    code: item.errorCode || 'DRIVE_ERROR',
    message: item.errorMessage || 'Failed',
    at: new Date(),
  };
  job.recentErrors = [...(job.recentErrors || []), entry].slice(-40);
  job.markModified('recentErrors');
}

async function refreshCounts(job) {
  const [row] = await DriveTransferItem.aggregate([
    { $match: { jobId: job.jobId } },
    {
      $group: {
        _id: null,
        folders: { $sum: { $cond: ['$isFolder', 1, 0] } },
        files: { $sum: { $cond: ['$isFolder', 0, 1] } },
        videos: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$isFolder', false] }, { $eq: ['$isVideo', true] }] }, 1, 0],
          },
        },
        completed: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$isFolder', false] }, { $eq: ['$status', 'copied'] }] }, 1, 0],
          },
        },
        skipped: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$isFolder', false] }, { $eq: ['$status', 'skipped'] }] }, 1, 0],
          },
        },
        failed: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$isFolder', false] }, { $eq: ['$status', 'failed'] }] }, 1, 0],
          },
        },
      },
    },
  ]);
  const counts = row || {};
  job.folderCount = counts.folders || 0;
  job.totalFiles = counts.files || 0;
  job.videoCount = counts.videos || 0;
  job.completedFiles = counts.completed || 0;
  job.skippedFiles = counts.skipped || 0;
  job.failedFiles = counts.failed || 0;
  job.progressPercent = progressPercent({
    completed: job.completedFiles,
    skipped: job.skippedFiles,
    failed: job.failedFiles,
    total: job.totalFiles,
    copying: job.mode === 'copy',
  });
}

async function isCancelled(jobId) {
  const job = await DriveTransferJob.findOne({ jobId }).select('status');
  return !job || job.status === 'cancelled';
}

export async function recoverInterruptedTransfers() {
  const stuck = await DriveTransferJob.find({ status: { $in: ACTIVE_STATUSES } });
  for (const job of stuck) {
    if (runningJobs.has(job.jobId)) continue;
    if (!job.parallelCopies) job.parallelCopies = 5;
    job.status = job.mode === 'preview' ? 'scanning' : 'copying';
    job.errorCode = null;
    job.errorMessage = null;
    job.finishedAt = null;
    job.lastHeartbeatAt = new Date();
    await job.save();
    enqueue(job.jobId);
    console.log(`[DriveTransfer] Resumed ${job.mode} ${job.jobId} with ${job.parallelCopies} copies at a time`);
  }
}

async function assertNoActiveJob(exceptId = null) {
  const active = await DriveTransferJob.findOne({
    status: { $in: ACTIVE_STATUSES },
    ...(exceptId ? { jobId: { $ne: exceptId } } : {}),
  });
  if (active && runningJobs.has(active.jobId)) {
    throw new AppError('Another Drive Transfer is still running. Wait for it to finish or cancel it.', 409);
  }
}

async function markStale(job) {
  if (!ACTIVE_STATUSES.includes(job.status)) return;
  if (runningJobs.has(job.jobId)) return;
  const beat = job.lastHeartbeatAt ? new Date(job.lastHeartbeatAt).getTime() : 0;
  if (Date.now() - beat > STALE_MS) {
    job.status = 'interrupted';
    job.errorMessage = 'Transfer stopped with the server. Resume to continue. Source files were not changed.';
    await job.save();
  }
}

export function serializeJob(job) {
  return {
    jobId: job.jobId,
    mode: job.mode,
    status: job.status,
    sourceFolderId: job.sourceFolderId,
    sourceFolderName: job.sourceFolderName,
    destinationFolderId: job.destFolderId,
    destinationFolderName: job.destFolderName,
    googleEmail: job.googleEmail || null,
    totalFiles: job.totalFiles || 0,
    videoCount: job.videoCount || 0,
    folderCount: job.folderCount || 0,
    completedFiles: job.completedFiles || 0,
    skippedFiles: job.skippedFiles || 0,
    failedFiles: job.failedFiles || 0,
    progressPercent: job.progressPercent || 0,
    parallelCopies: clampParallelCopies(job.parallelCopies),
    autoCopy: Boolean(job.autoCopy),
    batchId: job.batchId || '',
    queueOrder: job.queueOrder || 0,
    errorCode: job.errorCode || null,
    errorMessage: job.errorMessage || null,
    recentErrors: (job.recentErrors || []).slice(-20),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  };
}
