import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({
    description: 'Room name',
    example: 'General Chat',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({
    description: 'Room description',
    example: 'This room is for general discussion',
    minLength: 1,
    maxLength: 100,
    required: false,
  })
  @IsString()
  @Length(1, 100)
  description?: string;

  @ApiProperty({
    description: 'Nickname of the room creator',
    example: 'alice',
  })
  @IsNotEmpty()
  @IsString()
  creatorNickname: string;
}
