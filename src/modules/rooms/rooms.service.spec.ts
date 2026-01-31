import { Test, TestingModule } from '@nestjs/testing';
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RoomsService } from './rooms.service';
import { Room } from './entities/room.entity';
import { RoomParticipant } from './entities/room-participant.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';
import {
	CACHED_ROOM_KEY,
	CACHED_ROOM_PARTICIPANTS,
} from '@/types/cached-key.type';

describe('RoomsService', () => {
	let service: RoomsService;
	let roomRepo: any;
	let userRepo: any;
	let participantRepo: any;
	let cache: any;
	let rateLimiter: any;

	const roomId = '550e8400-e29b-41d4-a716-446655440000';

	const mockRoom: Room = {
		id: roomId,
		name: 'Test Room',
		creatorNickname: 'alice',
		description: 'desc',
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockUser: User = {
		id: 'user-1',
		nickname: 'alice',
		isConnected: true,
		lastSeen: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockParticipant: RoomParticipant = {
		id: 'p1',
		roomId,
		nickname: 'alice',
		joinedAt: new Date(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				RoomsService,
				{ provide: getRepositoryToken(Room), useValue: mockRepo() },
				{ provide: getRepositoryToken(User), useValue: mockRepo() },
				{ provide: getRepositoryToken(RoomParticipant), useValue: mockRepo() },
				{ provide: UsersService, useValue: {} },
				{
					provide: CircuitBreakerService,
					useValue: { execute: jest.fn((_, fn) => fn()) },
				},
				{
					provide: BulkheadService,
					useValue: { execute: jest.fn((_, fn) => fn()) },
				},
				{
					provide: RateLimiterService,
					useValue: { isAllowed: jest.fn() },
				},
				{
					provide: CacheService,
					useValue: {
						get: jest.fn(),
						set: jest.fn(),
						delete: jest.fn(),
						deletePattern: jest.fn(),
					},
				},
			],
		}).compile();

		service = module.get(RoomsService);
		roomRepo = module.get(getRepositoryToken(Room));
		userRepo = module.get(getRepositoryToken(User));
		participantRepo = module.get(getRepositoryToken(RoomParticipant));
		cache = module.get(CacheService);
		rateLimiter = module.get(RateLimiterService);
	});

	afterEach(() => jest.clearAllMocks());

	const allowRate = () =>
		rateLimiter.isAllowed.mockResolvedValue({ allowed: true });

	describe('createRoom', () => {
		it('should create room and auto join owner', async () => {
			allowRate();
			userRepo.findOne.mockResolvedValue(mockUser);
			roomRepo.findOne.mockResolvedValue(null);
			roomRepo.save.mockResolvedValue(mockRoom);
			participantRepo.save.mockResolvedValue(mockParticipant);

			const result = await service.createRoom(
				'Test Room',
				'alice',
				'desc',
			);

			expect(result).toEqual(mockRoom);
			expect(cache.deletePattern).toHaveBeenCalledWith(
				`${CACHED_ROOM_KEY.ROOM_LIST}*`,
			);
		});

		it('should throw ConflictException if name exists', async () => {
			allowRate();
			userRepo.findOne.mockResolvedValue(mockUser);
			roomRepo.findOne.mockResolvedValue(mockRoom);

			await expect(
				service.createRoom('Test Room', 'alice'),
			).rejects.toThrow(ConflictException);
		});

		it('should throw HttpException if rate limited', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: false });

			await expect(
				service.createRoom('Test', 'alice'),
			).rejects.toThrow(HttpException);
		});
	});

	describe('joinRoom', () => {
		it('should join room', async () => {
			roomRepo.findOne.mockResolvedValue({ id: roomId });
			userRepo.findOne.mockResolvedValue(mockUser);
			participantRepo.findOne.mockResolvedValue(null);

			await service.joinRoom(roomId, 'alice');

			expect(participantRepo.save).toHaveBeenCalled();
			expect(cache.deletePattern).toHaveBeenCalledWith(
				`${CACHED_ROOM_PARTICIPANTS.PARTICIPANT_LIST}:${roomId}*`,
			);
		});

		it('should be idempotent', async () => {
			roomRepo.findOne.mockResolvedValue({ id: roomId });
			userRepo.findOne.mockResolvedValue(mockUser);
			participantRepo.findOne.mockResolvedValue(mockParticipant);

			await service.joinRoom(roomId, 'alice');

			expect(participantRepo.save).not.toHaveBeenCalled();
		});

		it('should throw BadRequestException for invalid roomId', async () => {
			await expect(
				service.joinRoom('invalid-id', 'alice'),
			).rejects.toThrow(BadRequestException);
		});

		it('should throw NotFoundException if room not found', async () => {
			roomRepo.findOne.mockResolvedValue(null);

			await expect(
				service.joinRoom(roomId, 'alice'),
			).rejects.toThrow(NotFoundException);
		});
	});

	describe('leaveRoom', () => {
		it('should remove participant', async () => {
			roomRepo.findOne.mockResolvedValue({
				id: roomId,
				creatorNickname: 'bob',
			});
			userRepo.findOne.mockResolvedValue(mockUser);
			participantRepo.findOne.mockResolvedValue(mockParticipant);

			await service.leaveRoom(roomId, 'alice');

			expect(participantRepo.delete).toHaveBeenCalledWith({
				roomId,
				nickname: 'alice',
			});
		});

		it('should forbid creator leaving', async () => {
			roomRepo.findOne.mockResolvedValue({
				id: roomId,
				creatorNickname: 'alice',
			});

			await expect(
				service.leaveRoom(roomId, 'alice'),
			).rejects.toThrow(ForbiddenException);
		});
	});
	describe('getParticipants', () => {
		it('should return participants with isOwner', async () => {
			roomRepo.findOne.mockResolvedValue(mockRoom);
			participantRepo.find.mockResolvedValue([mockParticipant]);

			const res = await service.getParticipants(roomId, 'alice');

			expect(res[0]).toMatchObject({
				nickname: 'alice',
				isOwner: true,
			});
		});

		it('should return empty array if not owner', async () => {
			roomRepo.findOne.mockResolvedValue({
				...mockRoom,
				creatorNickname: 'alice',
			});

			const result = await service.getParticipants(roomId, 'bob');

			expect(result).toEqual([]);
		});
	});

	describe('getMyRooms', () => {
		it('should return created + joined rooms', async () => {
			roomRepo.find.mockResolvedValue([mockRoom]);
			participantRepo.createQueryBuilder = jest.fn(() => ({
				select: () => ({
					where: () => ({
						getRawMany: () => [{ roomId }],
					}),
				}),
			}));

			const result = await service.getMyRooms('alice');
			expect(result.length).toBe(1);
		});
	});

	describe('deleteRoom', () => {
		it('should delete room if owner', async () => {
			allowRate();
			roomRepo.findOne.mockResolvedValue(mockRoom);

			await service.deleteRoom(roomId, 'alice');

			expect(roomRepo.delete).toHaveBeenCalledWith(roomId);
			expect(participantRepo.delete).toHaveBeenCalledWith({ roomId });
		});
	});
});

function mockRepo() {
	return {
		findOne: jest.fn(),
		find: jest.fn(),
		save: jest.fn(),
		delete: jest.fn(),
		create: jest.fn(),
		createQueryBuilder: jest.fn(),
	};
}
