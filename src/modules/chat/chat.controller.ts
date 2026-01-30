import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import {RateLimitGuard} from "@/guard/rate-limit.guard";
import {ChatService} from "@/modules/chat/chat.service";

@UseGuards(RateLimitGuard)
@Controller('rooms')
@ApiTags('Chat / Messages')
@UseGuards(RateLimitGuard)
@Controller('rooms')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('rooms/:roomId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get messages with pagination' })
  @ApiParam({ name: 'roomId', example: 'room-uuid-123' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({
    description: 'Paginated messages',
    schema: {
      example: {
        data: [],
        meta: {
          total: 100,
          page: 1,
          limit: 50,
          totalPages: 2,
        },
      },
    },
  })
  async getMessages(
    @Param('roomId') roomId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.chatService.getMessages(roomId, page, limit);
  }

  @Get('rooms/:roomId/messages/chronological')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get messages (oldest first)' })
  @ApiParam({ name: 'roomId' })
  @ApiQuery({ name: 'page', example: 1 })
  @ApiQuery({ name: 'limit', example: 50 })
  async getMessagesChronological(
    @Param('roomId') roomId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.chatService.getMessagesChronological(roomId, page, limit);
  }

  @Get('rooms/:roomId/messages/since')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get messages since timestamp' })
  @ApiParam({ name: 'roomId' })
  @ApiQuery({
    name: 'timestamp',
    example: '2026-01-29T10:00:00Z',
    required: true,
  })
  @ApiQuery({ name: 'limit', example: 100 })
  @ApiBadRequestResponse({ description: 'Invalid timestamp format' })
  async getMessagesSince(
    @Param('roomId') roomId: string,
    @Query('timestamp') timestamp: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    const since = new Date(timestamp);
    if (isNaN(since.getTime())) {
      throw new Error('Invalid timestamp format');
    }
    return this.chatService.getMessagesSince(roomId, since, limit);
  }

  @Get('rooms/:roomId/messages/latest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get latest messages (preview)' })
  @ApiParam({ name: 'roomId' })
  @ApiQuery({ name: 'limit', example: 20 })
  async getLatestMessages(
    @Param('roomId') roomId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const result = await this.chatService.getMessages(roomId, 1, limit);
    return result.data;
  }
}
