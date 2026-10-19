import mongoose from 'mongoose';

const videoSchema = new mongoose.Schema(
  {
    driveFileId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      index: true,
    },
    cleanTitle: {
      type: String,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number, // in bytes
      default: 0,
    },
    duration: {
      type: Number, // in seconds
      default: 0,
    },
    resolution: {
      width: Number,
      height: Number,
      isVertical: {
        type: Boolean,
        default: true,
      },
      aspectRatio: String,
    },
    driveCreatedAt: Date,
    driveModifiedAt: Date,
    thumbnailUrl: String,
    driveWebViewLink: String,
    folderId: String,
    folderName: String,
    aiMetadata: {
      generatedTitle: String,
      youtubeTitle: String,
      instagramCaption: String,
      description: String,
      hook: String,
      cta: String,
      hashtags: [String],
      tags: [String],
      category: String,
      language: {
        type: String,
        enum: ['en', 'hi', 'mr'],
        default: 'en',
      },
      provider: String,
      generatedAt: Date,
      approvalStatus: {
        type: String,
        enum: ['draft', 'approved', 'rejected'],
        default: 'draft',
      },
      approvedAt: Date,
      lastEditedAt: Date,
    },
    status: {
      type: String,
      enum: ['discovered', 'metadata_ready', 'queued', 'published', 'archived'],
      default: 'discovered',
      index: true,
    },
    indexingStatus: {
      type: String,
      enum: ['indexed', 'failed', 'skipped'],
      default: 'indexed',
      index: true,
    },
    syncJobId: {
      type: String,
      index: true,
    },
    indexingError: String,
    notes: String,
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

videoSchema.index({ originalName: 'text', cleanTitle: 'text' });
videoSchema.index({ status: 1, driveModifiedAt: -1 });
videoSchema.index({ folderId: 1, driveModifiedAt: -1 });
videoSchema.index({ fileSize: 1 });
videoSchema.index({ 'resolution.isVertical': 1 });

export const Video = mongoose.model('Video', videoSchema);
