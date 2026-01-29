import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'Message cannot be empty' })
  @MaxLength(5000, { message: 'Message must not exceed 5000 characters' })
  content: string;

  @IsUUID()
  roomId: string;

  nickname?: string;
}

export class EditMessageDto {
  @IsUUID()
  messageId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;

  nickname?: string;
}

export class DeleteMessageDto {
  @IsUUID()
  messageId: string;

  nickname?: string;
}
