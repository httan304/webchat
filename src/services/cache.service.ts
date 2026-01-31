import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

interface CacheStats {
	hits: number;
	misses: number;
	sets: number;
	deletes: number;
	total: number;
	hitRate: string;
}

@Injectable()
export class CacheService {
	private readonly logger = new Logger(CacheService.name);

	private stats: CacheStats = {
		hits: 0,
		misses: 0,
		sets: 0,
		deletes: 0,
		total: 0,
		hitRate: '0.00%',
	};

	constructor(
		@Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
		@Inject('REDIS_CLIENT') private readonly redis: Redis,
	) {}

	async get<T>(key: string): Promise<T | null> {
		try {
			const value = await this.cacheManager.get<T>(key);

			if (value !== null && value !== undefined) {
				this.stats.hits++;
				this.updateStats();
				this.logger.debug(`Cache HIT: ${key}`);
				return value;
			}

			this.stats.misses++;
			this.updateStats();
			this.logger.debug(`Cache MISS: ${key}`);
			return null;
		} catch (err) {
			this.logger.error(`Cache GET error ${key}: ${(err as Error).message}`);
			return null;
		}
	}

	async set<T>(key: string, value: T, ttl = 300): Promise<void> {
		try {
			await this.redis.set(
				key,
				JSON.stringify(value),
				'EX',
				ttl,
			);
			this.stats.sets++;
			this.logger.debug(`Cache SET: ${key} (${ttl}s)`);
		} catch (err) {
			this.logger.error(`Cache SET error ${key}: ${(err as Error).message}`);
		}
	}

	async getOrSet<T>(
		key: string,
		factory: () => Promise<T>,
		ttl = 300,
	): Promise<T> {
		const lockKey = `${key}:lock`;
		const lockTtlMs = 5000;
		const lockValue = randomUUID();

		const cached = await this.get<T>(key);
		if (cached !== null && cached !== undefined) {
			return cached;
		}

		const locked = await this.redis.set(
			lockKey,
			lockValue,
			'PX',
			lockTtlMs,
			'NX',
		);

		if (!locked) {
			await new Promise((r) => setTimeout(r, 50));
			const retry = await this.get<T>(key);
			if (retry !== null && retry !== undefined) {
				return retry;
			}
		}

		try {
			this.logger.debug(`Cache MISS – computing: ${key}`);
			const value = await factory();
			await this.set(key, value, ttl);
			return value;
		} finally {
			const current = await this.redis.get(lockKey);
			if (current === lockValue) {
				await this.redis.del(lockKey);
			}
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.redis.del(key);
			this.stats.deletes++;
			this.logger.debug(`Cache DELETE: ${key}`);
		} catch (err) {
			this.logger.error(`Cache DELETE error ${key}: ${(err as Error).message}`);
		}
	}

	async deletePattern(pattern: string): Promise<void> {
		this.logger.debug(`Cache deletePattern: ${pattern}`);

		let cursor = '0';
		let deleted = 0;

		do {
			const [nextCursor, keys] = await this.redis.scan(
				cursor,
				'MATCH',
				pattern,
				'COUNT',
				100,
			);

			cursor = nextCursor;

			if (keys.length > 0) {

				await this.redis.del(...keys);
				deleted += keys.length;
			}
		} while (cursor !== '0');

		this.stats.deletes += deleted;
		this.logger.debug(`Cache DELETE PATTERN: ${pattern} (${deleted})`);
	}

	private updateStats() {
		const total = this.stats.hits + this.stats.misses;
		this.stats.hitRate =
			total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0.00%';
	}

	async exists(key: string): Promise<boolean> {
		try {
			const value = await this.cacheManager.get(key);
			return value !== null && value !== undefined;
		} catch {
			return false;
		}
	}
}
