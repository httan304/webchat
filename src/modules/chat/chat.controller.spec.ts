import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Message } from './entities/message.entity';
import {RateLimitGuard} from "@/guard/rate-limit.guard";

describe('ChatController', () => {
	let controller: ChatController;
	let service: ChatService;

	const mockMessage: Message = {
		id: 'message-uuid-123',
		roomId: 'room-uuid-123',
		senderNickname: 'alice',
		content: 'Hello world',
		edited: false,
		createdAt: new Date('2026-01-29T10:00:00Z'),
		updatedAt: new Date('2026-01-29T10:00:00Z'),
	};

	const mockPaginatedResult = {
		data: [mockMessage],
		meta: {
			total: 100,
			page: 1,
			limit: 50,
			totalPages: 2,
		},
	};

	const mockChatService = {
		getMessages: jest.fn(),
		getMessagesChronological: jest.fn(),
		getMessagesSince: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ChatController],
			providers: [
				{
					provide: ChatService,
					useValue: mockChatService,
				},
			],
		}).overrideGuard(RateLimitGuard)
			.useValue({ canActivate: () => true })
			.compile();

		controller = module.get<ChatController>(ChatController);
		service = module.get<ChatService>(ChatService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('getMessages', () => {
		it('should return paginated messages (newest first)', async () => {
			mockChatService.getMessages.mockResolvedValue(mockPaginatedResult);

			const result = await controller.getMessages('room-uuid-123', 1, 50);

			expect(result).toEqual(mockPaginatedResult);
			expect(service.getMessages).toHaveBeenCalledWith(
				'room-uuid-123',
				1,
				50,
			);
		});

		it('should use default pagination values', async () => {
			mockChatService.getMessages.mockResolvedValue(mockPaginatedResult);

			await controller.getMessages('room-uuid-123', 1, 50);

			expect(service.getMessages).toHaveBeenCalledWith(
				'room-uuid-123',
				1,
				50,
			);
		});

		it('should handle different page numbers', async () => {
			const page2Result = {
				...mockPaginatedResult,
				meta: { ...mockPaginatedResult.meta, page: 2 },
			};
			mockChatService.getMessages.mockResolvedValue(page2Result);

			const result = await controller.getMessages('room-uuid-123', 2, 50);

			expect(result.meta.page).toBe(2);
			expect(service.getMessages).toHaveBeenCalledWith(
				'room-uuid-123',
				2,
				50,
			);
		});

		it('should propagate service errors', async () => {
			mockChatService.getMessages.mockRejectedValue(
				new Error('Room not found'),
			);

			await expect(
				controller.getMessages('nonexistent', 1, 50),
			).rejects.toThrow('Room not found');
		});
	});

	describe('getMessagesChronological', () => {
		it('should return chronological messages (oldest first)', async () => {
			mockChatService.getMessagesChronological.mockResolvedValue(
				mockPaginatedResult,
			);

			const result = await controller.getMessagesChronological(
				'room-uuid-123',
				1,
				50,
			);

			expect(result).toEqual(mockPaginatedResult);
			expect(service.getMessagesChronological).toHaveBeenCalledWith(
				'room-uuid-123',
				1,
				50,
			);
		});

		it('should handle pagination for chronological messages', async () => {
			mockChatService.getMessagesChronological.mockResolvedValue(
				mockPaginatedResult,
			);

			await controller.getMessagesChronological('room-uuid-123', 2, 100);

			expect(service.getMessagesChronological).toHaveBeenCalledWith(
				'room-uuid-123',
				2,
				100,
			);
		});

		it('should propagate service errors', async () => {
			mockChatService.getMessagesChronological.mockRejectedValue(
				new Error('Room not found'),
			);

			await expect(
				controller.getMessagesChronological('nonexistent', 1, 50),
			).rejects.toThrow('Room not found');
		});
	});

	describe('getMessagesSince', () => {
		it('should return messages since a timestamp', async () => {
			const messages = [mockMessage];
			mockChatService.getMessagesSince.mockResolvedValue(messages);

			const timestamp = '2026-01-29T10:00:00Z';
			const result = await controller.getMessagesSince(
				'room-uuid-123',
				timestamp,
				100,
			);

			expect(result).toEqual(messages);
			expect(service.getMessagesSince).toHaveBeenCalledWith(
				'room-uuid-123',
				new Date(timestamp),
				100,
			);
		});

		it('should use default limit of 100', async () => {
			mockChatService.getMessagesSince.mockResolvedValue([]);

			const timestamp = '2026-01-29T10:00:00Z';
			await controller.getMessagesSince('room-uuid-123', timestamp, 100);

			expect(service.getMessagesSince).toHaveBeenCalledWith(
				'room-uuid-123',
				expect.any(Date),
				100,
			);
		});

		it('should throw error for invalid timestamp', async () => {
			await expect(
				controller.getMessagesSince('room-uuid-123', 'invalid-date', 100),
			).rejects.toThrow('Invalid timestamp format');
		});

		it('should handle different timestamp formats', async () => {
			mockChatService.getMessagesSince.mockResolvedValue([]);

			// ISO 8601 format
			const timestamp = '2026-01-29T10:00:00.000Z';
			await controller.getMessagesSince('room-uuid-123', timestamp, 50);

			expect(service.getMessagesSince).toHaveBeenCalledWith(
				'room-uuid-123',
				new Date(timestamp),
				50,
			);
		});

		it('should propagate service errors', async () => {
			mockChatService.getMessagesSince.mockRejectedValue(
				new Error('Room not found'),
			);

			await expect(
				controller.getMessagesSince(
					'nonexistent',
					'2026-01-29T10:00:00Z',
					100,
				),
			).rejects.toThrow('Room not found');
		});
	});

	describe('getLatestMessages', () => {
		it('should return latest N messages without pagination meta', async () => {
			mockChatService.getMessages.mockResolvedValue(mockPaginatedResult);

			const result = await controller.getLatestMessages('room-uuid-123', 20);

			expect(result).toEqual(mockPaginatedResult.data);
			expect(service.getMessages).toHaveBeenCalledWith(
				'room-uuid-123',
				1,
				20,
			);
		});

		it('should use default limit of 20', async () => {
			mockChatService.getMessages.mockResolvedValue(mockPaginatedResult);

			await controller.getLatestMessages('room-uuid-123', 20);

			expect(service.getMessages).toHaveBeenCalledWith(
				'room-uuid-123',
				1,
				20,
			);
		});

		it('should handle custom limit', async () => {
			mockChatService.getMessages.mockResolvedValue(mockPaginatedResult);

			await controller.getLatestMessages('room-uuid-123', 10);

			expect(service.getMessages).toHaveBeenCalledWith(
				'room-uuid-123',
				1,
				10,
			);
		});
	});
});
