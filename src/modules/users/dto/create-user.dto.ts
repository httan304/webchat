import {
  IsNotEmpty,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import {
  ApiProperty,
} from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    example: 'alice_123',
    description: 'Unique nickname of the user',
    minLength: 3,
    maxLength: 50,
  })
  @IsNotEmpty()
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'Nickname can only contain letters, numbers, underscores, and hyphens',
  })
  nickname: string;
}
