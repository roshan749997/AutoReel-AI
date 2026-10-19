import mongoose from 'mongoose';

const bulkAiJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['idle', 'running', 'completed', 'failed', 'cancelled'],
      default: 'idle',
      index: true,
    },
    totalVideos: {
      type: Number,
      default: 0,
    },
    processedVideos: {
      type: Number,
      default: 0,
    },
    successfulVideos: {
      type: Number,
      default: 0,
    },
    failedVideos: {
      type: Number,
      default: 0,
    },
    language: {
      type: String,
      enum: ['en', 'hi', 'mr'],
      default: 'en',
    },
    provider: {
      type: String,
      default: 'gemini',
    },
    videoIds: {
      type: [String],
      default: [],
    },
    currentVideoTitle: {
      type: String,
      default: '',
    },
    errors: [
      {
        videoId: String,
        title: String,
        error: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
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
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  }
);

bulkAiJobSchema.index({ status: 1, createdAt: -1 });

export const BulkAiJob = mongoose.model('BulkAiJob', bulkAiJobSchema);
