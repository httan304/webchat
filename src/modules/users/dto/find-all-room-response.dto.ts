import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from './pagination-meta.dto';
import { Room } from '@/modules/rooms/entities/room.entity';

export class FindAllRoomsResponseDto {
    @ApiProperty({
        type: () => Room,
        isArray: true,
        description: 'List of rooms',
        example: [
            {
                id: 'uuid',
                name: 'General Chat',
                description: 'Main discussion room',
                creatorNickname: 'alice',
                createdAt: '2026-01-30T06:00:00.000Z',
            },
        ],
    })
    data: Room[];

    @ApiProperty({
        type: () => PaginationMetaDto,
        description: 'Pagination metadata',
        example: {
            total: 100,
            page: 1,
            limit: 20,
            totalPages: 5,
        },
    })
    meta: PaginationMetaDto;
}
