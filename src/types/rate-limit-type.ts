export interface RateLimitConfig {
	maxRequests: number;
	windowMs: number;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfterMs?: number;
}
