import {
	Controller,
	Post,
	Get,
	Body,
	HttpCode,
	HttpStatus,
	Param,
	UseGuards,
	Query,
	Delete,
} from '@nestjs/common';
import {
	ApiTags,
	ApiOperation,
	ApiResponse,
	ApiParam,
	ApiQuery,
	ApiBody,
} from '@nestjs/swagger';

import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { Room } from './entities/room.entity';
import { RateLimitGuard } from '@/guard/rate-limit.guard';
import { DeleteRoomDto } from '@/modules/users/dto/delete-room.dto';

@ApiTags('Rooms')
@UseGuards(RateLimitGuard)
@Controller('rooms')
export class RoomsController {
	constructor(private readonly roomsService: RoomsService) {}

	/**
	 * Create new room
	 * @param createRoomDto
	 */
	@Post()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create a new chat room' })
	@ApiBody({ type: CreateRoomDto })
	@ApiResponse({
		status: HttpStatus.CREATED,
		description: 'Room created successfully',
		type: Room,
	})
	async create(@Body() createRoomDto: CreateRoomDto): Promise<Room> {
		return this.roomsService.createRoom(
			createRoomDto.name,
			createRoomDto.creatorNickname,
			createRoomDto.description,
		);
	}

	/**
	 * Get room by ID
	 * @param id
	 */
	@Get(':id')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Get room by ID' })
	@ApiParam({ name: 'id', example: '95196e94-872b-4309-8a6e-8ca30914d360' })
	@ApiResponse({
		status: HttpStatus.OK,
		description: 'Room found',
		type: Room,
	})
	async findOne(@Param('id') id: string): Promise<Room | null> {
		return this.roomsService.findOne(id);
	}


	/**
	 * Get room participants
	 * @param roomId
	 * @param requesterNickname
	 */
	@Get(':id/participants')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Get room participants' })
	@ApiParam({ name: 'id', example: '95196e94-872b-4309-8a6e-8ca30914d360' })
	@ApiQuery({
		name: 'requester',
		required: false,
		example: 'alice',
	})
	@ApiResponse({
		status: HttpStatus.OK,
		description: 'List of participants',
		schema: {
			example: [
				{
					id: 'user-uuid',
					nickname: 'alice',
					isOwner: true,
					joinedAt: '2026-01-29T10:00:00.000Z',
				},
			],
		},
	})
	async getParticipants(
		@Param('id') roomId: string,
		@Query('requester') requesterNickname: string,
	): Promise<
		Array<{
			nickname: string;
			joinedAt: Date;
			id: string;
		}>
	> {
		return this.roomsService.getParticipants(roomId, requesterNickname);
	}

	/**
	 * Participant join room
	 * @param roomId
	 * @param nickname
	 */
	@Post(':id/participants/:nickname')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Join a room' })
	@ApiParam({ name: 'id', example: '95196e94-872b-4309-8a6e-8ca30914d360' })
	@ApiParam({ name: 'nickname', example: 'alice' })
	@ApiResponse({
		status: HttpStatus.CREATED,
		description: 'User joined room',
		schema: {
			example: {
				message: 'User alice joined room 95196e94-872b-4309-8a6e-8ca30914d360',
			},
		},
	})
	async joinRoom(
		@Param('id') roomId: string,
		@Param('nickname') nickname: string,
	): Promise<{ message: string }> {
		await this.roomsService.joinRoom(roomId, nickname);
		return { message: `User ${nickname} joined room ${roomId}` };
	}

	/**
	 * Participant leave room
	 * @param roomId
	 * @param nickname
	 */
	@Delete(':id/participants/:nickname')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Leave a room' })
	@ApiParam({ name: 'id', example: '95196e94-872b-4309-8a6e-8ca30914d360' })
	@ApiParam({ name: 'nickname', example: 'alice' })
	@ApiResponse({
		status: HttpStatus.CREATED,
		description: 'User left room',
		schema: {
			example: {
				message: 'User alice left room 95196e94-872b-4309-8a6e-8ca30914d360',
			},
		},
	})
	async leaveRoom(
		@Param('id') roomId: string,
		@Param('nickname') nickname: string,
	): Promise<{ message: string }> {
		await this.roomsService.leaveRoom(roomId, nickname);
		return { message: `User ${nickname} left room ${roomId}` };
	}

	/**
	 * Delete room (creator only)
	 */
	@Delete(':id')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Delete a room (creator only)' })
	@ApiParam({ name: 'id', example: '95196e94-872b-4309-8a6e-8ca30914d360' })
	@ApiBody({ type: DeleteRoomDto })
	@ApiResponse({
		status: HttpStatus.OK,
		description: 'Room deleted successfully',
		schema: {
			example: {
				message: 'Room 95196e94-872b-4309-8a6e-8ca30914d360 deleted successfully',
			},
		},
	})
	async deleteRoom(
		@Param('id') roomId: string,
		@Body() deleteRoomDto: DeleteRoomDto,
	): Promise<{ message: string }> {
		await this.roomsService.deleteRoom(
			roomId,
			deleteRoomDto.requesterNickname,
		);
		return { message: `Room ${roomId} deleted successfully` };
	}

	@Get('my/:nickname')
	@ApiOperation({
		summary: 'Get rooms created by user and rooms user has joined',
		description:
			'Return list of rooms that the user created OR has participated in',
	})
	@ApiParam({
		name: 'nickname',
		type: String,
		example: 'alice',
	})
	@ApiResponse({
		status: 200,
		description: 'List of rooms',
		type: [Room],
	})
	getMyRooms(@Param('nickname') nickname: string) {
		return this.roomsService.getMyRooms(nickname);
	}

}
