import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteRoomDto {
	@ApiProperty({
		example: 'alice',
		description: 'Nickname of the room creator who requests deletion',
	})
	@IsNotEmpty()
	@IsString()
	requesterNickname: string;
}
