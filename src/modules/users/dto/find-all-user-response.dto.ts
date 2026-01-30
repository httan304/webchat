import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';
import { PaginationMetaDto } from './pagination-meta.dto';

export class FindAllUsersResponseDto {
    @ApiProperty({ type: [User] })
    data: User[];

    @ApiProperty({ type: PaginationMetaDto })
    meta: PaginationMetaDto;
}
