import mongoose from 'mongoose';

const workflowLogSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'success'],
      default: 'info',
      index: true,
    },
    module: {
      type: String,
      required: true,
      enum: ['system', 'drive', 'ai', 'youtube', 'instagram', 'n8n', 'scheduler'],
      index: true,
    },
    action: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-expire logs older than 30 days to keep database lean and free
workflowLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

export const WorkflowLog = mongoose.model('WorkflowLog', workflowLogSchema);
