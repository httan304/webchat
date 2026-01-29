import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { ChatService } from './chat.service';
import {
  SendMessageDto,
  EditMessageDto,
  DeleteMessageDto,
} from './dto/chat.dto';
import { UsersService } from '../users/users.service';
import { ChatEvent } from '../../types/chat.event.type';

@Injectable()
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Handle new socket connection
   * - Validate auth payload
   * - Update user online status
   * - Broadcast presence event
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const nickname = client.handshake.auth?.nickname as string;

      if (!nickname) {
        client.disconnect();
        return;
      }

      await this.usersService.updateConnectionStatus(
        nickname,
        true,
      );

      client.data.nickname = nickname;
      client.data.userId = nickname;

      this.logger.log(`👤 Connected: ${nickname} (${client.id})`);

      this.server.emit(ChatEvent.USER_CONNECTED, {
        nickname,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(
        `Connection error: ${(error as Error).message}`,
      );
      client.disconnect();
    }
  }

  /**
   * Handle socket disconnection
   * - Update user offline status
   * - Broadcast presence event
   */
  async handleDisconnect(client: Socket): Promise<void> {
    try {
      const nickname = client.data.nickname as string;

      if (!nickname) return;

      await this.usersService.updateConnectionStatus(
        nickname,
        false,
      );

      this.logger.log(`👤 Disconnected: ${nickname}`);

      this.server.emit(ChatEvent.USER_DISCONNECTED, {
        nickname,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(
        `Disconnect error: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Join a chat room
   */
  @SubscribeMessage(ChatEvent.ROOM_JOIN)
  handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    client.join(`room:${data.roomId}`);
    this.logger.log(
      `${client.data.nickname} joined room ${data.roomId}`,
    );
  }

  /**
   * Leave a chat room
   */
  @SubscribeMessage(ChatEvent.ROOM_LEAVE)
  handleLeaveRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    client.leave(`room:${data.roomId}`);
    this.logger.log(
      `${client.data.nickname} left room ${data.roomId}`,
    );
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

      const message = await this.chatService.sendMessage(
        { ...data, nickname },
        nickname,
      );

      this.server
        .to(`room:${data.roomId}`)
        .emit(ChatEvent.MESSAGE_NEW, message);

      this.logger.log(
        `Message sent in room ${data.roomId}`,
      );
    } catch (error) {
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

      const updatedMessage =
        await this.chatService.editMessage(
          { ...data, nickname },
          nickname,
        );

      this.server.emit(
        ChatEvent.MESSAGE_EDITED,
        updatedMessage,
      );
    } catch (error) {
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

      await this.chatService.deleteMessage(
        data.messageId,
        nickname,
      );

      this.server.emit(ChatEvent.MESSAGE_DELETED, {
        messageId: data.messageId,
      });
    } catch (error) {
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
    this.server
      .to(`room:${data.roomId}`)
      .emit(ChatEvent.USER_TYPING, {
        nickname: client.data.nickname,
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
    this.server
      .to(`room:${data.roomId}`)
      .emit(ChatEvent.USER_STOP_TYPING, {
        nickname: client.data.nickname,
        timestamp: Date.now(),
      });
  }
}
