import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ensureAppTimezone } from './common/time/timezone';

/** Fuseau métier unique (Port-au-Prince) avant tout calcul de dates. */
ensureAppTimezone();

/** Base64 data URLs (logos, etc.) dépassent souvent la limite Express par défaut (~100 ko). */
const JSON_BODY_LIMIT = '5mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  /** Derrière Nginx / ALB (X-Forwarded-*). */
  app.set('trust proxy', 1);
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  const configService = app.get(ConfigService);
  // `origin: true` reflète l’Origin du client — nécessaire pour l’app Electron installée (pas seulement localhost:5173).
  // L’accès reste protégé par JWT ; resserrer avec une liste blanche si besoin (variable CORS_ORIGINS).
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
}

bootstrap();
