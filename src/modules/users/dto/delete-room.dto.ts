import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteRoomDto {
	@IsNotEmpty()
	@IsString()
	requesterNickname: string;
}
