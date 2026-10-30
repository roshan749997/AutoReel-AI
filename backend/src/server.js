import express from 'express';
import { config } from './config/env.js';
import { connectDatabase, closeDatabase } from './config/database.js';
import { configureSecurity } from './middleware/security.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { schedulerService } from './services/schedulerService.js';
import { keepAliveService } from './services/keepAliveService.js';
import { recoverInterruptedTransfers } from './drive-transfer/worker.js';

// Route imports
import healthRoutes from './routes/healthRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import videoRoutes from './routes/videoRoutes.js';
import postRoutes from './routes/postRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import workflowRoutes from './routes/workflowRoutes.js';
import logRoutes from './routes/logRoutes.js';
import driveTransferRoutes from './routes/driveTransferRoutes.js';
import channelRoutes from './routes/channelRoutes.js';

const app = express();

// Security headers and CORS
configureSecurity(app);

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mount API routes
app.use('/api/health', healthRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/drive-transfer', driveTransferRoutes);
app.use('/api/channels', channelRoutes);

// Catch 404s
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

// Server instance & lifecycle
let server = null;

const startServer = async () => {
  // Connect database
  await connectDatabase();

  // Start background post scheduler & 24/7 keep-alive worker
  schedulerService.start();
  keepAliveService.start();
  try {
    await recoverInterruptedTransfers();
  } catch (err) {
    console.error(`[DriveTransfer] Could not resume an interrupted transfer: ${err.message}`);
  }

  server = app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`🚀 AI Video Automation Agent Backend running on port ${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Health Check: http://localhost:${config.port}/api/health`);
    console.log(`====================================================`);
  });
};

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  // Stop background scheduler & keep-alive worker
  schedulerService.stop();
  keepAliveService.stop();

  // Close HTTP server
  if (server) {
    server.close(() => {
      console.log('[Server] HTTP server closed');
    });
  }

  // Close MongoDB connection
  try {
    await closeDatabase();
    console.log('[Server] Graceful shutdown completed cleanly');
    process.exit(0);
  } catch (err) {
    console.error(`[Server] Error during shutdown: ${err.message}`);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.warn('[Server] Unhandled Promise Rejection (suppressed to preserve server uptime):', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
  if (err.code === 'EADDRINUSE') {
    process.exit(1);
  }
});

// Start server
startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
});

export { app };
