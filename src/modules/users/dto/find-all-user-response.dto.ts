import { User } from '../entities/user.entity';
import { PaginationMetaDto } from './pagination-meta.dto';

export class FindAllUsersResponseDto {
    data: User[];
    meta: PaginationMetaDto;
}
