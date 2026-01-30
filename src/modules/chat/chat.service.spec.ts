import {Test, TestingModule} from '@nestjs/testing';
import {
	NotFoundException,
	ForbiddenException,
	HttpException,
} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {ChatService} from './chat.service';
import {Message} from './entities/message.entity';
import {Room} from '../rooms/entities/room.entity';
import {RoomParticipant} from '../rooms/entities/room-participant.entity';
import {SendMessageDto, EditMessageDto} from './dto/chat.dto';

import {CircuitBreakerService} from '@/services/circuit-breaker.service';
import {CacheService} from '@/services/cache.service';
import {RateLimiterService} from '@/services/rate-limiter.service';
import {BulkheadService} from '@/services/bulkhead.service';

describe('ChatService', () => {
	let service: ChatService;
	let messageRepository: any;
	let roomRepository: any;
	let participantRepository: any;
	let circuitBreaker: any;
	let cache: any;
	let rateLimiter: any;
	let bulkhead: any;

	const mockMessage: Message = {
		id: 'message-uuid-123',
		roomId: 'room-uuid-123',
		senderNickname: 'alice',
		content: 'Hello world',
		edited: false,
		createdAt: new Date('2026-01-29'),
		updatedAt: new Date('2026-01-29'),
	};

	const mockRoom: Room = {
		id: 'room-uuid-123',
		name: 'Test Room',
		description: 'Test Description',
		creatorNickname: 'alice',
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockParticipant: RoomParticipant = {
		id: 'participant-uuid-123',
		roomId: 'room-uuid-123',
		nickname: 'alice',
		joinedAt: new Date(),
	};

	const mockMessageRepository = {
		findOne: jest.fn(),
		find: jest.fn(),
		create: jest.fn(),
		save: jest.fn(),
		delete: jest.fn(),
		remove: jest.fn(),
		exists: jest.fn(),
		createQueryBuilder: jest.fn(() => ({
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			skip: jest.fn().mockReturnThis(),
			take: jest.fn().mockReturnThis(),
			getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
			getOne: jest.fn(),
		})),
	};

	const mockRoomRepository = {
		findOne: jest.fn(),
	};

	const mockParticipantRepository = {
		findOne: jest.fn(),
		exists: jest.fn(),
	};

	const mockCircuitBreaker = {
		execute: jest.fn((name, fn, fallback) => fn()),
	};

	const mockCache = {
		get: jest.fn().mockResolvedValue(null),
		set: jest.fn().mockResolvedValue(undefined),
		delete: jest.fn().mockResolvedValue(undefined),
		deletePattern: jest.fn().mockResolvedValue(undefined),
		getOrSet: jest.fn((key, fn, ttl) => fn()),
		exists: jest.fn().mockResolvedValue(false),
	};

	const mockRateLimiter = {
		isAllowed: jest.fn().mockResolvedValue({allowed: true}),
	};

	const mockBulkhead = {
		execute: jest.fn((config, fn) => fn()),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ChatService,
				{
					provide: getRepositoryToken(Message),
					useValue: mockMessageRepository,
				},
				{
					provide: getRepositoryToken(Room),
					useValue: mockRoomRepository,
				},
				{
					provide: getRepositoryToken(RoomParticipant),
					useValue: mockParticipantRepository,
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
		}).compile();

		service = module.get<ChatService>(ChatService);
		messageRepository = module.get(getRepositoryToken(Message));
		roomRepository = module.get(getRepositoryToken(Room));
		participantRepository = module.get(getRepositoryToken(RoomParticipant));
		circuitBreaker = module.get(CircuitBreakerService);
		cache = module.get(CacheService);
		rateLimiter = module.get(RateLimiterService);
		bulkhead = module.get(BulkheadService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('sendMessage', () => {

		it('should send message successfully', async () => {
			const sendMessageDto: SendMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'alice',
				content: 'Hello world',
			};
			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockCache.get.mockResolvedValueOnce(true);

			mockMessageRepository.create.mockReturnValue(mockMessage);
			mockMessageRepository.save.mockResolvedValue(mockMessage);

			const result = await service.sendMessage(sendMessageDto);

			expect(result).toEqual(mockMessage);
			expect(mockRateLimiter.isAllowed).toHaveBeenCalled();
			expect(mockMessageRepository.save).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should send message with participant from database (cache miss)', async () => {
			const sendMessageDto: SendMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'alice',
				content: 'Hello world',
			};
			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockCache.get.mockResolvedValueOnce(null); // Cache miss
			mockParticipantRepository.exists.mockResolvedValue(true);
			mockMessageRepository.create.mockReturnValue(mockMessage);
			mockMessageRepository.save.mockResolvedValue(mockMessage);

			const result = await service.sendMessage(sendMessageDto);

			expect(result).toEqual(mockMessage);
			expect(mockParticipantRepository.exists).toHaveBeenCalledWith({
				where: {roomId: 'room-uuid-123', nickname: 'alice'},
			});
			expect(mockCache.set).toHaveBeenCalled(); // Cache the result
		});

		it('should throw HttpException when rate limited', async () => {
			const sendMessageDto: SendMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'alice',
				content: 'Hello world',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({
				allowed: false,
				retryAfter: 5,
			});

			await expect(service.sendMessage(sendMessageDto)).rejects.toThrow(
				HttpException,
			);
			expect(mockMessageRepository.save).not.toHaveBeenCalled();
		});

		it('should throw NotFoundException if room not found', async () => {
			const messageRoomNotfound: SendMessageDto = {
				roomId: 'notfound1111',
				nickname: 'noname',
				content: 'Hello',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockCache.get.mockResolvedValueOnce(null);
			mockRoomRepository.findOne.mockResolvedValue(null);

			await expect(service.sendMessage(messageRoomNotfound)).rejects.toThrow(
				NotFoundException,
			);
		});

		it('should throw ForbiddenException if not a participant', async () => {
			const sendMessageDto: SendMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'bob',
				content: 'Hello',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockCache.get.mockResolvedValueOnce(null); // Cache miss
			mockParticipantRepository.exists.mockResolvedValue(false);

			await expect(service.sendMessage(sendMessageDto)).rejects.toThrow(
				ForbiddenException,
			);

			expect(mockMessageRepository.save).not.toHaveBeenCalled();
		});

		xit('should use cached participant check', async () => {
			const sendMessageDto: SendMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'tan',
				content: 'Hello',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockRoomRepository.findOne.mockResolvedValue({id: 'room-uuid-123'});
			mockCache.get.mockResolvedValue(true);
			mockMessageRepository.save.mockResolvedValue(mockMessage);

			await service.sendMessage(sendMessageDto);
			expect(mockParticipantRepository.exists).not.toHaveBeenCalled();
			expect(mockMessageRepository.save).toHaveBeenCalled();
		});
	})

	describe('editLastMessage', () => {
		xit('should edit last message successfully', async () => {
			const dto: EditMessageDto = {
				messageId: 'message-uuid-123',
				roomId: 'room-uuid-123',
				nickname: 'alice',
				content: 'Updated',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});

			// ✅ FIX: Create fresh QB mock BEFORE calling method
			const qb = {
				where: jest.fn().mockReturnThis(),
				andWhere: jest.fn().mockReturnThis(),
				orderBy: jest.fn().mockReturnThis(),
				getOne: jest.fn().mockResolvedValue(mockMessage),
			};
			mockMessageRepository.createQueryBuilder.mockReturnValue(qb);

			mockMessageRepository.save.mockResolvedValue({
				...mockMessage,
				content: 'Updated',
				edited: true,
			});

			const result = await service.editLastMessage(dto);

			expect(result.content).toBe('Updated');
			expect(result.edited).toBe(true);
		});

		it('should throw NotFoundException if no message found', async () => {
			const editMessageDto: EditMessageDto = {
				messageId: 'message-uuid-123',
				roomId: 'room-uuid-123',
				nickname: 'alice',
				content: 'Updated',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});

			const qb = mockMessageRepository.createQueryBuilder();
			qb.getOne.mockResolvedValue(null);

			await expect(service.editLastMessage(editMessageDto)).rejects.toThrow(
				NotFoundException,
			);
		});
	});

	describe('deleteMessage', () => {
		it('should delete message successfully', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockMessageRepository.findOne.mockResolvedValue(mockMessage);
			mockMessageRepository.remove.mockResolvedValue(mockMessage);

			await service.deleteMessage('message-uuid-123', 'alice');

			expect(mockMessageRepository.remove).toHaveBeenCalledWith(mockMessage);
			expect(mockCache.delete).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw NotFoundException if message not found', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockMessageRepository.findOne.mockResolvedValue(null);

			await expect(
				service.deleteMessage('nonexistent', 'alice'),
			).rejects.toThrow(NotFoundException);
		});

		it('should throw ForbiddenException if not message owner', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockMessageRepository.findOne.mockResolvedValue(mockMessage);

			await expect(
				service.deleteMessage('message-uuid-123', 'bob'),
			).rejects.toThrow(ForbiddenException);
		});
	});

	describe('getMessages', () => {
		it('should return paginated messages', async () => {
			const messages = [mockMessage];

			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			const qb = {
				where: jest.fn().mockReturnThis(),
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn().mockResolvedValue([messages, 1]),
			};
			mockMessageRepository.createQueryBuilder.mockReturnValue(qb);
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());

			const result = await service.getMessages('room-uuid-123', 1, 50);

			expect(result.data).toEqual(messages);
			expect(result.meta.total).toBe(1);
		});

		it('should use cache for messages', async () => {
			const mockResult = {
				data: [mockMessage],
				meta: {total: 1, page: 1, limit: 50, totalPages: 1},
			};

			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockCache.getOrSet.mockImplementation(() => mockResult);

			const result = await service.getMessages('room-uuid-123', 1, 50);

			expect(result).toEqual(mockResult);
			expect(mockMessageRepository.createQueryBuilder).not.toHaveBeenCalled();
		});


		it('should sanitize pagination parameters', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			const qb = {
				where: jest.fn().mockReturnThis(),
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
			};
			mockMessageRepository.createQueryBuilder.mockReturnValue(qb);
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());

			await service.getMessages('room-uuid-123', -1, 999);

			expect(qb.skip).toHaveBeenCalledWith(0);
			expect(qb.take).toHaveBeenCalledWith(100);
		});

		it('should throw NotFoundException if room not found', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({allowed: true});
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());
			mockRoomRepository.findOne.mockResolvedValue(null);

			await expect(service.getMessages('roomnotfound', 1, 50)).rejects.toThrow(NotFoundException);
		});
	});
});
