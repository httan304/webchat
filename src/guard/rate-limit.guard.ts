import {
	CanActivate,
	ExecutionContext, HttpException, HttpStatus,
	Injectable,
} from '@nestjs/common';
import { RateLimiterService } from '@/services/rate-limiter.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
	constructor(private readonly rateLimiter: RateLimiterService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest();
		const key = req.ip;

		const result = await this.rateLimiter.isAllowed(key, {
			maxRequests: 100,
			windowMs: 60_000,
		});

		if (!result.allowed) {
			throw new HttpException(
				'Too many requests',
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}

		return true;
	}
}
