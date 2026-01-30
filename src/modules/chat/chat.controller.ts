import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import {RateLimitGuard} from "@/guard/rate-limit.guard";
import {ChatService} from "@/modules/chat/chat.service";
import {Message} from "@/modules/chat/entities/message.entity";

@UseGuards(RateLimitGuard)
@Controller('rooms')
export class ChatController {
	constructor(private readonly chatService: ChatService) {
	}

  /**
   * Get messages for a room with pagination
   * @param roomId
   * @param page
   * @param limit
   */
  @Get('rooms/:roomId/messages')
  @HttpCode(HttpStatus.OK)
  async getMessages(
    @Param('roomId') roomId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
  ): Promise<{
    data: any[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    return this.chatService.getMessages(roomId, page, limit);
  }

  /**
   * Get messages chronologically (oldest first) - For initial room load
   * GET /chat/rooms/:roomId/messages/chronological?page=1&limit=50
   *
   * Use case: Initial room load, display messages in chronological order
   * Order: Oldest first (ASC)
   * Cache: 5 minutes
   */
  @Get('rooms/:roomId/messages/chronological')
  @HttpCode(HttpStatus.OK)
  async getMessagesChronological(
    @Param('roomId') roomId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<{
    data: Message[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    return this.chatService.getMessagesChronological(roomId, page, limit);
  }

  /**
   * Get messages since a timestamp - For real-time sync after reconnection
   * GET /chat/rooms/:roomId/messages/since?timestamp=2026-01-29T10:00:00Z&limit=100
   *
   * Use case: User reconnects, sync messages missed while disconnected
   * Order: Chronological (ASC)
   * Cache: No (real-time data)
   * Max limit: 100 messages
   */
  @Get('rooms/:roomId/messages/since')
  @HttpCode(HttpStatus.OK)
  async getMessagesSince(
    @Param('roomId') roomId: string,
    @Query('timestamp') timestamp: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<Message[]> {
    const since = new Date(timestamp);
    if (isNaN(since.getTime())) {
      throw new Error('Invalid timestamp format. Use ISO 8601 format.');
    }

    return this.chatService.getMessagesSince(roomId, since, limit);
  }

  /**
   * Get latest N messages - Quick load for room preview
   * GET /chat/rooms/:roomId/messages/latest?limit=20
   *
   * Use case: Show preview of latest messages without pagination
   * Order: Newest first (DESC)
   * Cache: 1 minute (changes frequently)
   */
  @Get('rooms/:roomId/messages/latest')
  @HttpCode(HttpStatus.OK)
  async getLatestMessages(
    @Param('roomId') roomId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<Message[]> {
    const result = await this.chatService.getMessages(roomId, 1, limit);
    return result.data;
  }

}
