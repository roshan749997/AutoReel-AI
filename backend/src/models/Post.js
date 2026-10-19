import mongoose from 'mongoose';

const postSchema = new mongoose.Schema(
  {
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    platform: {
      type: String,
      required: true,
      enum: ['youtube', 'instagram'],
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    caption: {
      type: String,
      default: '',
    },
    hashtags: [String],
    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
    publishedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: [
        'draft',
        'scheduled',
        'queued',
        'processing',
        'retrying',
        'published',
        'failed',
        'cancelled',
        'paused',
        'manual_review',
      ],
      default: 'scheduled',
      index: true,
    },
    // Keep scheduling status strictly separate from platform publishing status
    publishingStatus: {
      type: String,
      enum: ['unattempted', 'ready_for_dispatch', 'verified_mock', 'published', 'failed', 'manual_review', 'rejected'],
      default: 'unattempted',
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    publishDetails: {
      externalPostId: String,
      externalUrl: String,
      containerId: String,
      quotaUnitsUsed: Number,
      verifiedAt: Date,
      uploadStatus: String,
      rejectionReason: String,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    nextRetryAt: {
      type: Date,
      index: true,
    },
    claimedAt: {
      type: Date,
    },
    claimedBy: {
      type: String,
    },
    cancelledAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
    },
    requiresConfirmation: {
      type: Boolean,
      default: true,
    },
    lastError: {
      message: String,
      code: String,
      timestamp: Date,
    },
    executionLogs: [
      {
        timestamp: { type: Date, default: Date.now },
        step: String,
        message: String,
        level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

postSchema.index({ status: 1, scheduledAt: 1, nextRetryAt: 1 });
postSchema.index({ videoId: 1, platform: 1, status: 1 });
postSchema.index({ videoId: 1, accountId: 1, status: 1 });
postSchema.index({ accountId: 1, scheduledAt: -1 });

export const Post = mongoose.model('Post', postSchema);
