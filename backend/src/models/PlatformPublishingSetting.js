import mongoose from 'mongoose';

const PLATFORMS = ['youtube', 'instagram'];

const platformPublishingSettingSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      enum: PLATFORMS,
      unique: true,
      index: true,
    },
    publishingEnabled: {
      type: Boolean,
      required: true,
      default: true,
    },
    updatedBy: {
      type: String,
      default: 'system',
      trim: true,
      maxlength: 120,
    },
  },
  {
    timestamps: true,
  }
);

export const PLATFORM_PUBLISHING_PLATFORMS = PLATFORMS;
export const PlatformPublishingSetting = mongoose.model(
  'PlatformPublishingSetting',
  platformPublishingSettingSchema
);
