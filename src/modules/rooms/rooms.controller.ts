import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  Delete, UseGuards,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { Room } from './entities/room.entity';
import { RateLimitGuard } from "@/guard/rate-limit.guard";

@UseGuards(RateLimitGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createRoomDto: CreateRoomDto): Promise<Room> {
    return this.roomsService.createRoom(createRoomDto.name, createRoomDto.creatorNickname, createRoomDto.description);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string): Promise<Room> {
    return this.roomsService.findOne(id);
  }

  @Post(':id/participants/:nickname')
  @HttpCode(HttpStatus.CREATED)
  async addParticipant(
    @Param('id') roomId: string,
    @Param('nickname') nickname: string,
  ): Promise<{ message: string }> {
    await this.roomsService.addParticipant(roomId, nickname);
    return { message: `User ${nickname} added to room ${roomId}` };
  }
}
