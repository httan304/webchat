import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { Message } from './entities/message.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomParticipant } from '../rooms/entities/room-participant.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Room, RoomParticipant]),
    UsersModule,
    // ✅ No need to import services - they're global now!
  ],
  providers: [
    ChatGateway,
    ChatService,
    // ✅ No need to provide services - they're global now!
  ],
  exports: [ChatService],
})
export class ChatModule {}
