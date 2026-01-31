import {
    BadRequestException, ForbiddenException, Inject,
    Injectable,
    Logger, NotFoundException,
    ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import {REDIS_CLIENT} from "@/infrastructure/redis/redis.provider";

export interface CircuitBreakerConfig {
    name: string;
    failureThreshold: number;
    openDurationMs: number;
    halfOpenMaxAttempts: number;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

@Injectable()
export class CircuitBreakerService {
    private readonly logger = new Logger(CircuitBreakerService.name);

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    private stateKey(name: string) {
        return `cb:${name}:state`;
    }

    private failureKey(name: string) {
        return `cb:${name}:failures`;
    }

    private halfOpenKey(name: string) {
        return `cb:${name}:half-open`;
    }

    async execute<T>(
      config: CircuitBreakerConfig,
      task: () => Promise<T>,
    ): Promise<T> {
        const stateKey = this.stateKey(config.name);
        const failureKey = this.failureKey(config.name);
        const halfOpenLock = this.halfOpenKey(config.name);

        const state =
          ((await this.redis.get(stateKey)) as CircuitState) ?? 'CLOSED';

        if (state === 'OPEN') {
            throw new ServiceUnavailableException('Circuit OPEN');
        }

        if (state === 'HALF_OPEN') {
            const acquired = await this.redis.set(
              halfOpenLock,
              crypto.randomUUID(),
              'PX',
              config.openDurationMs,
              'NX',
            );

            if (!acquired) {
                throw new ServiceUnavailableException('Circuit HALF_OPEN');
            }
        }

        try {
            const result = await task();

            await this.redis.multi()
              .del(failureKey)
              .set(stateKey, 'CLOSED')
              .exec();

            return result;
        } catch (err) {
            if (this.isIgnorableError(err)) {
                throw err;
            }

            const failures = await this.redis.incr(failureKey);
            await this.redis.pexpire(failureKey, config.openDurationMs);

            if (failures >= config.failureThreshold) {
                await this.redis.set(
                  stateKey,
                  'OPEN',
                  'PX',
                  config.openDurationMs,
                  'NX',
                );
            }

            throw err;
        }
    }

    private isIgnorableError(err: unknown): boolean {
        return (
          err instanceof NotFoundException ||
          err instanceof BadRequestException ||
          err instanceof UnauthorizedException ||
          err instanceof ForbiddenException
        );
    }
}
