import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { Message } from './entities/message.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomParticipant } from '../rooms/entities/room-participant.entity';
import { UsersModule } from '../users/users.module';
import {ChatController} from "@/modules/chat/chat.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Room, RoomParticipant]),
    UsersModule,
  ],
  providers: [
    ChatGateway,
    ChatService,
  ],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
