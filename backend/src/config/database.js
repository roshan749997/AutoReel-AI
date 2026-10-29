import mongoose from 'mongoose';
import { config } from './env.js';

let isConnected = false;
let connectionError = null;
let isConnecting = false;
let reconnectTimer = null;

const scheduleReconnect = (delayMs = 3000) => {
  if (reconnectTimer || isConnecting || mongoose.connection.readyState === 1) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (mongoose.connection.readyState !== 1) {
      console.log('[Database] Attempting MongoDB reconnection...');
      await connectDatabase().catch(() => {});
      if (mongoose.connection.readyState !== 1) {
        scheduleReconnect(Math.min(delayMs * 1.5, 15000));
      }
    }
  }, delayMs);
};

export const connectDatabase = async () => {
  if (!config.mongoUri) {
    connectionError = 'MONGODB_URI is not defined in environment';
    console.warn(`[Database] Warning: ${connectionError}`);
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return true;
  }

  if (isConnecting) return false;
  isConnecting = true;

  try {
    mongoose.set('strictQuery', true);
    mongoose.set('bufferTimeoutMS', 15000);

    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
      maxPoolSize: 50,
      minPoolSize: 5,
    });

    isConnected = true;
    connectionError = null;
    console.log('[Database] MongoDB connection established successfully');
    return true;
  } catch (err) {
    isConnected = false;
    connectionError = err.message;
    console.error(`[Database] Failed to connect to MongoDB: ${err.message}`);
    scheduleReconnect(5000);
    return false;
  } finally {
    isConnecting = false;
  }
};

mongoose.connection.on('error', (err) => {
  isConnected = false;
  connectionError = err.message;
  console.warn(`[Database] Transient MongoDB connection error: ${err.message}`);
  scheduleReconnect(3000);
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('[Database] MongoDB connection lost. Attempting automatic reconnection...');
  scheduleReconnect(2000);
});

mongoose.connection.on('reconnected', () => {
  isConnected = true;
  connectionError = null;
  console.log('[Database] MongoDB reconnected successfully');
});

export const getDatabaseStatus = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    connected: mongoose.connection.readyState === 1,
    state: states[mongoose.connection.readyState] || 'unknown',
    host: mongoose.connection.host || null,
    name: mongoose.connection.name || null,
    error: connectionError,
  };
};

export const closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
    console.log('[Database] MongoDB connection closed');
  }
};
