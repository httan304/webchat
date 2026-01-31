import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { UsersService } from '../users/users.service';
import { RoomsService } from '../rooms/rooms.service';
import { ChatEvent } from '@/types/chat.event.type';
import { Socket } from 'socket.io';

describe('ChatGateway', () => {
	let gateway: ChatGateway;
	let chatService: jest.Mocked<ChatService>;
	let usersService: jest.Mocked<UsersService>;
	let roomService: jest.Mocked<RoomsService>;

	const mockServer = {
		emit: jest.fn(),
		to: jest.fn().mockReturnThis(),
	};

	const createMockSocket = (nickname?: string): Partial<Socket> =>
		({
			id: 'socket-1',
			data: {},
			handshake: {
				auth: nickname ? { nickname } : {},
				query: {},
				headers: {},
			},
			rooms: new Set(),
			join: jest.fn(function (room) {
				this.rooms.add(room);
			}),
			leave: jest.fn(function (room) {
				this.rooms.delete(room);
			}),
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
				{
					provide: RoomsService,
					useValue: {
						joinRoom: jest.fn(),
						leaveRoom: jest.fn(),
					},
				},
			],
		}).compile();

		gateway = module.get(ChatGateway);
		chatService = module.get(ChatService);
		usersService = module.get(UsersService);
		roomService = module.get(RoomsService);

		(gateway as any).server = mockServer;
	});

	afterEach(() => jest.clearAllMocks());

	it('should accept valid nickname and emit USER_CONNECTED', async () => {
		const client = createMockSocket('alice');

		await gateway.handleConnection(client as Socket);

		expect(usersService.updateConnectionStatus).toHaveBeenCalledWith('alice', true);
		expect(client.data.nickname).toBe('alice');

		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_CONNECTED,
			expect.objectContaining({ nickname: 'alice' }),
		);
	});

	it('should reject connection if nickname missing', async () => {
		const client = createMockSocket();

		await gateway.handleConnection(client as Socket);

		expect(client.emit).toHaveBeenCalledWith(
			ChatEvent.ERROR,
			expect.objectContaining({ code: 'AUTH_REQUIRED' }),
		);
		expect(client.disconnect).toHaveBeenCalled();
	});

	it('should reject invalid nickname', async () => {
		const client = createMockSocket('@@@');

		await gateway.handleConnection(client as Socket);

		expect(client.emit).toHaveBeenCalledWith(
			ChatEvent.ERROR,
			expect.objectContaining({ code: 'INVALID_NICKNAME' }),
		);
		expect(client.disconnect).toHaveBeenCalled();
	});

	it('should handle disconnect and emit USER_DISCONNECTED', async () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		await gateway.handleDisconnect(client as Socket);

		expect(usersService.updateConnectionStatus).toHaveBeenCalledWith('alice', false);
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_DISCONNECTED,
			expect.objectContaining({ nickname: 'alice' }),
		);
	});

	it('should join room and emit user_joined_room', async () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		await gateway.handleJoinRoom({ roomId: 'room-1' }, client as Socket);

		expect(roomService.joinRoom).toHaveBeenCalledWith('room-1', 'alice');
		expect(client.join).toHaveBeenCalledWith('room:room-1');
		expect(mockServer.to).toHaveBeenCalledWith('room:room-1');
	});

	it('should leave room and emit user_left_room', async () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';
		client.rooms!.add('room:room-1');

		await gateway.handleLeaveRoom({ roomId: 'room-1' }, client as Socket);

		expect(roomService.leaveRoom).toHaveBeenCalledWith('room-1', 'alice');
		expect(client.leave).toHaveBeenCalledWith('room:room-1');
		expect(mockServer.to).toHaveBeenCalledWith('room:room-1');
	});

	it('should send message and emit MESSAGE_NEW', async () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		chatService.sendMessage.mockResolvedValue({
			content: 'hello',
		} as any);

		await gateway.handleSendMessage(
			{ roomId: 'room-1', content: 'hello' } as any,
			client as Socket,
		);

		expect(chatService.sendMessage).toHaveBeenCalled();
		expect(mockServer.to).toHaveBeenCalledWith('room:room-1');
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.MESSAGE_NEW,
			expect.objectContaining({
				nickname: 'alice',
				content: 'hello',
			}),
		);
	});

	it('should emit ERROR when send message fails', async () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		chatService.sendMessage.mockRejectedValue(new Error('fail'));

		await gateway.handleSendMessage(
			{ roomId: 'room-1', content: 'hello' } as any,
			client as Socket,
		);

		expect(client.emit).toHaveBeenCalledWith(
			ChatEvent.ERROR,
			expect.objectContaining({ code: 'MESSAGE_SEND_ERROR' }),
		);
	});

	it('should edit message and emit MESSAGE_EDITED', async () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		const updated = { id: 'm1', content: 'edited' };
		chatService.editLastMessage.mockResolvedValue(updated as any);

		await gateway.handleEditMessage(
			{ messageId: 'm1', content: 'edited' } as any,
			client as Socket,
		);

		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.MESSAGE_EDITED,
			updated,
		);
	});

	it('should delete message and emit MESSAGE_DELETED', async () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		await gateway.handleDeleteMessage(
			{ messageId: 'm1' } as any,
			client as Socket,
		);

		expect(chatService.deleteMessage).toHaveBeenCalledWith('m1', 'alice');
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.MESSAGE_DELETED,
			expect.objectContaining({
				messageId: 'm1',
				deletedBy: 'alice',
			}),
		);
	});

	it('should emit USER_TYPING', () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		gateway.handleUserTyping({ roomId: 'room-1' }, client as Socket);

		expect(mockServer.to).toHaveBeenCalledWith('room:room-1');
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_TYPING,
			expect.objectContaining({ nickname: 'alice' }),
		);
	});

	it('should emit USER_STOP_TYPING', () => {
		const client = createMockSocket('alice');
		client.data.nickname = 'alice';

		gateway.handleUserStopTyping({ roomId: 'room-1' }, client as Socket);

		expect(mockServer.to).toHaveBeenCalledWith('room:room-1');
		expect(mockServer.emit).toHaveBeenCalledWith(
			ChatEvent.USER_STOP_TYPING,
			expect.objectContaining({ nickname: 'alice' }),
		);
	});
});
