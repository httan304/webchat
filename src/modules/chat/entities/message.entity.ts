import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ForeignKey,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Room } from '../../rooms/entities/room.entity';

@Entity('messages')
// @Index(['roomId', 'createdAt'], { name: 'idx_room_messages' })
@Index(['userId', 'createdAt'])
@Index(['createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  content: string;

  @ForeignKey(() => User)
  @Column()
  userId: string;

  @ForeignKey(() => Room)
  @Column()
  roomId: string;

  @Column({ type: 'boolean', default: false })
  edited: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.messages, { lazy: true })
  user: Promise<User>;

  @ManyToOne(() => Room, (room) => room.messages, { lazy: true })
  room: Promise<Room>;
}
