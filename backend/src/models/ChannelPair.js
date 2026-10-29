import mongoose from 'mongoose';

const channelPairSchema = new mongoose.Schema(
  {
    folderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    folderName: {
      type: String,
      default: '',
    },
    youtubeAccountId: {
      type: String,
      default: '',
    },
    instagramAccountId: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

channelPairSchema.index({ youtubeAccountId: 1 });
channelPairSchema.index({ instagramAccountId: 1 });

export const ChannelPair = mongoose.model('ChannelPair', channelPairSchema);
