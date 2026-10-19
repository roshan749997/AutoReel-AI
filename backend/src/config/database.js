import mongoose from 'mongoose';
import { config } from './env.js';

let isConnected = false;
let connectionError = null;

export const connectDatabase = async () => {
  if (!config.mongoUri) {
    connectionError = 'MONGODB_URI is not defined in environment';
    console.warn(`[Database] Warning: ${connectionError}`);
    return false;
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });

    isConnected = true;
    connectionError = null;
    console.log('[Database] MongoDB connection established successfully');
    return true;
  } catch (err) {
    isConnected = false;
    connectionError = err.message;
    console.error(`[Database] Failed to connect to MongoDB: ${err.message}`);
    return false;
  }
};

mongoose.connection.on('error', (err) => {
  isConnected = false;
  connectionError = err.message;
  console.warn(`[Database] Transient MongoDB connection error: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('[Database] MongoDB connection lost. Mongoose will automatically reconnect...');
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
