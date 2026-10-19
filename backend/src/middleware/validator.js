import { AppError } from './errorHandler.js';

export const validateBody = (requiredFields) => {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next(new AppError('Request body is missing or invalid JSON', 400));
    }

    const missing = [];
    for (const field of requiredFields) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return next(
        new AppError(`Missing required fields: ${missing.join(', ')}`, 400, {
          missingFields: missing,
        })
      );
    }

    next();
  };
};
