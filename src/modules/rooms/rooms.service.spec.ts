import { Test, TestingModule } from '@nestjs/testing';
import {
	ConflictException,
	NotFoundException,
	ForbiddenException,
	HttpException,
	HttpStatus,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RoomsService } from './rooms.service';
import { Room } from './entities/room.entity';
import { RoomParticipant } from './entities/room-participant.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

// Import service classes
import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';
import {RateLimitGuard} from "@/guard/rate-limit.guard";

describe('RoomsService', () => {
	let service: RoomsService;
	let roomRepository: any;
	let userRepository: any;
	let participantRepository: any;
	let usersService: any;
	let circuitBreaker: any;
	let cache: any;
	let rateLimiter: any;
	let bulkhead: any;

	const mockRoom: Room = {
		id: 'room-uuid-123',
		name: 'Test Room',
		description: 'Test Description',
		creatorNickname: 'alice',
		createdAt: new Date('2026-01-29'),
		updatedAt: new Date('2026-01-29'),
	};

	const mockUser: User = {
		id: 'user-uuid-123',
		nickname: 'alice',
		isConnected: true,
		lastSeen: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockParticipant: RoomParticipant = {
		id: 'participant-uuid-123',
		roomId: 'room-uuid-123',
		nickname: 'alice',
		joinedAt: new Date(),
	};

	// Mock implementations
	const mockRoomRepository = {
		findOne: jest.fn(),
		find: jest.fn(),
		create: jest.fn(),
		save: jest.fn(),
		delete: jest.fn(),
	};

	const mockUserRepository = {
		findOne: jest.fn(),
		find: jest.fn(),
	};

	const mockParticipantRepository = {
		findOne: jest.fn(),
		find: jest.fn(),
		create: jest.fn(),
		save: jest.fn(),
		delete: jest.fn(),
	};

	const mockUsersService = {
		findByNickname: jest.fn(),
	};

	const mockCircuitBreaker = {
		execute: jest.fn((name, fn, fallback) => fn()),
	};

	const mockCache = {
		get: jest.fn(),
		set: jest.fn(),
		delete: jest.fn(),
		deletePattern: jest.fn(),
		getOrSet: jest.fn((key, fn, ttl) => fn()),
	};

	const mockRateLimiter = {
		isAllowed: jest.fn().mockResolvedValue({ allowed: true }),
	};

	const mockBulkhead = {
		execute: jest.fn((config, fn) => fn()),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				RoomsService,
				{
					provide: getRepositoryToken(Room),
					useValue: mockRoomRepository,
				},
				{
					provide: getRepositoryToken(User),
					useValue: mockUserRepository,
				},
				{
					provide: getRepositoryToken(RoomParticipant),
					useValue: mockParticipantRepository,
				},
				{
					provide: UsersService,
					useValue: mockUsersService,
				},
				{
					provide: CircuitBreakerService,
					useValue: mockCircuitBreaker,
				},
				{
					provide: CacheService,
					useValue: mockCache,
				},
				{
					provide: RateLimiterService,
					useValue: mockRateLimiter,
				},
				{
					provide: BulkheadService,
					useValue: mockBulkhead,
				},
			],
		})
			.compile();

		service = module.get<RoomsService>(RoomsService);
		roomRepository = module.get(getRepositoryToken(Room));
		userRepository = module.get(getRepositoryToken(User));
		participantRepository = module.get(getRepositoryToken(RoomParticipant));
		usersService = module.get(UsersService);
		circuitBreaker = module.get(CircuitBreakerService);
		cache = module.get(CacheService);
		rateLimiter = module.get(RateLimiterService);
		bulkhead = module.get(BulkheadService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('createRoom', () => {
		it('should create room successfully', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(null);
			mockRoomRepository.create.mockReturnValue(mockRoom);
			mockRoomRepository.save.mockResolvedValue(mockRoom);
			mockParticipantRepository.create.mockReturnValue(mockParticipant);
			mockParticipantRepository.save.mockResolvedValue(mockParticipant);

			const result = await service.createRoom('Test Room', 'alice', 'Description');

			expect(result).toEqual(mockRoom);
			expect(mockRateLimiter.isAllowed).toHaveBeenCalledWith(
				'room-create:alice',
				{ maxRequests: 3, windowMs: 60_000 },
			);
			expect(mockRoomRepository.save).toHaveBeenCalled();
			expect(mockParticipantRepository.save).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
			expect(mockCache.set).toHaveBeenCalled();
		});

		it('should throw HttpException when rate limited', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({
				allowed: false,
				retryAfter: 30,
			});

			await expect(
				service.createRoom('Test Room', 'alice'),
			).rejects.toThrow(HttpException);

			expect(mockRoomRepository.findOne).not.toHaveBeenCalled();
		});

		it('should throw ConflictException if room name exists', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);

			await expect(
				service.createRoom('Test Room', 'alice'),
			).rejects.toThrow(ConflictException);

			expect(mockRoomRepository.save).not.toHaveBeenCalled();
		});

		it('should auto-join owner as participant', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(null);
			mockRoomRepository.create.mockReturnValue(mockRoom);
			mockRoomRepository.save.mockResolvedValue(mockRoom);
			mockParticipantRepository.create.mockReturnValue(mockParticipant);
			mockParticipantRepository.save.mockResolvedValue(mockParticipant);

			await service.createRoom('Test Room', 'alice');

			expect(mockParticipantRepository.create).toHaveBeenCalledWith({
				roomId: mockRoom.id,
				nickname: 'alice',
			});
			expect(mockParticipantRepository.save).toHaveBeenCalled();
		});
	});

	describe('joinRoom', () => {
		it('should join room successfully', async () => {
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockUserRepository.findOne.mockResolvedValue(mockUser);
			mockParticipantRepository.findOne.mockResolvedValue(null);
			mockParticipantRepository.create.mockReturnValue(mockParticipant);
			mockParticipantRepository.save.mockResolvedValue(mockParticipant);

			await service.joinRoom('room-uuid-123', 'alice');

			expect(mockRoomRepository.findOne).toHaveBeenCalledWith({
				where: { id: 'room-uuid-123' },
			});
			expect(mockUserRepository.findOne).toHaveBeenCalledWith({
				where: { nickname: 'alice' },
			});
			expect(mockParticipantRepository.save).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should be idempotent (not error if already joined)', async () => {
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockUserRepository.findOne.mockResolvedValue(mockUser);
			mockParticipantRepository.findOne.mockResolvedValue(mockParticipant);

			await service.joinRoom('room-uuid-123', 'alice');

			expect(mockParticipantRepository.save).not.toHaveBeenCalled();
		});

		it('should throw NotFoundException if room not found', async () => {
			mockRoomRepository.findOne.mockResolvedValue(null);

			await expect(
				service.joinRoom('nonexistent', 'alice'),
			).rejects.toThrow(NotFoundException);
		});

		it('should throw NotFoundException if user not found', async () => {
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockUserRepository.findOne.mockResolvedValue(null);

			await expect(
				service.joinRoom('room-uuid-123', 'nonexistent'),
			).rejects.toThrow(NotFoundException);
		});
	});

	describe('deleteRoom', () => {
		it('should delete room successfully', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockParticipantRepository.delete.mockResolvedValue({ affected: 1 });
			mockRoomRepository.delete.mockResolvedValue({ affected: 1 });

			await service.deleteRoom('room-uuid-123', 'alice');

			expect(mockParticipantRepository.delete).toHaveBeenCalledWith({
				roomId: 'room-uuid-123',
			});
			expect(mockRoomRepository.delete).toHaveBeenCalledWith('room-uuid-123');
			expect(mockCache.delete).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw ForbiddenException if not owner', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);

			await expect(
				service.deleteRoom('room-uuid-123', 'bob'),
			).rejects.toThrow(ForbiddenException);

			expect(mockRoomRepository.delete).not.toHaveBeenCalled();
		});

		it('should throw NotFoundException if room not found', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(null);

			await expect(
				service.deleteRoom('nonexistent', 'alice'),
			).rejects.toThrow(NotFoundException);
		});

		it('should throw HttpException when rate limited', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: false });

			await expect(
				service.deleteRoom('room-uuid-123', 'alice'),
			).rejects.toThrow(HttpException);
		});
	});

	describe('getRoomsCreatedBy', () => {
		it('should return rooms created by user', async () => {
			const rooms = [mockRoom];

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());
			mockRoomRepository.find.mockResolvedValue(rooms);

			const result = await service.getRoomsCreatedBy('alice');

			expect(result).toEqual(rooms);
			expect(mockRoomRepository.find).toHaveBeenCalledWith({
				where: { creatorNickname: 'alice' },
				order: { createdAt: 'DESC' },
			});
		});

		it('should return cached rooms', async () => {
			const rooms = [mockRoom];

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(() => rooms);

			const result = await service.getRoomsCreatedBy('alice');

			expect(result).toEqual(rooms);
			expect(mockRoomRepository.find).not.toHaveBeenCalled();
		});

		it('should throw HttpException when rate limited', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: false });

			await expect(service.getRoomsCreatedBy('alice')).rejects.toThrow(
				HttpException,
			);
		});

		it('should use 5 minute cache TTL', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(() => []);

			await service.getRoomsCreatedBy('alice');

			expect(mockCache.getOrSet).toHaveBeenCalledWith(
				'rooms-list:created:alice',
				expect.any(Function),
				300, // 5 minutes
			);
		});
	});

	describe('getParticipants', () => {
		it('should return participants for room owner', async () => {
			const participants = [mockParticipant];

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockParticipantRepository.find.mockResolvedValue(participants);

			const result = await service.getParticipants('room-uuid-123', 'alice');

			expect(result).toEqual(participants);
			expect(mockParticipantRepository.find).toHaveBeenCalledWith({
				where: { roomId: 'room-uuid-123' },
				select: ['id', 'nickname', 'joinedAt'],
				order: { joinedAt: 'ASC' },
			});
		});

		it('should throw ForbiddenException if not owner', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);

			await expect(
				service.getParticipants('room-uuid-123', 'bob'),
			).rejects.toThrow(ForbiddenException);
		});

		it('should throw NotFoundException if room not found', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());
			mockRoomRepository.findOne.mockResolvedValue(null);

			await expect(
				service.getParticipants('nonexistent', 'alice'),
			).rejects.toThrow(NotFoundException);
		});

		it('should use 1 minute cache TTL', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(() => []);

			await service.getParticipants('room-uuid-123', 'alice');

			expect(mockCache.getOrSet).toHaveBeenCalledWith(
				'participant:room:room-uuid-123',
				expect.any(Function),
				60, // 1 minute
			);
		});
	});

	describe('Cache invalidation', () => {
		it('should invalidate room list cache on create', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(null);
			mockRoomRepository.create.mockReturnValue(mockRoom);
			mockRoomRepository.save.mockResolvedValue(mockRoom);
			mockParticipantRepository.create.mockReturnValue(mockParticipant);
			mockParticipantRepository.save.mockResolvedValue(mockParticipant);

			await service.createRoom('Test Room', 'alice');

			expect(mockCache.deletePattern).toHaveBeenCalledWith('rooms-list:*');
		});

		it('should invalidate participant cache on join', async () => {
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockUserRepository.findOne.mockResolvedValue(mockUser);
			mockParticipantRepository.findOne.mockResolvedValue(null);
			mockParticipantRepository.create.mockReturnValue(mockParticipant);
			mockParticipantRepository.save.mockResolvedValue(mockParticipant);

			await service.joinRoom('room-uuid-123', 'alice');

			expect(mockCache.deletePattern).toHaveBeenCalledWith(
				'participant:room:room-uuid-123*',
			);
		});

		it('should invalidate all room caches on delete', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockParticipantRepository.delete.mockResolvedValue({ affected: 1 });
			mockRoomRepository.delete.mockResolvedValue({ affected: 1 });

			await service.deleteRoom('room-uuid-123', 'alice');

			expect(mockCache.delete).toHaveBeenCalledWith('room:room-uuid-123');
			expect(mockCache.deletePattern).toHaveBeenCalledWith('rooms-list:*');
			expect(mockCache.deletePattern).toHaveBeenCalledWith(
				'participant:room:room-uuid-123*',
			);
		});
	});
});
