import mongoose from 'mongoose';

const syncJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    folderId: {
      type: String,
      default: '',
      index: true,
    },
    folderName: {
      type: String,
      default: 'Google Drive Root',
    },
    status: {
      type: String,
      enum: ['idle', 'running', 'paused', 'completed', 'failed', 'cancelled'],
      default: 'idle',
      index: true,
    },
    pageToken: {
      type: String,
      default: null,
    },
    pagesProcessed: {
      type: Number,
      default: 0,
    },
    totalScanned: {
      type: Number,
      default: 0,
    },
    totalIndexed: {
      type: Number,
      default: 0,
    },
    totalUpdated: {
      type: Number,
      default: 0,
    },
    totalFailed: {
      type: Number,
      default: 0,
    },
    foldersDiscovered: {
      type: [String],
      default: [],
    },
    foldersCompleted: {
      type: [String],
      default: [],
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    lastHeartbeatAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    errorDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastSyncedFile: {
      id: String,
      name: String,
      timestamp: Date,
    },
  },
  {
    timestamps: true,
  }
);

syncJobSchema.index({ status: 1, createdAt: -1 });

export const SyncJob = mongoose.model('SyncJob', syncJobSchema);
