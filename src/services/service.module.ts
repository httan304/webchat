import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import type { RedisClientOptions } from 'redis';

// Import Redis Module
import { RedisModule } from '@/infrastructure/redis/redis.module';

// Import Services
import { CircuitBreakerService } from './circuit-breaker.service';
import { CacheService } from './cache.service';
import { RateLimiterService } from './rate-limiter.service';
import { BulkheadService } from './bulkhead.service';
import {RedisProvider} from "@/infrastructure/redis/redis.provider";

@Global()
@Module({
	imports: [
		RedisModule,
		CacheModule.registerAsync<RedisClientOptions>({
			useFactory: async () => ({
				store: await redisStore({
					socket: {
						host: process.env.REDIS_HOST || 'localhost',
						port: parseInt(process.env.REDIS_PORT || '6379'),
					},
					password: process.env.REDIS_PASSWORD || undefined,
					database: parseInt(process.env.REDIS_DB || '0'),
				}),
				ttl: 300 * 1000, // 5 minutes in milliseconds
			}),
		}),
	],
	providers: [
		RedisProvider,
		CircuitBreakerService,
		CacheService,
		RateLimiterService,
		BulkheadService,
	],
	exports: [
		CircuitBreakerService,
		CacheService,
		RateLimiterService,
		BulkheadService,
		CacheModule,
	],
})
export class ServicesModule {}
