import { Test, TestingModule } from '@nestjs/testing';
import {
	NotFoundException,
	ForbiddenException,
	BadRequestException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatService } from './chat.service';
import { Message } from './entities/message.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomParticipant } from '../rooms/entities/room-participant.entity';

import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { BulkheadService } from '@/services/bulkhead.service';

describe('ChatService', () => {
	let service: ChatService;

	const roomId = '550e8400-e29b-41d4-a716-446655440000';
	const messageId = '550e8400-e29b-41d4-a716-446655440001';

	const mockRoom: Room = {
		id: roomId,
		name: 'room',
		description: '',
		creatorNickname: 'alice',
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockMessage: Message = {
		id: messageId,
		roomId,
		senderNickname: 'alice',
		content: 'hello',
		edited: false,
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
		execute: jest.fn((_cfg, task) => task()),
	};

	const bulkhead = {
		execute: jest.fn((_cfg, task) => task()),
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
		}).compile();

		service = module.get(ChatService);
	});

	afterEach(() => jest.clearAllMocks());

	/* ---------------- SEND MESSAGE ---------------- */

	describe('sendMessage', () => {
		it('should send message (participant cache hit)', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 5 });
			roomRepo.findOne.mockResolvedValue(mockRoom);
			cache.get.mockResolvedValue(true);
			messageRepo.save.mockResolvedValue(mockMessage);

			const res = await service.sendMessage({
				roomId,
				nickname: 'alice',
				content: 'hi',
			});

			expect(res).toEqual(mockMessage);
			expect(messageRepo.save).toHaveBeenCalled();
		});

		it('should send message (participant cache miss)', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 5 });
			roomRepo.findOne.mockResolvedValue(mockRoom);
			cache.get.mockResolvedValue(null);
			participantRepo.exists.mockResolvedValue(true);
			messageRepo.save.mockResolvedValue(mockMessage);

			const res = await service.sendMessage({
				roomId,
				nickname: 'alice',
				content: 'hi',
			});

			expect(res).toEqual(mockMessage);
			expect(participantRepo.exists).toHaveBeenCalled();
		});

		it('should throw NotFoundException if room not found', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 5 });
			roomRepo.findOne.mockResolvedValue(null);

			await expect(
				service.sendMessage({ roomId, nickname: 'a', content: 'x' }),
			).rejects.toThrow(NotFoundException);
		});

		it('should throw ForbiddenException if not participant', async () => {
			rateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 5 });
			roomRepo.findOne.mockResolvedValue(mockRoom);
			cache.get.mockResolvedValue(null);
			participantRepo.exists.mockResolvedValue(false);

			await expect(
				service.sendMessage({ roomId, nickname: 'bob', content: 'x' }),
			).rejects.toThrow(ForbiddenException);
		});

		it('should throw BadRequestException for invalid UUID', async () => {
			await expect(
				service.sendMessage({ roomId: 'bad', nickname: 'a', content: 'x' }),
			).rejects.toThrow(BadRequestException);
		});
	});

	describe('editLastMessage', () => {
		it('should edit last message', async () => {
			cache.get.mockResolvedValue(null);
			messageRepo.findOne.mockResolvedValue(mockMessage);
			messageRepo.save.mockResolvedValue({ ...mockMessage, edited: true });

			const res = await service.editLastMessage({
				roomId,
				messageId,
				nickname: 'alice',
				content: 'updated',
			});

			expect(res.edited).toBe(true);
		});

		it('should throw NotFoundException if no message', async () => {
			cache.get.mockResolvedValue(null);
			messageRepo.findOne.mockResolvedValue(null);

			await expect(
				service.editLastMessage({
					roomId,
					messageId,
					nickname: 'alice',
					content: 'x',
				}),
			).rejects.toThrow(NotFoundException);
		});

		it('should throw ForbiddenException if not owner', async () => {
			cache.get.mockResolvedValue({
				...mockMessage,
				senderNickname: 'bob',
			});

			await expect(
				service.editLastMessage({
					roomId,
					messageId,
					nickname: 'alice',
					content: 'x',
				}),
			).rejects.toThrow(ForbiddenException);
		});
	});

	describe('deleteMessage', () => {
		it('should delete message', async () => {
			cache.get.mockResolvedValue(null);
			messageRepo.findOne.mockResolvedValue(mockMessage);
			messageRepo.remove.mockResolvedValue(mockMessage);

			await service.deleteMessage(messageId, 'alice');

			expect(messageRepo.remove).toHaveBeenCalledWith(mockMessage);
		});

		it('should throw ForbiddenException if not owner', async () => {
			cache.get.mockResolvedValue(null);
			messageRepo.findOne.mockResolvedValue(mockMessage);

			await expect(
				service.deleteMessage(messageId, 'bob'),
			).rejects.toThrow(ForbiddenException);
		});
	});

	describe('getMessages', () => {
		it('should return paginated messages', async () => {
			rateLimiter.isAllowed.mockResolvedValue({allowed: true, remaining: 10});
			roomRepo.findOne.mockResolvedValue(mockRoom);

			const qb = {
				where: jest.fn().mockReturnThis(),
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn().mockResolvedValue([[mockMessage], 1]),
			};

			messageRepo.createQueryBuilder.mockReturnValue(qb);
			cache.getOrSet.mockImplementation((_k, fn) => fn());

			const res = await service.getMessages(roomId, 1, 10);

			expect(res.data.length).toBe(1);
			expect(res.meta.total).toBe(1);
		});

		it('should return empty result if room not found (fallback)', async () => {
			const roomId = '550e8400-e29b-41d4-a716-446655440001';

			rateLimiter.isAllowed.mockResolvedValue({
				allowed: true,
				remaining: 10,
			});

			roomRepo.findOne.mockResolvedValue(null);

			cache.getOrSet.mockImplementation((_k, fn) => fn());

			const result = await service.getMessages(roomId, 1, 10);

			expect(result).toEqual({
				data: [],
				meta: {
					total: 0,
					page: 1,
					limit: 10,
					totalPages: 0,
				},
			});
		});
	})
});
