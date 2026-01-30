import { Test, TestingModule } from '@nestjs/testing';
import {
	NotFoundException,
	ForbiddenException,
	HttpException,
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
import {RateLimitGuard} from "@/guard/rate-limit.guard";

describe('ChatService', () => {
	let service: ChatService;

	const mockMessage: Message = {
		id: 'message-uuid-123',
		roomId: 'room-uuid-123',
		senderNickname: 'alice',
		content: 'Hello world',
		edited: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockRoom: Room = {
		id: 'room-uuid-123',
		name: 'Test Room',
		description: 'desc',
		creatorNickname: 'alice',
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const messageRepo = {
		findOne: jest.fn(),
		find: jest.fn(),
		save: jest.fn(),
		remove: jest.fn(),
		createQueryBuilder: jest.fn(),
	};

	const roomRepo = {
		findOne: jest.fn(),
	};

	const participantRepo = {
		exists: jest.fn(),
		createQueryBuilder: jest.fn(),
	};

	const cache = {
		get: jest.fn(),
		set: jest.fn(),
		delete: jest.fn(),
		deletePattern: jest.fn(),
		getOrSet: jest.fn(),
	};

	const rateLimiter = {
		isAllowed: jest.fn(),
	};

	const circuitBreaker = {
		execute: jest.fn((_name, fn) => fn()),
		getHealthStatus: jest.fn(),
	};

	const bulkhead = {
		execute: jest.fn((_cfg, fn) => fn()),
		getStatus: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ChatService,
				{ provide: getRepositoryToken(Message), useValue: messageRepo },
				{ provide: getRepositoryToken(Room), useValue: roomRepo },
				{ provide: getRepositoryToken(RoomParticipant), useValue: participantRepo },
				{ provide: CacheService, useValue: cache },
				{ provide: RateLimiterService, useValue: rateLimiter },
				{ provide: CircuitBreakerService, useValue: circuitBreaker },
				{ provide: BulkheadService, useValue: bulkhead },
			],
		})
			.compile();

		service = module.get(ChatService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('sendMessage', () => {
		it('should send message successfully (cache hit)', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			roomRepo.findOne.mockResolvedValue(mockRoom);
			cache.get.mockResolvedValueOnce(true);
			messageRepo.save.mockResolvedValue(mockMessage);

			const dto: SendMessageDto = {
				roomId: mockRoom.id,
				nickname: 'alice',
				content: 'Hello',
			};

			const result = await service.sendMessage(dto);

			expect(result).toEqual(mockMessage);
			expect(messageRepo.save).toHaveBeenCalled();
			expect(cache.deletePattern).toHaveBeenCalled();
		});

		it('should send message (cache miss → DB check)', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			roomRepo.findOne.mockResolvedValue(mockRoom);
			cache.get.mockResolvedValueOnce(null);
			participantRepo.exists.mockResolvedValue(true);
			messageRepo.save.mockResolvedValue(mockMessage);

			const result = await service.sendMessage({
				roomId: mockRoom.id,
				nickname: 'alice',
				content: 'Hello',
			});

			expect(result).toEqual(mockMessage);
			expect(participantRepo.exists).toHaveBeenCalled();
			expect(cache.set).toHaveBeenCalled();
		});

		it('should throw HttpException when rate limited', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: false, retryAfter: 5 });

			await expect(
				service.sendMessage({
					roomId: 'r1',
					nickname: 'alice',
					content: 'Hi',
				}),
			).rejects.toThrow(HttpException);
		});

		it('should throw NotFoundException if room not found', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			roomRepo.findOne.mockResolvedValue(null);

			await expect(
				service.sendMessage({
					roomId: 'bad-room',
					nickname: 'alice',
					content: 'Hi',
				}),
			).rejects.toThrow(NotFoundException);
		});

		it('should throw ForbiddenException if not participant', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			roomRepo.findOne.mockResolvedValue(mockRoom);
			cache.get.mockResolvedValueOnce(null);
			participantRepo.exists.mockResolvedValue(false);

			await expect(
				service.sendMessage({
					roomId: mockRoom.id,
					nickname: 'bob',
					content: 'Hi',
				}),
			).rejects.toThrow(ForbiddenException);
		});
	});

	describe('editLastMessage', () => {
		it('should edit last message successfully', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			cache.get.mockResolvedValueOnce(null);
			messageRepo.findOne.mockResolvedValue(mockMessage);
			messageRepo.save.mockResolvedValue({
				...mockMessage,
				content: 'Updated',
				edited: true,
			});

			const result = await service.editLastMessage({
				roomId: mockRoom.id,
				nickname: 'alice',
				content: 'Updated',
				messageId: mockMessage.id,
			});

			expect(result.edited).toBe(true);
			expect(result.content).toBe('Updated');
		});

		it('should throw NotFoundException if no message', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			cache.get.mockResolvedValueOnce(null);
			messageRepo.findOne.mockResolvedValue(null);

			await expect(
				service.editLastMessage({
					roomId: mockRoom.id,
					nickname: 'alice',
					content: 'Updated',
					messageId: mockMessage.id,
				}),
			).rejects.toThrow(NotFoundException);
		});
	});

	describe('deleteMessage', () => {
		it('should delete message successfully', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			cache.get.mockResolvedValueOnce(null);
			messageRepo.findOne.mockResolvedValue(mockMessage);
			messageRepo.remove.mockResolvedValue(mockMessage);

			await service.deleteMessage(mockMessage.id, 'alice');

			expect(messageRepo.remove).toHaveBeenCalledWith(mockMessage);
			expect(cache.delete).toHaveBeenCalled();
			expect(cache.deletePattern).toHaveBeenCalled();
		});

		it('should throw ForbiddenException if not owner', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			cache.get.mockResolvedValueOnce(null);
			messageRepo.findOne.mockResolvedValue(mockMessage);

			await expect(
				service.deleteMessage(mockMessage.id, 'bob'),
			).rejects.toThrow(ForbiddenException);
		});
	});

	describe('getMessages', () => {
		it('should return paginated messages', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			roomRepo.findOne.mockResolvedValue(mockRoom);

			const qb = {
				where: jest.fn().mockReturnThis(),
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn().mockResolvedValue([[mockMessage], 1]),
			};

			messageRepo.createQueryBuilder.mockImplementation((alias) => {
				expect(alias).toBe('m');
				return qb;
			});

			cache.getOrSet.mockImplementation(async (_k, fn) => fn());

			const result = await service.getMessages(mockRoom.id, 1, 50);

			expect(result.data.length).toBe(1);
			expect(result.meta.total).toBe(1);
		});

		it('should throw NotFoundException if room not found', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true });
			roomRepo.findOne.mockResolvedValue(null);
			cache.getOrSet.mockImplementation(async (_k, fn) => fn());

			await expect(
				service.getMessages('bad-room', 1, 50),
			).rejects.toThrow(NotFoundException);
		});
	});
});
