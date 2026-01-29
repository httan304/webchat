import {
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { Redis } from 'ioredis';

export interface BulkheadConfig {
    name: string;
    maxConcurrency: number;
    ttlMs?: number;
}

@Injectable()
export class BulkheadService {
    private readonly logger = new Logger(BulkheadService.name);

    constructor(private readonly redis: Redis) {}

    private key(name: string) {
        return `bulkhead:${name}`;
    }

    async execute<T>(
      config: BulkheadConfig,
      task: () => Promise<T>,
    ): Promise<T> {
        const key = this.key(config.name);
        const ttl = config.ttlMs ?? 10_000;

        const current = await this.redis.incr(key);

        if (current === 1) {
            await this.redis.pexpire(key, ttl);
        }

        if (current > config.maxConcurrency) {
            await this.redis.decr(key);
            throw new ServiceUnavailableException(
              `Bulkhead ${config.name} saturated`,
            );
        }

        try {
            return await task();
        } finally {
            await this.redis.decr(key);
        }
    }

    async getStatus(config: BulkheadConfig) {
        const value = Number((await this.redis.get(this.key(config.name))) ?? 0);

        return {
            name: config.name,
            currentConcurrency: value,
            maxConcurrency: config.maxConcurrency,
            utilization: ((value / config.maxConcurrency) * 100).toFixed(2) + '%',
            status:
              value >= config.maxConcurrency ? 'SATURATED' : 'HEALTHY',
        };
    }
}
