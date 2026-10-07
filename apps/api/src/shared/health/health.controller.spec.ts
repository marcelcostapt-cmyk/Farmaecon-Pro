import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  function createController({
    query = Promise.resolve([]),
    ping = Promise.resolve('PONG'),
  }: {
    query?: Promise<unknown>;
    ping?: Promise<unknown>;
  } = {}) {
    const prisma = {
      $queryRaw: jest.fn().mockReturnValue(query),
    } as never;
    const queue = {
      client: Promise.resolve({
        ping: jest.fn().mockReturnValue(ping),
      }),
    } as never;

    return new HealthController(prisma, queue);
  }

  it('reports liveness without requiring dependencies', () => {
    expect(createController().health()).toEqual({
      status: 'ok',
      mode: 'OBSERVATION',
    });
  });

  it('reports readiness when PostgreSQL and Redis respond', async () => {
    await expect(createController().ready()).resolves.toEqual({ status: 'ready' });
  });

  it('fails readiness when a dependency rejects', async () => {
    const error = new Error('database unavailable');
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(error),
    } as never;
    const queue = {
      client: Promise.resolve({
        ping: jest.fn().mockResolvedValue('PONG'),
      }),
    } as never;

    await expect(new HealthController(prisma, queue).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
