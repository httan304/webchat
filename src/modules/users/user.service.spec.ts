import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	ConflictException,
	NotFoundException,
	HttpException,
} from '@nestjs/common';

import { UsersService } from './users.service';
import { User } from './entities/user.entity';

import { CacheService } from '@/services/cache.service';
import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';

describe('UsersService', () => {
	let service: UsersService;
	let repo: jest.Mocked<Repository<User>>;

	const mockRepo = {
		findOne: jest.fn(),
		create: jest.fn(),
		save: jest.fn(),
		delete: jest.fn(),
		createQueryBuilder: jest.fn(),
	};

	const mockCache = {
		get: jest.fn(),
		set: jest.fn(),
		delete: jest.fn(),
		deletePattern: jest.fn(),
	};

	const mockRateLimiter = {
		isAllowed: jest.fn().mockResolvedValue({ allowed: true }),
	};

	const mockBulkhead = {
		execute: jest.fn((_opt, fn) => fn()),
	};

	const mockCircuitBreaker = {
		execute: jest.fn((_opt, fn) => fn()),
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
		}).compile();

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
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw ConflictException if nickname exists', async () => {
			repo.findOne.mockResolvedValue({ id: '1' } as User);

			await expect(service.create({ nickname: 'john' }))
				.rejects.toBeInstanceOf(ConflictException);
		});

		it('should throw HttpException when rate limited', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: false });

			await expect(service.create({ nickname: 'john' }))
				.rejects.toBeInstanceOf(HttpException);
		});
	});

	describe('findByNickname()', () => {
		it('should return user when found', async () => {
			mockCache.get.mockResolvedValue(null);
			repo.findOne.mockResolvedValue({ nickname: 'john' } as User);

			await expect(service.findByNickname('john'))
				.resolves.toMatchObject({ nickname: 'john' });
		});

		it('should throw NotFoundException when not found', async () => {
			mockCache.get.mockResolvedValue(null);
			repo.findOne.mockResolvedValue(null);

			await expect(service.findByNickname('john'))
				.rejects.toBeInstanceOf(NotFoundException);
		});

		it('should return cached user', async () => {
			mockCache.get.mockResolvedValue({ nickname: 'john' });

			const result = await service.findByNickname('john');

			expect(result!.nickname).toBe('john');
			expect(repo.findOne).not.toHaveBeenCalled();
		});
	});

	describe('updateConnectionStatus()', () => {
		it('should update status if user exists', async () => {
			repo.findOne.mockResolvedValue({ nickname: 'john' } as User);
			repo.save.mockResolvedValue({} as User);

			await expect(
				service.updateConnectionStatus('john', true),
			).resolves.not.toThrow();

			expect(repo.save).toHaveBeenCalled();
		});

		it('should silently ignore if user not found', async () => {
			repo.findOne.mockResolvedValue(null);

			await expect(
				service.updateConnectionStatus('john', true),
			).resolves.not.toThrow();
		});
	});

	describe('deleteUser()', () => {
		it('should delete user and invalidate cache', async () => {
			repo.findOne.mockResolvedValue({ id: '1', nickname: 'john' } as User);
			repo.delete.mockResolvedValue({} as any);

			await service.deleteUser('john');

			expect(repo.delete).toHaveBeenCalledWith('1');
			expect(mockCache.delete).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw NotFoundException if user not found', async () => {
			repo.findOne.mockResolvedValue(null);

			await expect(service.deleteUser('john'))
				.rejects.toBeInstanceOf(NotFoundException);
		});
	});
});
