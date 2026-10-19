import { config } from '../config/env.js';
import { AppError } from './errorHandler.js';

/**
 * Middleware that secures administrative, publishing, and destructive operations
 */
export const requireAdminAuth = (req, res, next) => {
  const configuredKey = config.dashboardApiKey;

  // If a dashboard API key is explicitly configured, enforce it strictly
  if (configuredKey) {
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-api-key'];

    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const providedKey = bearerToken || customHeader;

    if (!providedKey || providedKey !== configuredKey) {
      return next(new AppError('Unauthorized: Valid Dashboard API Key required for this operation', 401));
    }
    return next();
  }

  // If no key is set yet, in production mode block access until configured
  if (config.nodeEnv === 'production') {
    return next(new AppError('Unauthorized: DASHBOARD_API_KEY must be set in production to perform sensitive actions', 401));
  }

  // In development without DASHBOARD_API_KEY, permit local development loopback requests only
  const remoteIp = req.socket?.remoteAddress || '';
  const isLocal =
    remoteIp === '127.0.0.1' ||
    remoteIp === '::1' ||
    remoteIp === '::ffff:127.0.0.1' ||
    req.headers.host?.startsWith('localhost') ||
    req.headers.host?.startsWith('127.0.0.1');

  if (!isLocal) {
    return next(new AppError('Unauthorized: Administrative operations restricted to localhost or authenticated sessions', 401));
  }

  next();
};
