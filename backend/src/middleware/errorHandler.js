export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFoundHandler = (req, res, next) => {
  next(new AppError(`Endpoint ${req.originalUrl} not found`, 404));
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const status = err.status || 'error';
  const isDev = process.env.NODE_ENV !== 'production';

  console.error(`[Error] [${req.method} ${req.url}] ${err.message}`);
  if (err.stack && isDev) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    status,
    message: err.message || 'Internal server error',
    ...(err.details && { details: err.details }),
    ...(isDev && { stack: err.stack }),
  });
};
