import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RateLimitConfig, RateLimitResult } from '../types/rate-limit-type';

@Injectable()
export class RateLimiterService {
    private readonly logger = new Logger(RateLimiterService.name);
    private readonly lua: string;

    constructor(private readonly redis: Redis) {
        this.lua = `-- KEYS[1] = rate limit key
        -- ARGV[1] = max_tokens
        -- ARGV[2] = refill_rate_per_ms
        -- ARGV[3] = now (ms)
        -- ARGV[4] = ttl_ms
        
        local data = redis.call("HMGET", KEYS[1], "tokens", "last")
        
        local tokens = tonumber(data[1])
        local last = tonumber(data[2])
        
        if not tokens then
          tokens = tonumber(ARGV[1])
          last = tonumber(ARGV[3])
        end
        
        local elapsed = tonumber(ARGV[3]) - last
        local refill = elapsed * tonumber(ARGV[2])
        
        tokens = math.min(tonumber(ARGV[1]), tokens + refill)
        
        local allowed = tokens >= 1
        
        if allowed then
          tokens = tokens - 1
        end
        
        redis.call(
          "HMSET",
          KEYS[1],
          "tokens", tokens,
          "last", ARGV[3]
        )
        
        redis.call("PEXPIRE", KEYS[1], ARGV[4])
        
        return { allowed and 1 or 0, tokens }`
    }

    async isAllowed(
      key: string,
      config: RateLimitConfig,
    ): Promise<RateLimitResult> {
        const redisKey = `ratelimit:${key}`;
        const now = Date.now();

        const refillRate = config.maxRequests / config.windowMs;
        const ttlMs = config.windowMs * 2;

        try {
            const [allowed, tokens] = (await this.redis.eval(
              this.lua,
              1,
              redisKey,
              config.maxRequests,
              refillRate,
              now,
              ttlMs,
            )) as [number, number];

            return {
                allowed: allowed === 1,
                remaining: Math.floor(tokens),
                retryAfter:
                  allowed === 1
                    ? undefined
                    : Math.ceil(1 / refillRate),
            };
        } catch (err) {
            this.logger.error(
              `Rate limiter failed for ${key}: ${(err as Error).message}`,
            );
            return {
                allowed: true,
                remaining: 1,
            };
        }
    }
}
