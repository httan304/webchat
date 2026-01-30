import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

/**
 * Create mock Redis client
 */
export const createMockRedis = () => ({
	get: jest.fn(),
	set: jest.fn(),
	del: jest.fn(),
	keys: jest.fn(),
	eval: jest.fn(),
	exists: jest.fn(),
	expire: jest.fn(),
	pexpire: jest.fn(),
	hmset: jest.fn(),
	hmget: jest.fn(),
	on: jest.fn(),
});

/**
 * Create mock Cache Manager
 */
export const createMockCacheManager = () => ({
	get: jest.fn(),
	set: jest.fn(),
	del: jest.fn(),
	reset: jest.fn(),
	wrap: jest.fn(),
	store: {
		keys: jest.fn(),
		del: jest.fn(),
	},
});

/**
 * Create mock CircuitBreakerService
 */
export const createMockCircuitBreaker = () => ({
	execute: jest.fn((name, fn, fallback) => fn()),
	getHealthStatus: jest.fn().mockResolvedValue({
		status: 'healthy',
		circuits: {},
	}),
});

/**
 * Create mock CacheService
 */
export const createMockCacheService = () => ({
	get: jest.fn(),
	set: jest.fn(),
	delete: jest.fn(),
	deletePattern: jest.fn(),
	getOrSet: jest.fn((key, fn, ttl) => fn()),
	getStats: jest.fn().mockReturnValue({
		hits: 0,
		misses: 0,
		hitRate: '0%',
	}),
});

/**
 * Create mock RateLimiterService
 */
export const createMockRateLimiter = () => ({
	isAllowed: jest.fn().mockResolvedValue({
		allowed: true,
		remaining: 10,
	}),
});

/**
 * Create mock BulkheadService
 */
export const createMockBulkhead = () => ({
	execute: jest.fn((config, fn) => fn()),
	getStatus: jest.fn().mockResolvedValue({
		currentConcurrency: 0,
		maxConcurrency: 50,
	}),
});

/**
 * Create mock UsersService
 */
export const createMockUsersService = () => ({
	create: jest.fn(),
	findByNickname: jest.fn(),
	findById: jest.fn(),
	findAll: jest.fn(),
	updateConnectionStatus: jest.fn(),
	deleteUser: jest.fn(),
	getOnlineUsers: jest.fn(),
});

/**
 * Get repository token for entity
 */
export const getRepoToken = <T>(entity: new () => T) =>
	getRepositoryToken(entity);

/**
 * Mock execution context for guards/interceptors
 */
export const createMockExecutionContext = (request: any = {}) => ({
	switchToHttp: () => ({
		getRequest: () => request,
		getResponse: () => ({
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
		}),
	}),
	getHandler: () => ({}),
	getClass: () => ({}),
});
