import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateRoomDto {
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @Length(1, 100)
  description: string;

  @IsNotEmpty()
  @IsString()
  creatorNickname: string;
}
