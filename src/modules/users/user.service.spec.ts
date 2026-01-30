import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	ConflictException,
	NotFoundException,
} from '@nestjs/common';

import { UsersService } from './users.service';
import { User } from './entities/user.entity';

import { CacheService } from '../../services/cache.service';
import { CircuitBreakerService } from '../../services/circuit-breaker.service';
import { RateLimiterService } from '../../services/rate-limiter.service';
import { BulkheadService } from '../../services/bulkhead.service';
import {RateLimitGuard} from "@/guard/rate-limit.guard";

describe('UsersService', () => {
	let service: UsersService;
	let repo: jest.Mocked<Repository<User>>;

	const mockRepo = {
		findOne: jest.fn(),
		create: jest.fn(),
		save: jest.fn(),
		delete: jest.fn(),
		find: jest.fn(),
		createQueryBuilder: jest.fn(),
	};

	const mockCache = {
		get: jest.fn(),
		set: jest.fn(),
		delete: jest.fn(),
		deletePattern: jest.fn(),
		getOrSet: jest.fn((_k, fn) => fn()),
		getStats: jest.fn(),
	};

	const mockRateLimiter = {
		isAllowed: jest.fn().mockResolvedValue({ allowed: true }),
	};

	const mockBulkhead = {
		execute: jest.fn((_opt, fn) => fn()),
		getStatus: jest.fn(),
	};

	const mockCircuitBreaker = {
		execute: jest.fn((_key, fn) => fn()),
		getHealthStatus: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				UsersService,
				{ provide: getRepositoryToken(User), useValue: mockRepo },
				{ provide: CacheService, useValue: mockCache },
				{ provide: RateLimiterService, useValue: mockRateLimiter },
				{ provide: BulkheadService, useValue: mockBulkhead },
				{ provide: CircuitBreakerService, useValue: mockCircuitBreaker },
			],
		})
			.compile();

		service = module.get(UsersService);
		repo = module.get(getRepositoryToken(User));

		jest.clearAllMocks();
	});

	describe('create()', () => {
		it('should create user successfully', async () => {
			repo.findOne.mockResolvedValue(null);
			repo.create.mockReturnValue({ nickname: 'john' } as User);
			repo.save.mockResolvedValue({ id: '1', nickname: 'john' } as User);

			const result = await service.create({ nickname: 'john' });

			expect(result.nickname).toBe('john');
			expect(repo.save).toHaveBeenCalled();
			expect(mockCache.set).toHaveBeenCalled();
		});

		it('should throw ConflictException if nickname exists', async () => {
			repo.findOne.mockResolvedValue({ id: '1' } as User);

			await expect(service.create({ nickname: 'john' }))
				.rejects.toBeInstanceOf(ConflictException);
		});
	});

	describe('findByNickname()', () => {
		it('should return user', async () => {
			repo.findOne.mockResolvedValue({ nickname: 'john' } as User);

			const result = await service.findByNickname('john');

			expect(result.nickname).toBe('john');
		});

		it('should throw NotFoundException', async () => {
			repo.findOne.mockResolvedValue(null);

			await expect(service.findByNickname('john'))
				.rejects.toBeInstanceOf(NotFoundException);
		});
	});

	describe('findById()', () => {
		it('should return user by id', async () => {
			repo.findOne.mockResolvedValue({ id: '1' } as User);

			const user = await service.findById('1');

			expect(user.id).toBe('1');
		});

		it('should throw NotFoundException', async () => {
			repo.findOne.mockResolvedValue(null);

			await expect(service.findById('1'))
				.rejects.toBeInstanceOf(NotFoundException);
		});
	});

	describe('updateConnectionStatus()', () => {
		it('should update status if user exists', async () => {
			repo.findOne.mockResolvedValue({ nickname: 'john' } as User);
			repo.save.mockResolvedValue({} as User);

			await service.updateConnectionStatus('john', true);

			expect(repo.save).toHaveBeenCalled();
			expect(mockCache.delete).toHaveBeenCalled();
		});

		it('should not throw if user not found', async () => {
			repo.findOne.mockResolvedValue(null);

			await expect(
				service.updateConnectionStatus('john', true),
			).resolves.not.toThrow();
		});
	});

	describe('deleteUser()', () => {
		it('should delete user', async () => {
			repo.findOne.mockResolvedValue({ id: '1', nickname: 'john' } as User);
			repo.delete.mockResolvedValue({} as any);

			await service.deleteUser('john');

			expect(repo.delete).toHaveBeenCalledWith('1');
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw NotFoundException', async () => {
			repo.findOne.mockResolvedValue(null);

			await expect(service.deleteUser('john'))
				.rejects.toBeInstanceOf(NotFoundException);
		});
	});

	describe('getOnlineUsers()', () => {
		it('should return online users', async () => {
			repo.find.mockResolvedValue([{ nickname: 'john' }] as User[]);

			const users = await service.getOnlineUsers();

			expect(users.length).toBe(1);
			expect(users[0].nickname).toBe('john');
		});
	});

	describe('getHealthStatus()', () => {
		it('should return healthy status', async () => {
			mockCircuitBreaker.getHealthStatus.mockResolvedValue({});
			mockBulkhead.getStatus.mockResolvedValue({});
			mockCache.getStats.mockReturnValue({});

			const health = await service.getHealthStatus();

			expect(health.status).toBe('healthy');
		});
	});
});
