import { Test, TestingModule } from '@nestjs/testing';
import {
	NotFoundException,
	ForbiddenException,
	HttpException,
	HttpStatus,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from './chat.service';
import { Message } from './entities/message.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomParticipant } from '../rooms/entities/room-participant.entity';
import { SendMessageDto, EditMessageDto } from './dto/chat.dto';

import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';

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
		description: null,
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
		createQueryBuilder: jest.fn(() => ({
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			skip: jest.fn().mockReturnThis(),
			take: jest.fn().mockReturnThis(),
			getManyAndCount: jest.fn(),
			getOne: jest.fn(),
		})),
	};

	const mockRoomRepository = {
		findOne: jest.fn(),
	};

	const mockParticipantRepository = {
		findOne: jest.fn(),
	};

	const mockCircuitBreaker = {
		execute: jest.fn((name, fn, fallback) => fn()),
	};

	const mockCache = {
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

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockParticipantRepository.findOne.mockResolvedValue(mockParticipant);
			mockMessageRepository.create.mockReturnValue(mockMessage);
			mockMessageRepository.save.mockResolvedValue(mockMessage);

			const result = await service.sendMessage(sendMessageDto);

			expect(result).toEqual(mockMessage);
			expect(mockRateLimiter.isAllowed).toHaveBeenCalledWith(
				'chat-send:alice:room-uuid-123',
				{ maxRequests: 5, windowMs: 10_000 },
			);
			expect(mockMessageRepository.save).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
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
			const sendMessageDto: SendMessageDto = {
				roomId: 'nonexistent',
				nickname: 'alice',
				content: 'Hello',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(null);

			await expect(service.sendMessage(sendMessageDto)).rejects.toThrow(
				NotFoundException,
			);
		});

		it('should throw ForbiddenException if not a participant', async () => {
			const sendMessageDto: SendMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'bob',
				content: 'Hello',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockRoomRepository.findOne.mockResolvedValue(mockRoom);
			mockParticipantRepository.findOne.mockResolvedValue(null);

			await expect(service.sendMessage(sendMessageDto)).rejects.toThrow(
				ForbiddenException,
			);
		});
	});

	describe('editLastMessage', () => {
		it('should edit last message successfully', async () => {
			const editMessageDto: EditMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'alice',
				content: 'Updated content',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });

			const qb = mockMessageRepository.createQueryBuilder();
			qb.getOne.mockResolvedValue(mockMessage);

			mockMessageRepository.save.mockResolvedValue({
				...mockMessage,
				content: 'Updated content',
				edited: true,
			});

			const result = await service.editLastMessage(editMessageDto);

			expect(result.content).toBe('Updated content');
			expect(result.edited).toBe(true);
			expect(mockMessageRepository.save).toHaveBeenCalled();
			expect(mockCache.delete).toHaveBeenCalled();
		});

		it('should throw NotFoundException if no message found', async () => {
			const editMessageDto: EditMessageDto = {
				roomId: 'room-uuid-123',
				nickname: 'alice',
				content: 'Updated',
			};

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });

			const qb = mockMessageRepository.createQueryBuilder();
			qb.getOne.mockResolvedValue(null);

			await expect(service.editLastMessage(editMessageDto)).rejects.toThrow(
				NotFoundException,
			);
		});
	});

	describe('deleteMessage', () => {
		it('should delete message successfully', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockMessageRepository.findOne.mockResolvedValue(mockMessage);
			mockMessageRepository.delete.mockResolvedValue({ affected: 1 });

			await service.deleteMessage('message-uuid-123', 'alice');

			expect(mockMessageRepository.delete).toHaveBeenCalledWith(
				'message-uuid-123',
			);
			expect(mockCache.delete).toHaveBeenCalled();
			expect(mockCache.deletePattern).toHaveBeenCalled();
		});

		it('should throw NotFoundException if message not found', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockMessageRepository.findOne.mockResolvedValue(null);

			await expect(
				service.deleteMessage('nonexistent', 'alice'),
			).rejects.toThrow(NotFoundException);
		});

		it('should throw ForbiddenException if not message owner', async () => {
			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockMessageRepository.findOne.mockResolvedValue(mockMessage);

			await expect(
				service.deleteMessage('message-uuid-123', 'bob'),
			).rejects.toThrow(ForbiddenException);
		});
	});

	describe('getMessages', () => {
		it('should return paginated messages', async () => {
			const messages = [mockMessage];

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(async (key, fn) => fn());

			const qb = mockMessageRepository.createQueryBuilder();
			qb.getManyAndCount.mockResolvedValue([messages, 1]);

			const result = await service.getMessages('room-uuid-123', 1, 50);

			expect(result.data).toEqual(messages);
			expect(result.meta.total).toBe(1);
		});

		it('should use cache', async () => {
			const messages = [mockMessage];
			const mockResult = {
				data: messages,
				meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
			};

			mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			mockCache.getOrSet.mockImplementation(() => mockResult);

			const result = await service.getMessages('room-uuid-123', 1, 50);

			expect(result).toEqual(mockResult);
			expect(mockMessageRepository.createQueryBuilder).not.toHaveBeenCalled();
		});
	});
});
