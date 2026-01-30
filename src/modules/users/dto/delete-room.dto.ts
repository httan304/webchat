import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteRoomDto {
	@ApiProperty({
		example: 'alice',
		description: 'Nickname of the room owner who requests room deletion',
		required: true,
	})
	@IsNotEmpty()
	@IsString()
	requesterNickname: string;
}
