import mongoose from 'mongoose';
import { encrypt, decrypt } from '../services/cryptoService.js';

const accountSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      enum: ['youtube', 'instagram'],
    },
    accountId: {
      type: String,
      required: true,
    },
    accountName: {
      type: String,
      required: true,
    },
    username: {
      type: String,
    },
    profilePictureUrl: {
      type: String,
    },
    // Sensitive OAuth tokens stored strictly encrypted
    encryptedAccessToken: {
      type: String,
      required: true,
    },
    encryptedRefreshToken: {
      type: String,
    },
    tokenExpiresAt: {
      type: Date,
    },
    scopes: [String],
    metadata: {
      subscriberCount: Number,
      videoCount: Number,
      instagramBusinessId: String,
      facebookPageId: String,
      category: String,
    },
    // Per-account default publishing preferences
    settings: {
      defaultTitlePrefix: { type: String, default: '' },
      defaultTitleSuffix: { type: String, default: '' },
      defaultDescriptionPrefix: { type: String, default: '' },
      defaultDescriptionSuffix: { type: String, default: '' },
      defaultTags: { type: [String], default: [] },
      privacyStatus: {
        type: String,
        enum: ['public', 'private', 'unlisted'],
        default: 'public',
      },
      isMadeForKids: { type: Boolean, default: false },
      autoApprove: { type: Boolean, default: false },
      preferredPublishHourUtc: { type: Number, min: 0, max: 23, default: 14 },
    },
    // Per-account publishing stats
    stats: {
      totalScheduled: { type: Number, default: 0 },
      totalPublished: { type: Number, default: 0 },
      totalFailed: { type: Number, default: 0 },
      lastPublishedAt: { type: Date },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSyncedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: [
        'connected',
        'authorization_required',
        'expired',
        'permission_error',
        'error',
        'disconnected',
      ],
      default: 'connected',
    },
    isDemo: {
      type: Boolean,
      default: false,
      index: true,
    },
    googleEmail: {
      type: String,
    },
    errorMessage: String,
  },
  {
    timestamps: true,
  }
);

// Enforce unique provider and account identifier across multi-account records
accountSchema.index({ platform: 1, accountId: 1 }, { unique: true });
accountSchema.index({ platform: 1, status: 1, isActive: 1 });

// Method to set encrypted tokens
accountSchema.methods.setTokens = function (accessToken, refreshToken = null) {
  if (accessToken) {
    this.encryptedAccessToken = encrypt(accessToken);
  }
  if (refreshToken) {
    this.encryptedRefreshToken = encrypt(refreshToken);
  }
};

// Method to get decrypted tokens
accountSchema.methods.getTokens = function () {
  return {
    accessToken: this.encryptedAccessToken ? decrypt(this.encryptedAccessToken) : null,
    refreshToken: this.encryptedRefreshToken ? decrypt(this.encryptedRefreshToken) : null,
  };
};

// Safe representation for frontend (strips secrets)
accountSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  delete obj.encryptedAccessToken;
  delete obj.encryptedRefreshToken;
  return obj;
};

export const Account = mongoose.model('Account', accountSchema);
