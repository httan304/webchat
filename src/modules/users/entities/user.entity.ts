import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { RoomParticipant } from '../../rooms/entities/room-participant.entity';

@Entity('users')
@Index(['nickname'], { unique: true }) // ✅ Unique constraint + index
@Index(['isConnected']) // ✅ Fast filter by online status
@Index(['createdAt']) // ✅ Sort by registration date
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  nickname: string;

  @Column({ type: 'boolean', default: false })
  isConnected: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastSeen: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // ✅ Optional: Relationships (load only when needed)
  @OneToMany(() => RoomParticipant, (participant) => participant.user)
  participation?: RoomParticipant[];
}
