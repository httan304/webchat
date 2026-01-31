import {
	WebSocketGateway,
	SubscribeMessage,
	MessageBody,
	ConnectedSocket,
	OnGatewayConnection,
	OnGatewayDisconnect,
	WebSocketServer,
} from '@nestjs/websockets';
import {Socket, Server} from 'socket.io';
import {
	Logger,
	Injectable,
} from '@nestjs/common';
import {ChatService} from './chat.service';
import {RoomsService} from "@/modules/rooms/rooms.service";
import {
	SendMessageDto,
	EditMessageDto,
	DeleteMessageDto,
} from './dto/chat.dto';
import {UsersService} from '../users/users.service';
import {ChatEvent} from '@/types/chat.event.type';


@Injectable()
@WebSocketGateway({
	namespace: '/chat',
	cors: {
		origin: '*',
		credentials: true,
	},
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger(ChatGateway.name);

	@WebSocketServer()
	server: Server;

	constructor(
		private readonly chatService: ChatService,
		private readonly roomService: RoomsService,
		private readonly usersService: UsersService,
	) {
	}

	/**
	 * Handle new socket connection
	 * Supports multiple auth methods:
	 * 1. Auth object: { auth: { nickname: 'alice' } }
	 * 2. Query params: ?nickname=alice
	 * 3. Headers: { nickname: 'alice' }
	 */
	async handleConnection(client: Socket): Promise<void> {
		this.logger.log('Connection attempt', {
			socketId: client.id,
			query: client.handshake.query,
			auth: client.handshake.auth,
		});
		try {
			// Extract nickname from multiple sources
			const nickname = this.extractNickname(client);

			if (!nickname) {
				this.logger.warn(`Connection rejected: No nickname provided (${client.id})`);
				client.emit(ChatEvent.ERROR, {
					message: 'Nickname is required for authentication',
					code: 'AUTH_REQUIRED',
				});
				client.disconnect();
				return;
			}

			// Validate nickname format
			if (!this.isValidNickname(nickname)) {
				this.logger.warn(
					`Connection rejected: Invalid nickname "${nickname}" (${client.id})`,
				);
				client.emit(ChatEvent.ERROR, {
					message: 'Invalid nickname format (3-20 chars, alphanumeric only)',
					code: 'INVALID_NICKNAME',
				});
				client.disconnect();
				return;
			}

			// Update user connection status in database
			await this.usersService.updateConnectionStatus(nickname, true);

			// Store user data in socket session
			client.data.nickname = nickname;
			client.data.userId = nickname;
			client.data.connectedAt = Date.now();

			this.logger.log(`Connected: ${nickname} (${client.id})`);

			// Broadcast user connected event to all clients
			this.server.emit(ChatEvent.USER_CONNECTED, {
				nickname,
				timestamp: Date.now(),
			});

			// Send welcome message to connected client
			client.emit('connected', {
				success: true,
				message: `Welcome ${nickname}!`,
				nickname,
				socketId: client.id,
				timestamp: Date.now(),
			});
		} catch (error) {
			this.logger.error(
				`Connection error (${client.id}): ${(error as Error).message}`,
				error instanceof Error ? error.stack : undefined,
			);

			client.emit(ChatEvent.ERROR, {
				message: 'Connection failed. Please try again.',
				code: 'CONNECTION_ERROR',
				details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
			});

			client.disconnect();
		}
	}

	/**
	 * Handle socket disconnection
	 * - Update user offline status
	 * - Broadcast disconnect event
	 * - Clean up resources
	 */
	async handleDisconnect(client: Socket): Promise<void> {
		try {
			const nickname = this.extractNickname(client);
			if (!nickname) {
				this.logger.warn(`Connection rejected: No nickname provided (${client.id})`);
				client.emit(ChatEvent.ERROR, {
					message: 'Nickname is required for authentication',
					code: 'AUTH_REQUIRED',
				});
				client.disconnect();
				return;
			}

			// Validate nickname format
			if (!this.isValidNickname(nickname)) {
				this.logger.warn(
					`Connection rejected: Invalid nickname "${nickname}" (${client.id})`,
				);
				client.emit(ChatEvent.ERROR, {
					message: 'Invalid nickname format (3-20 chars, alphanumeric only)',
					code: 'INVALID_NICKNAME',
				});
				client.disconnect();
				return;
			}

			// Update user status in database
			await this.usersService.updateConnectionStatus(nickname, false);
			// Broadcast disconnect event
			this.server.emit(ChatEvent.USER_DISCONNECTED, {
				nickname,
				timestamp: Date.now(),
			});
		} catch (error) {
			this.logger.error(
				`Disconnect error (${client.id}): ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Join a chat room
	 */
	@SubscribeMessage(ChatEvent.ROOM_JOIN)
	async handleJoinRoom(
		@MessageBody() data: { roomId: string },
		@ConnectedSocket() client: Socket,
	): Promise<void> {
		const nickname = client.data.nickname as string;
		const roomKey = `room:${data.roomId}`;

		client.join(roomKey);

		this.logger.log(`${nickname} joined room ${data.roomId}`);

		try {
			await this.roomService.joinRoom(data.roomId, nickname);
			if (!client.rooms.has(roomKey)) {
				client.join(roomKey);
			}
			this.server.to(roomKey).emit('user_joined_room', {
				nickname,
				roomId: data.roomId,
				socketId: client.id,
				timestamp: Date.now(),
			});

		} catch (error) {
			this.logger.warn('ROOM_JOIN_FAILED', {
				roomId: data.roomId,
				nickname,
				error: error.message,
			});
			client.emit('room:join:error', {
				roomId: data.roomId,
				message: error.message,
			});
		}
	}

	@SubscribeMessage(ChatEvent.ROOM_LEAVE)
	async handleLeaveRoom(
		@MessageBody() data: { roomId: string },
		@ConnectedSocket() client: Socket,
	): Promise<void> {
		const nickname = client.data.nickname as string;
		const roomKey = `room:${data.roomId}`;

		try {
			await this.roomService.leaveRoom(data.roomId, nickname);
			if (client.rooms.has(roomKey)) {
				client.leave(roomKey);
			}
			this.server.to(roomKey).emit('user_left_room', {
				nickname,
				roomId: data.roomId,
				socketId: client.id,
				timestamp: Date.now(),
			});

		} catch (error) {
			client.emit('room:leave:error', {
				roomId: data.roomId,
				message: error.message,
			});
		}
	}

	/**
	 * Send a new chat message
	 */
	@SubscribeMessage(ChatEvent.MESSAGE_SEND)
	async handleSendMessage(
		@MessageBody() data: SendMessageDto,
		@ConnectedSocket() client: Socket,
	): Promise<void> {
		try {
      const nickname = client.data.nickname as string;

      const message = await this.chatService.sendMessage({
        ...data,
        nickname,
      });

      // Broadcast to room members
      this.server
        .to(`room:${data.roomId}`)
        .emit(ChatEvent.MESSAGE_NEW, {
          nickname,
          content: message.content,
          createdAt: Date.now(),
        });

			this.logger.log(
				`Message sent by ${nickname} in room ${data.roomId}`,
			);
		} catch (error) {
			this.logger.error(
				`Send message error: ${(error as Error).message}`,
			);

			client.emit(ChatEvent.ERROR, {
				message: (error as Error).message,
				code: 'MESSAGE_SEND_ERROR',
			});
		}
	}

	/**
	 * Edit existing message
	 */
	@SubscribeMessage(ChatEvent.MESSAGE_EDIT)
	async handleEditMessage(
		@MessageBody() data: EditMessageDto,
		@ConnectedSocket() client: Socket,
	): Promise<void> {
		try {
			const nickname = client.data.nickname as string;

			const updatedMessage = await this.chatService.editLastMessage({
				...data,
				nickname,
			});

			// Broadcast edit to all clients
			this.server.emit(ChatEvent.MESSAGE_EDITED, updatedMessage);

			this.logger.log(
				`Message edited by ${nickname}: ${data.messageId}`,
			);
		} catch (error) {
			this.logger.error(
				`Edit message error: ${(error as Error).message}`,
			);

			client.emit(ChatEvent.ERROR, {
				message: (error as Error).message,
				code: 'MESSAGE_EDIT_ERROR',
			});
		}
	}

	/**
	 * Delete message
	 */
	@SubscribeMessage(ChatEvent.MESSAGE_DELETE)
	async handleDeleteMessage(
		@MessageBody() data: DeleteMessageDto,
		@ConnectedSocket() client: Socket,
	): Promise<void> {
		try {
			const nickname = client.data.nickname as string;

			await this.chatService.deleteMessage(data.messageId, nickname);

			// ✅ Broadcast deletion to all clients
			this.server.emit(ChatEvent.MESSAGE_DELETED, {
				messageId: data.messageId,
				deletedBy: nickname,
				timestamp: Date.now(),
			});

			this.logger.log(
				`Message deleted by ${nickname}: ${data.messageId}`,
			);
		} catch (error) {
			this.logger.error(
				`Delete message error: ${(error as Error).message}`,
			);

			client.emit(ChatEvent.ERROR, {
				message: (error as Error).message,
				code: 'MESSAGE_DELETE_ERROR',
			});
		}
	}

	/**
	 * User typing indicator
	 */
	@SubscribeMessage(ChatEvent.USER_TYPING)
	handleUserTyping(
		@MessageBody() data: { roomId: string },
		@ConnectedSocket() client: Socket,
	): void {
		const nickname = client.data.nickname as string;

		this.server.to(`room:${data.roomId}`).emit(ChatEvent.USER_TYPING, {
			nickname,
			roomId: data.roomId,
			timestamp: Date.now(),
		});
	}

	/**
	 * User stop typing indicator
	 */
	@SubscribeMessage(ChatEvent.USER_STOP_TYPING)
	handleUserStopTyping(
		@MessageBody() data: { roomId: string },
		@ConnectedSocket() client: Socket,
	): void {
		const nickname = client.data.nickname as string;

		this.server.to(`room:${data.roomId}`).emit(ChatEvent.USER_STOP_TYPING, {
			nickname,
			roomId: data.roomId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Extract nickname from socket handshake
	 * Supports multiple auth methods with priority:
	 * 1. handshake.auth.nickname (Socket.IO standard) - Highest priority
	 * 2. handshake.query.nickname (Query param)
	 * 3. handshake.headers.nickname (HTTP header) - Lowest priority
	 */
	private extractNickname(client: Socket): string | null {
		// Priority 1: Socket.IO auth (recommended method)
		if (client.handshake.auth?.nickname) {
			return String(client.handshake.auth.nickname).trim();
		}

		// Priority 2: Query parameters (?nickname=alice)
		if (client.handshake.query?.nickname) {
			return String(client.handshake.query.nickname).trim();
		}

		// Priority 3: HTTP headers
		if (client.handshake.headers?.nickname) {
			return String(client.handshake.headers.nickname).trim();
		}

		return null;
	}

	/**
	 * Validate nickname format
	 * Rules:
	 * - Length: 3-20 characters
	 * - Characters: alphanumeric, underscore, hyphen only
	 * - No spaces or special characters
	 */
	private isValidNickname(nickname: string): boolean {
		if (!nickname || typeof nickname !== 'string') {
			return false;
		}

		const trimmed = nickname.trim();

		// Check length
		if (trimmed.length < 3 || trimmed.length > 20) {
			return false;
		}

		// Check format: only alphanumeric, underscore, hyphen
		const nicknameRegex = /^[a-zA-Z0-9_-]+$/;
		return nicknameRegex.test(trimmed);
	}
}
