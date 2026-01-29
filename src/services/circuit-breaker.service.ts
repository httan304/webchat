import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { CircuitBreakerConfig, CircuitState } from '@/types/circuit-breaker.type';
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.provider';

@Injectable()
export class CircuitBreakerService {
    private readonly logger = new Logger(CircuitBreakerService.name);

    private readonly defaultConfig: Required<CircuitBreakerConfig> = {
        failureThreshold: 5,
        successThreshold: 2,
        openDurationMs: 60_000,
        volumeThreshold: 10,
        errorPercentageThreshold: 50,
    };

    constructor(
      @Inject(REDIS_CLIENT)
      private readonly redis: Redis,
    ) {}

    private key(name: string, suffix: string) {
        return `cb:${name}:${suffix}`;
    }

    async execute<T>(
      name: string,
      operation: () => Promise<T>,
      fallback?: (err: Error) => Promise<T>,
      config: CircuitBreakerConfig = {},
    ): Promise<T> {
        const cfg = { ...this.defaultConfig, ...config };

        const stateKey = this.key(name, 'state');
        const state = ((await this.redis.get(stateKey)) ||
          'CLOSED') as CircuitState;

        // OPEN state check
        if (state === 'OPEN') {
            const openedAt = Number(await this.redis.get(this.key(name, 'opened_at')));
            if (Date.now() - openedAt < cfg.openDurationMs) {
                if (fallback) return fallback(new Error('Circuit OPEN'));
                throw new Error('Circuit OPEN');
            }

            await this.redis.set(stateKey, 'HALF_OPEN');
            this.logger.warn(`Circuit ${name} â†’ HALF_OPEN`);
        }

        // HALF_OPEN lock
        if ((await this.redis.get(stateKey)) === 'HALF_OPEN') {
            const lock = await this.redis.set(
              this.key(name, 'half_open_lock'),
              '1',
              'EX',
              30,
              'NX',
            );

            if (!lock) {
                if (fallback) return fallback(new Error('Circuit HALF_OPEN'));
                throw new Error('Circuit HALF_OPEN');
            }
        }

        try {
            const result = await operation();

            await this.redis.incr(this.key(name, 'success'));
            await this.redis.incr(this.key(name, 'total'));

            if ((await this.redis.get(stateKey)) === 'HALF_OPEN') {
                const success = Number(await this.redis.get(this.key(name, 'success')));
                if (success >= cfg.successThreshold) {
                    await this.reset(name);
                    this.logger.log(`Circuit ${name} â†’ CLOSED`);
                }
            }

            return result;
        } catch (err) {
            await this.redis.incr(this.key(name, 'failure'));
            await this.redis.incr(this.key(name, 'total'));

            const failure = Number(await this.redis.get(this.key(name, 'failure')));
            const total = Number(await this.redis.get(this.key(name, 'total')));
            const errorRate = (failure / total) * 100;

            const shouldOpen =
              failure >= cfg.failureThreshold ||
              (total >= cfg.volumeThreshold &&
                errorRate >= cfg.errorPercentageThreshold);

            if (shouldOpen) {
                await this.redis.set(stateKey, 'OPEN');
                await this.redis.set(this.key(name, 'opened_at'), Date.now());
                this.logger.error(
                  `Circuit ${name} OPEN (errorRate=${errorRate.toFixed(2)}%)`,
                );
            }

            if (fallback) return fallback(err as Error);
            throw err;
        }
    }

    async getHealthStatus(): Promise<Record<string, any>> {
        const keys = await this.redis.keys('cb:*:state');
        const result: Record<string, any> = {};

        for (const stateKey of keys) {
            const name = stateKey.split(':')[1];

            const [
                state,
                failureCount,
                successCount,
                totalRequests,
                errorPercentage,
                lastFailureTime,
                nextRetryTime,
            ] = await this.redis.mget(
              this.key(name, 'state'),
              this.key(name, 'failure_count'),
              this.key(name, 'success_count'),
              this.key(name, 'total_requests'),
              this.key(name, 'error_percentage'),
              this.key(name, 'last_failure_time'),
              this.key(name, 'next_retry_time'),
            );

            result[name] = {
                state,
                failureCount: Number(failureCount ?? 0),
                successCount: Number(successCount ?? 0),
                totalRequests: Number(totalRequests ?? 0),
                errorPercentage: `${Number(errorPercentage ?? 0).toFixed(2)}%`,
                lastFailureTime: lastFailureTime
                  ? new Date(Number(lastFailureTime)).toISOString()
                  : null,
                nextRetryTime: nextRetryTime
                  ? new Date(Number(nextRetryTime)).toISOString()
                  : null,
            };
        }

        return result;
    }

    async reset(name: string) {
        await this.redis.del(
          this.key(name, 'state'),
          this.key(name, 'failure'),
          this.key(name, 'success'),
          this.key(name, 'total'),
          this.key(name, 'opened_at'),
          this.key(name, 'half_open_lock'),
        );
    }
}
