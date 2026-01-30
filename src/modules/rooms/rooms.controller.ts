import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards, Query, Delete,
} from '@nestjs/common';
import {RoomsService} from './rooms.service';
import {CreateRoomDto} from './dto/create-room.dto';
import {Room} from './entities/room.entity';
import {RateLimitGuard} from "@/guard/rate-limit.guard";
import {DeleteRoomDto} from "@/modules/users/dto/delete-room.dto";

@UseGuards(RateLimitGuard)
@Controller('rooms')
export class RoomsController {
	constructor(private readonly roomsService: RoomsService) {
	}

  /**
   * Create a new room
   * @param createRoomDto
   */
	@Post()
	@HttpCode(HttpStatus.CREATED)
	async create(@Body() createRoomDto: CreateRoomDto): Promise<Room> {
		return this.roomsService.createRoom(createRoomDto.name, createRoomDto.creatorNickname, createRoomDto.description);
	}

  /**
   * Get room by ID
   * @param id
   */
	@Get(':id')
	@HttpCode(HttpStatus.OK)
	async findOne(@Param('id') id: string): Promise<Room> {
		return this.roomsService.findOne(id);
	}

  /**
   * List of participants and whether they are connected or not
   * Returns participants with their connection status
   */
  @Get(':id/participants')
  @HttpCode(HttpStatus.OK)
  async getParticipants(
    @Param('id') roomId: string,
    @Query('requester') requesterNickname: string,
  ): Promise<Array<{
    nickname: string;
    joinedAt: Date;
    id: string;
  }>> {
    return this.roomsService.getParticipants(roomId, requesterNickname);
  }

  /**
   * User can join an existing room
   * POST /rooms/:id/participants/:nickname
   */
  @Post(':id/participants/:nickname')
  @HttpCode(HttpStatus.CREATED)
  async addParticipant(
    @Param('id') roomId: string,
    @Param('nickname') nickname: string,
  ): Promise<{ message: string }> {

    await this.roomsService.joinRoom(roomId, nickname);
    return { message: `User ${nickname} joined room ${roomId}` };
  }

  /**
   * Delete a room
   * DELETE /rooms/:id
   * Only the room creator can delete the room
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteRoom(
    @Param('id') roomId: string,
    @Body() deleteRoomDto: DeleteRoomDto,
  ): Promise<{ message: string }> {
    await this.roomsService.deleteRoom(roomId, deleteRoomDto.requesterNickname);
    return { message: `Room ${roomId} deleted successfully` };
  }
}
