import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { UsersService } from '../users/users.service';
import { ChatEvent } from '@/types/chat.event.type';
import { Socket } from 'socket.io';
import {Message} from "@/modules/chat/entities/message.entity";

describe('ChatGateway', () => {
	let gateway: ChatGateway;
	let chatService: jest.Mocked<ChatService>;
	let usersService: jest.Mocked<UsersService>;

	const mockServer = {
		emit: jest.fn(),
		to: jest.fn().mockReturnThis(),
	};

	const createMockSocket = (nickname = 'alice'): Partial<Socket> =>
		({
			id: 'socket-1',
			data: { nickname },
			handshake: { auth: { nickname } },
			join: jest.fn(),
			leave: jest.fn(),
			emit: jest.fn(),
			disconnect: jest.fn(),
		}) as any;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ChatGateway,
				{
					provide: ChatService,
					useValue: {
						sendMessage: jest.fn(),
						editLastMessage: jest.fn(),
						deleteMessage: jest.fn(),
					},
				},
				{
					provide: UsersService,
					useValue: {
						updateConnectionStatus: jest.fn(),
					},
				},
			],
		}).compile();

		gateway = module.get(ChatGateway);
		chatService = module.get(ChatService);
		usersService = module.get(UsersService);

		// inject mocked socket.io server
		(gateway as any).server = mockServer;
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('should handle connection and broadcast USER_CONNECTED', async () => {
		const client = createMockSocket('alice');

		await gateway.handleConnection(client as Socket);

		expect(usersService.updateConnectionStatus).toHaveBeenCalledWith(
			'alice',
			true,
		);
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_CONNECTED,
			expect.objectContaining({
				nickname: 'alice',
			}),
		);
	});

	it('should disconnect if nickname missing', async () => {
		const client = {
			id: 'socket-1',
			handshake: {
				auth: {},
			},
			disconnect: jest.fn(),
			data: {},
		} as unknown as Socket;

		await gateway.handleConnection(client as Socket);

		expect(client.disconnect).toHaveBeenCalled();
	});

	it('should handle disconnect and broadcast USER_DISCONNECTED', async () => {
		const client = createMockSocket('alice');

		await gateway.handleDisconnect(client as Socket);

		expect(usersService.updateConnectionStatus).toHaveBeenCalledWith(
			'alice',
			false,
		);
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_DISCONNECTED,
			expect.objectContaining({
				nickname: 'alice',
			}),
		);
	});

	it('should join room', () => {
		const client = createMockSocket('alice');

		gateway.handleJoinRoom(
			{ roomId: 'room-1' },
			client as Socket,
		);

		expect(client.join).toHaveBeenCalledWith('room:room-1');
	});

	it('should leave room', () => {
		const client = createMockSocket('alice');

		gateway.handleLeaveRoom(
			{ roomId: 'room-1' },
			client as Socket,
		);

		expect(client.leave).toHaveBeenCalledWith('room:room-1');
	});

	it('should send message and emit MESSAGE_NEW', async () => {
		const client = createMockSocket('alice');

		const message: any = {
			id: 'msg-1',
			roomId: 'room-1',
			nickname: 'alice',
			content: 'hello',
		};

		chatService.sendMessage.mockResolvedValue(message);

		await gateway.handleSendMessage(
			{ roomId: 'room-1', content: 'hello' } as any,
			client as Socket,
		);

		expect(chatService.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				roomId: 'room-1',
				nickname: 'alice',
			}),
		);

		expect(mockServer.to).toHaveBeenCalledWith('room:room-1');
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.MESSAGE_NEW,
			message,
		);
	});

	it('should emit ERROR when sendMessage fails', async () => {
		const client = createMockSocket('alice');

		chatService.sendMessage.mockRejectedValue(
			new Error('send failed'),
		);

		await gateway.handleSendMessage(
			{ roomId: 'room-1', content: 'hello' } as any,
			client as Socket,
		);

		expect(client.emit).toHaveBeenCalledWith(
			ChatEvent.ERROR,
			expect.objectContaining({
				code: 'MESSAGE_SEND_ERROR',
			}),
		);
	});

	it('should edit message and emit MESSAGE_EDITED', async () => {
		const client = createMockSocket('alice');

		const updated: any = { id: 'msg-1', content: 'edited' };
		chatService.editLastMessage.mockResolvedValue(updated);

		await gateway.handleEditMessage(
			{ roomId: 'room-1', content: 'edited' } as any,
			client as Socket,
		);

		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.MESSAGE_EDITED,
			updated,
		);
	});

	// ================= DELETE MESSAGE =================

	it('should delete message and emit MESSAGE_DELETED', async () => {
		const client = createMockSocket('alice');

		await gateway.handleDeleteMessage(
			{ messageId: 'msg-1' } as any,
			client as Socket,
		);

		expect(chatService.deleteMessage).toHaveBeenCalledWith(
			'msg-1',
			'alice',
		);

		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.MESSAGE_DELETED,
			{ messageId: 'msg-1' },
		);
	});

	// ================= TYPING =================

	it('should emit USER_TYPING', () => {
		const client = createMockSocket('alice');

		gateway.handleUserTyping(
			{ roomId: 'room-1' },
			client as Socket,
		);

		expect(mockServer.to).toHaveBeenCalledWith('room:room-1');
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_TYPING,
			expect.objectContaining({
				nickname: 'alice',
			}),
		);
	});

	it('should emit USER_STOP_TYPING', () => {
		const client = createMockSocket('alice');

		gateway.handleUserStopTyping(
			{ roomId: 'room-1' },
			client as Socket,
		);

		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_STOP_TYPING,
			expect.objectContaining({
				nickname: 'alice',
			}),
		);
	});
});
