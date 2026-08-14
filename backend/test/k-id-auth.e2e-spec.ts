import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Smoke test — requires a running Postgres (migrated) + Redis, i.e. run
 * `docker compose -f docker-compose.local.yml up -d && npx prisma migrate dev`
 * first. Not run as part of `npm test` (that's unit tests only); this is
 * `npm run test:e2e`.
 */
describe('K-ID auth flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects login with unknown credentials', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/k-id/login')
      .send({ callsign: 'GHOST', password: 'wrongpasswordwrong' })
      .expect(401);
  });

  it('rejects a malformed login payload', async () => {
    const server = app.getHttpServer();
    await request(server).post('/k-id/login').send({ callsign: 'ab' }).expect(400);
  });
});
