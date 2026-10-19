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
  const allowedOrigins = [
    config.clientUrl,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, postman, n8n)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  );
};
