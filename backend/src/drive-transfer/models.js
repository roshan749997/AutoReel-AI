import mongoose from 'mongoose';
import { encrypt, decrypt } from '../services/cryptoService.js';

const credentialSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      default: 'operator',
      unique: true,
    },
    googleEmail: String,
    googleUserId: String,
    encryptedAccessToken: String,
    encryptedRefreshToken: String,
    tokenExpiresAt: Date,
    scopes: [String],
    status: {
      type: String,
      enum: ['connected', 'expired', 'disconnected'],
      default: 'disconnected',
    },
    errorMessage: String,
  },
  { timestamps: true, collection: 'drive_transfer_credentials' }
);

credentialSchema.methods.setTokens = function setTokens(accessToken, refreshToken = null, expiryDate = null) {
  if (accessToken) this.encryptedAccessToken = encrypt(accessToken);
  if (refreshToken) this.encryptedRefreshToken = encrypt(refreshToken);
  if (expiryDate) this.tokenExpiresAt = new Date(expiryDate);
};

credentialSchema.methods.getTokens = function getTokens() {
  return {
    accessToken: this.encryptedAccessToken ? decrypt(this.encryptedAccessToken) : null,
    refreshToken: this.encryptedRefreshToken ? decrypt(this.encryptedRefreshToken) : null,
  };
};

credentialSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    connected: this.status === 'connected',
    status: this.status,
    email: this.googleEmail || null,
    scopes: this.scopes || [],
    errorMessage: this.errorMessage || null,
  };
};

const jobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    mode: { type: String, enum: ['preview', 'copy'], default: 'preview' },
    status: {
      type: String,
      enum: ['queued', 'scanning', 'preview_ready', 'copying', 'completed', 'failed', 'cancelled', 'interrupted'],
      default: 'scanning',
      index: true,
    },
    sourceFolderId: { type: String, required: true },
    sourceFolderName: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },
    destFolderId: { type: String, required: true },
    destFolderName: { type: String, default: '' },
    destUrl: { type: String, default: '' },
    googleEmail: String,
    totalFiles: { type: Number, default: 0 },
    videoCount: { type: Number, default: 0 },
    folderCount: { type: Number, default: 0 },
    completedFiles: { type: Number, default: 0 },
    skippedFiles: { type: Number, default: 0 },
    failedFiles: { type: Number, default: 0 },
    progressPercent: { type: Number, default: 0 },
    parallelCopies: { type: Number, default: 5, min: 1, max: 8 },
    autoCopy: { type: Boolean, default: false },
    batchId: { type: String, default: '' },
    queueOrder: { type: Number, default: 0 },
    scanCursor: { type: mongoose.Schema.Types.Mixed, default: null },
    lastHeartbeatAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    errorCode: String,
    errorMessage: String,
    recentErrors: {
      type: [
        {
          path: String,
          name: String,
          code: String,
          message: String,
          at: Date,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'drive_transfer_jobs' }
);

const itemSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, index: true },
    sourceFileId: { type: String, required: true },
    copyFileId: String,
    parentSourceId: String,
    name: { type: String, required: true },
    relativePath: { type: String, default: '' },
    depth: { type: Number, default: 1 },
    isFolder: { type: Boolean, default: false },
    isVideo: { type: Boolean, default: false },
    mimeType: String,
    size: Number,
    md5Checksum: String,
    plannedAction: {
      type: String,
      enum: ['copy', 'skip_duplicate', 'fail'],
      default: 'copy',
    },
    status: {
      type: String,
      enum: ['preview', 'pending', 'copied', 'skipped', 'failed'],
      default: 'preview',
      index: true,
    },
    destFileId: String,
    existingDestId: String,
    errorCode: String,
    errorMessage: String,
    retryable: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'drive_transfer_items' }
);

itemSchema.index({ jobId: 1, sourceFileId: 1 }, { unique: true });
itemSchema.index({ jobId: 1, isFolder: 1, depth: 1 });

export const DriveTransferCredential = mongoose.model('DriveTransferCredential', credentialSchema);
export const DriveTransferJob = mongoose.model('DriveTransferJob', jobSchema);
export const DriveTransferItem = mongoose.model('DriveTransferItem', itemSchema);
