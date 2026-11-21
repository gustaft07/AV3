import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env';

/**
 * 'worker': BullMQ exige maxRetriesPerRequest = null em conexões de Worker.
 * 'queue' / 'cache': falham rápido se o Redis estiver fora (a API responde 503 em vez de pendurar).
 */
export type PapelRedis = 'worker' | 'queue' | 'cache';

export function redisOpcoes(papel: PapelRedis): RedisOptions {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: papel === 'worker' ? null : 1,
    ...(papel === 'cache' ? { connectTimeout: 500 } : {}),
  };
}

export const criarClienteRedis = (papel: PapelRedis) => new Redis(redisOpcoes(papel));
