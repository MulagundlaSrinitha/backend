import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { initSentry } from './sentry';
import helmet from 'helmet';

// Load environment variables from .env
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function bootstrap() {
  // Initialize Sentry for error monitoring
  initSentry();

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // Security hardening
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", process.env.API_URL || 'https://api.next360.com', 'https://dwjrflijewoxcopgiwmx.supabase.co', 'https://*.supabase.co'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // Behind Railway/Render/Fly reverse proxies — without this req.ip is always
  // the proxy IP, which would put ALL users into one rate-limit bucket.
  const httpAdapter = app.getHttpAdapter().getInstance();
  if (httpAdapter?.set) {
    httpAdapter.set('trust proxy', 1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Delivery App local dev origins (Expo web on 8081, companion/metro dev on
  // 8082) — merged with configured/production origins. A wildcard '*' origin
  // can never be used together with credentials, so these are explicit.
  const deliveryDevOrigins = [
    'http://localhost:8081',
    'http://localhost:8082',
    'http://127.0.0.1:8081',
    'http://127.0.0.1:8082',
  ];

  const configuredOrigins =
    process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];

  app.enableCors({
    origin: Array.from(new Set([...configuredOrigins, ...deliveryDevOrigins])),
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // API_PORT is the explicit override; PORT is the standard env var that
  // Railway / Render / Fly.io inject (they forward traffic to it). Without
  // the PORT fallback the app would listen on 4000 and the platform's
  // health checks would never reach it.
  const port = process.env.API_PORT || process.env.PORT || 4000;
  await app.listen(port);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`🚀 Next360 API running on http://localhost:${port}`);
    console.log(`📋 Health check at http://localhost:${port}/api/health`);
  }
}

bootstrap();
