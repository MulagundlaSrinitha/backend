import { Logger } from '@nestjs/common';

const logger = new Logger('Sentry');

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.log('Sentry DSN not configured — skipping error monitoring setup');
    return null;
  }

  try {
    // Dynamic import so Sentry is optional
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
    });
    logger.log('Sentry initialized');
    return Sentry;
  } catch (error) {
    logger.warn('Failed to initialize Sentry — package may not be installed');
    return null;
  }
}

export function captureException(error: Error, context?: Record<string, any>) {
  try {
    const Sentry = require('@sentry/node');
    Sentry.captureException(error, { extra: context });
  } catch {
    // Sentry not available
  }
}
