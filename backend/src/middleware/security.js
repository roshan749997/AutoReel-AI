import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config/env.js';

export const configureSecurity = (app) => {
  // Helmet with relaxed cross-origin embedder policy for video previews if needed
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false, // Let frontend handle CSP or enable in production
    })
  );

  // CORS configuration
  const clientUrls = (config.clientUrl || '').split(',').map((u) => u.trim()).filter(Boolean);
  const allowedOrigins = [
    ...clientUrls,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, postman, n8n, server-to-server)
        // or any localhost port in development
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          (process.env.NODE_ENV === 'production' && origin.endsWith('.onrender.com'))
        ) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-api-key'],
    })
  );
};
