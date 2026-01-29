import { Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.provider';
import { Cache } from 'cache-manager';
import {Redis} from "ioredis";

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

    constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache,  @Inject('REDIS_CLIENT') private readonly redis: Redis,
    ) {}

    /**
     * Get value from cache
     */
    async get<T>(key: string): Promise<T | null> {
        try {
            const value = await this.cacheManager.get<T>(key);

            if (value) {
                this.stats.hits += 1;
                this.stats.total = this.stats.hits + this.stats.misses;
                this.updateHitRate();
                this.logger.debug(`âœ… Cache HIT: ${key}`);
                return value;
            }

            this.stats.misses += 1;
            this.stats.total = this.stats.hits + this.stats.misses;
            this.updateHitRate();
            this.logger.debug(`âŒ Cache MISS: ${key}`);
            return null;
        } catch (error) {
            this.logger.error(
              `Cache get error for key ${key}: ${(error as Error).message}`,
            );
            return null;
        }
    }

    /**
     * Set value in cache
     */
    async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
        try {
            await this.cacheManager.set(key, value, ttl * 1000);
            this.stats.sets += 1;
            this.logger.debug(`Cache SET: ${key} (TTL: ${ttl}s)`);
        } catch (error) {
            this.logger.error(
              `Cache set error for key ${key}: ${(error as Error).message}`,
            );
        }
    }

    /**
     * Get from cache or call factory function to populate
     */
    async getOrSet<T>(
      key: string,
      factory: () => Promise<T>,
      ttl: number = 300,
    ): Promise<T> {
        try {
            const cached = await this.get<T>(key);

            if (cached) {
                return cached;
            }

            this.logger.debug(`Cache MISS - computing: ${key}`);
            const value = await factory();
            await this.set(key, value, ttl);
            return value;
        } catch (error) {
            this.logger.error(
              `Get or set error for key ${key}: ${(error as Error).message}`,
            );
            throw error;
        }
    }

    /**
     * Delete a key from cache
     */
    async delete(key: string): Promise<void> {
        try {
            await this.cacheManager.del(key);
            this.stats.deletes += 1;
            this.logger.debug(`Cache DELETE: ${key}`);
        } catch (error) {
            this.logger.error(
              `Cache delete error for key ${key}: ${(error as Error).message}`,
            );
        }
    }

    /**
     * Delete all keys matching a pattern
     */
    async deletePattern(pattern: string): Promise<void> {
        this.logger.debug(`Cache deletePattern for key ${pattern}`);

        try {
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
            this.logger.debug(`Cache DELETE PATTERN: ${pattern} (${deleted} keys)`);
        } catch (error) {
            this.logger.error(
              `Cache delete pattern error for ${pattern}: ${(error as Error).message}`,
            );
        }
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        return {
            ...this.stats,
            total: this.stats.hits + this.stats.misses,
        };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            total: 0,
            hitRate: '0.00%',
        };
        this.logger.log('âœ… Cache statistics reset');
    }

    /**
     * Get health status
     */
    getHealthStatus(): any {
        return {
            status: 'healthy',
            stats: this.getStats(),
            uptime: process.uptime(),
        };
    }

    /**
     * Update hit rate percentage
     */
    private updateHitRate(): void {
        const total = this.stats.hits + this.stats.misses;
        const hitRate =
          total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : '0.00';
        this.stats.hitRate = hitRate + '%';
    }

    /**
     * Get detailed metrics
     */
    getMetrics(): any {
        const total = this.stats.hits + this.stats.misses;
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            sets: this.stats.sets,
            deletes: this.stats.deletes,
            total,
            hitRate: this.stats.hitRate,
            missRate: total > 0
              ? ((this.stats.misses / total) * 100).toFixed(2) + '%'
              : '0.00%',
        };
    }

    /**
     * Batch set multiple keys
     */
    async setMultiple<T>(
      entries: Array<[string, T, number]>,
    ): Promise<void> {
        try {
            await Promise.all(
              entries.map(([key, value, ttl]) => this.set(key, value, ttl)),
            );
            this.logger.debug(`Batch set: ${entries.length} keys`);
        } catch (error) {
            this.logger.error(
              `Batch set error: ${(error as Error).message}`,
            );
        }
    }

    /**
     * Batch get multiple keys
     */
    async getMultiple<T>(keys: string[]): Promise<(T | null)[]> {
        try {
            return await Promise.all(keys.map((key) => this.get<T>(key)));
        } catch (error) {
            this.logger.error(
              `Batch get error: ${(error as Error).message}`,
            );
            return keys.map(() => null);
        }
    }

    /**
     * Check if key exists in cache
     */
    async exists(key: string): Promise<boolean> {
        try {
            const value = await this.cacheManager.get(key);
            return value !== undefined && value !== null;
        } catch (error) {
            this.logger.error(
              `Cache exists error for key ${key}: ${(error as Error).message}`,
            );
            return false;
        }
    }

    /**
     * Increment a numeric value in cache
     */
    async increment(key: string, amount: number = 1): Promise<number> {
        try {
            const current = (await this.get<number>(key)) || 0;
            const newValue = current + amount;
            await this.set(key, newValue, 3600); // 1 hour TTL
            return newValue;
        } catch (error) {
            this.logger.error(
              `Cache increment error for key ${key}: ${(error as Error).message}`,
            );
            throw error;
        }
    }

    /**
     * Decrement a numeric value in cache
     */
    async decrement(key: string, amount: number = 1): Promise<number> {
        return this.increment(key, -amount);
    }
}
