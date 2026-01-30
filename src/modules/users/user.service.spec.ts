import { Test, TestingModule } from '@nestjs/testing';
import {
	ConflictException,
	NotFoundException,
	HttpException,
} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import {CircuitBreakerService} from "@/services/circuit-breaker.service";
import {CacheService} from "@/services/cache.service";
import {RateLimiterService} from "@/services/rate-limiter.service";
import {BulkheadService} from "@/services/bulkhead.service";

describe('UsersService', () => {
	let service: UsersService;
	let userRepository: any;
	let circuitBreaker: any;
	let cache: any;
	let rateLimiter: any;
	let bulkhead: any;

	const mockUser: User = {
		id: 'user-uuid-123',
		nickname: 'testuser',
		lastSeen: new Date('2026-01-29'),
		isConnected: false,
		createdAt: new Date('2026-01-29'),
		updatedAt: new Date('2026-01-29'),
	};

	// ✅ Mock implementations
	const mockRepository = {
		findOne: jest.fn(),
		find: jest.fn(),
		create: jest.fn(),
		save: jest.fn(),
		delete: jest.fn(),
		createQueryBuilder: jest.fn(() => ({
			where: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			skip: jest.fn().mockReturnThis(),
			take: jest.fn().mockReturnThis(),
			getManyAndCount: jest.fn(),
		})),
	};

	const mockCircuitBreaker = {
		execute: jest.fn((name, fn, fallback) => fn()),
		getHealthStatus: jest.fn().mockResolvedValue({}),
	};

	const mockCache = {
		set: jest.fn(),
		delete: jest.fn(),
		deletePattern: jest.fn(),
		getOrSet: jest.fn((key, fn, ttl) => fn()),
		getStats: jest.fn().mockReturnValue({}),
	};

	const mockRateLimiter = {
		isAllowed: jest.fn().mockResolvedValue({ allowed: true }),
	};

	const mockBulkhead = {
		execute: jest.fn((config, fn) => fn()),
		getStatus: jest.fn().mockResolvedValue({}),
	};


	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				UsersService,
				{
					provide: getRepositoryToken(User),
					useValue: mockRepository,
				},
				{
					provide: CircuitBreakerService, // ✅ Use class as token
					useValue: mockCircuitBreaker,
				},
				{
					provide: CacheService, // ✅ Use class as token
					useValue: mockCache,
				},
				{
					provide: RateLimiterService, // ✅ Use class as token
					useValue: mockRateLimiter,
				},
				{
					provide: BulkheadService, // ✅ Use class as token
					useValue: mockBulkhead,
				},
			],
		}).compile();

		service = module.get<UsersService>(UsersService);
		userRepository = module.get(getRepositoryToken(User));
		circuitBreaker = module.get(CircuitBreakerService);
		cache = module.get(CacheService);
		rateLimiter = module.get(RateLimiterService);
		bulkhead = module.get(BulkheadService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('create', () => {
		it('should create user successfully', async () => {
			const dto: CreateUserDto = { nickname: 'testuser' };

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRepository.findOne.mockResolvedValue(null);
			mockRepository.create.mockReturnValue(mockUser);
			mockRepository.save.mockResolvedValue(mockUser);

			const result = await service.create(dto);

			expect(result).toEqual(mockUser);
			expect(mockRepository.save).toHaveBeenCalled();
			expect(mockCache.set).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw HttpException when rate limited', async () => {
			const dto: CreateUserDto = { nickname: 'testuser' };

			mockRateLimiter.isAllowed.mockResolvedValue({
				allowed: false,
				retryAfter: 30,
			});

			await expect(service.create(dto)).rejects.toThrow(HttpException);
		});

		it('should throw ConflictException if nickname exists', async () => {
			const dto: CreateUserDto = { nickname: 'testuser' };

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRepository.findOne.mockResolvedValue(mockUser);

			await expect(service.create(dto)).rejects.toThrow(ConflictException);
		});
	});

	describe('findByNickname', () => {
		it('should return user', async () => {
			mockCache.getOrSet.mockImplementation(() => mockUser);

			const result = await service.findByNickname('testuser');

			expect(result).toEqual(mockUser);
		});

		it('should throw NotFoundException', async () => {
			mockCache.getOrSet.mockImplementation(async (k, fn) => fn());
			mockRepository.findOne.mockResolvedValue(null);

			await expect(service.findByNickname('nonexistent')).rejects.toThrow(
				NotFoundException,
			);
		});
	});

	describe('findAll', () => {
		it('should return paginated users', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (k, fn) => fn());

			const qb = mockRepository.createQueryBuilder();
			qb.getManyAndCount.mockResolvedValue([[mockUser], 1]);

			const result = await service.findAll({ page: 1, limit: 20 });

			expect(result.data).toEqual([mockUser]);
			expect(result.meta.total).toBe(1);
		});

		it('should apply search filter', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (k, fn) => fn());

			const qb = mockRepository.createQueryBuilder();
			qb.getManyAndCount.mockResolvedValue([[], 0]);

			await service.findAll({ page: 1, limit: 20, search: 'test' });

			expect(qb.where).toHaveBeenCalled();
		});
	});

	describe('updateConnectionStatus', () => {
		it('should update status', async () => {
			mockRepository.findOne.mockResolvedValue(mockUser);
			mockRepository.save.mockResolvedValue(mockUser);

			await service.updateConnectionStatus('testuser', true);

			expect(mockRepository.save).toHaveBeenCalled();
			expect(mockCache.delete).toHaveBeenCalled();
		});

		it('should handle non-existent user', async () => {
			mockRepository.findOne.mockResolvedValue(null);

			await service.updateConnectionStatus('nonexistent', true);

			expect(mockRepository.save).not.toHaveBeenCalled();
		});
	});

	describe('getOnlineUsers', () => {
		it('should return online users', async () => {
			const onlineUser = { ...mockUser, isConnected: true };

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (k, fn) => fn());
			mockRepository.find.mockResolvedValue([onlineUser]);

			const result = await service.getOnlineUsers();

			expect(result).toEqual([onlineUser]);
		});
	});

	describe('deleteUser', () => {
		it('should delete user', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRepository.findOne.mockResolvedValue(mockUser);
			mockRepository.delete.mockResolvedValue({ affected: 1 });

			await service.deleteUser('testuser');

			expect(mockRepository.delete).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw NotFoundException', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRepository.findOne.mockResolvedValue(null);

			await expect(service.deleteUser('nonexistent')).rejects.toThrow(
				NotFoundException,
			);
		});
	});

	describe('findById', () => {
		it('should find user by id', async () => {
			mockCache.getOrSet.mockImplementation(async (k, fn) => fn());
			mockRepository.findOne.mockResolvedValue(mockUser);

			const result = await service.findById('user-uuid-123');

			expect(result).toEqual(mockUser);
		});
	});

	describe('getHealthStatus', () => {
		it('should return healthy status', async () => {
			const result = await service.getHealthStatus();

			expect(result.status).toBe('healthy');
		});

		it('should return degraded on error', async () => {
			mockCircuitBreaker.getHealthStatus.mockRejectedValue(new Error('Failed'));

			const result = await service.getHealthStatus();

			expect(result.status).toBe('degraded');
		});
	});
});
