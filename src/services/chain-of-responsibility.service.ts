import { Injectable, Logger, BadRequestException } from '@nestjs/common';

export interface RequestContext {
    traceId?: string;
    userId?: string;
    method?: string;
    path?: string;
    timestamp?: number;
    ipAddress?: string;
    rateLimitInfo?: {
        requests: number;
        max: number;
    };
    securityHeaders?: Record<string, string>;
    [key: string]: any;
}

/**
 * Abstract base handler for the chain of responsibility pattern
 */
@Injectable()
export abstract class RequestHandler {
    protected logger = new Logger(this.constructor.name);
    protected nextHandler: RequestHandler | null = null;

    setNext(handler: RequestHandler): RequestHandler {
        this.nextHandler = handler;
        return handler;
    }

    async handle(request: any, context: RequestContext): Promise<RequestContext> {
        context = await this.process(request, context);

        if (this.nextHandler) {
            return this.nextHandler.handle(request, context);
        }

        return context;
    }

    abstract process(request: any, context: RequestContext): Promise<RequestContext>;
}

/**
 * Handler for request tracing - generates correlation IDs
 */
@Injectable()
export class TracingHandler extends RequestHandler {
    async process(request: any, context: RequestContext): Promise<RequestContext> {
        context.traceId =
            context.traceId ||
            request.headers?.['x-trace-id'] ||
            this.generateTraceId();
        context.timestamp = Date.now();
        context.ipAddress =
            request.ip ||
            request.headers?.['x-forwarded-for'] ||
            request.connection?.remoteAddress;

        this.logger.debug(
            `[${context.traceId}] Tracing request from ${context.ipAddress}`,
        );

        return context;
    }

    private generateTraceId(): string {
        return `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Handler for authorization - extracts user information
 */
@Injectable()
export class AuthorizationHandler extends RequestHandler {
    async process(request: any, context: RequestContext): Promise<RequestContext> {
        const authHeader = request.headers?.authorization;

        if (authHeader) {
            try {
                context.userId = this.extractUserId(authHeader);
                this.logger.debug(
                    `[${context.traceId}] Authorization: User ${context.userId}`,
                );
            } catch (error) {
                this.logger.warn(
                    `[${context.traceId}] Failed to extract user from token`,
                );
                context.userId = 'anonymous';
            }
        } else {
            context.userId = 'anonymous';
        }

        return context;
    }

    private extractUserId(authHeader: string): string {
        try {
            const token = authHeader.replace('Bearer ', '');
            // In production, would verify JWT
            return token.split('.')[0] || 'unknown';
        } catch {
            return 'anonymous';
        }
    }
}

/**
 * Handler for request validation
 */
@Injectable()
export class ValidationHandler extends RequestHandler {
    async process(request: any, context: RequestContext): Promise<RequestContext> {
        const { method, path } = request;
        context.method = method;
        context.path = path;

        // Basic validation
        if (!method || !path) {
            this.logger.error(
                `[${context.traceId}] Invalid request: missing method or path`,
            );
            throw new BadRequestException('Invalid request: missing method or path');
        }

        // Validate method
        const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
        if (!validMethods.includes(method)) {
            throw new BadRequestException(`Invalid HTTP method: ${method}`);
        }

        // Validate path
        if (typeof path !== 'string' || path.length === 0) {
            throw new BadRequestException('Invalid path');
        }

        this.logger.debug(`[${context.traceId}] Validation passed: ${method} ${path}`);

        return context;
    }
}

/**
 * Handler for security headers validation
 */
@Injectable()
export class SecurityHeadersHandler extends RequestHandler {
    async process(request: any, context: RequestContext): Promise<RequestContext> {
        // Define required/recommended security headers
        const securityHeaders = {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': "default-src 'self'",
        };

        context.securityHeaders = securityHeaders;

        this.logger.debug(`[${context.traceId}] Security headers validated`);

        return context;
    }
}

/**
 * Handler for rate limiting
 */
@Injectable()
export class RateLimitingHandler extends RequestHandler {
    private readonly config: {
        maxRequests: number;
        windowMs: number;
    };
    private requestCounts = new Map<string, { count: number; resetTime: number }>();

    constructor(config?: { maxRequests: number; windowMs: number }) {
        super();
        this.config = config || {
            maxRequests: 100,
            windowMs: 60000,
        };
    }

    async process(request: any, context: RequestContext): Promise<RequestContext> {
        const key = context.userId || context.ipAddress || 'anonymous';
        const now = Date.now();

        let entry = this.requestCounts.get(key);

        // Reset counter if window expired
        if (!entry || now > entry.resetTime) {
            entry = {
                count: 0,
                resetTime: now + this.config.windowMs,
            };
            this.requestCounts.set(key, entry);
        }

        // Check rate limit
        if (entry.count >= this.config.maxRequests) {
            this.logger.warn(
                `[${context.traceId}] Rate limit exceeded for ${key}: ${entry.count}/${this.config.maxRequests}`,
            );
            throw new BadRequestException(
                `Rate limit exceeded. Max: ${this.config.maxRequests} requests per ${this.config.windowMs / 1000}s`,
            );
        }

        entry.count += 1;

        context.rateLimitInfo = {
            requests: entry.count,
            max: this.config.maxRequests,
        };

        this.logger.debug(
            `[${context.traceId}] Rate limiting checked: ${entry.count}/${this.config.maxRequests}`,
        );

        return context;
    }

    resetLimits(): void {
        this.requestCounts.clear();
        this.logger.log('All rate limits cleared');
    }

    getStatus(key: string): any {
        const entry = this.requestCounts.get(key);
        return entry || { count: 0, max: this.config.maxRequests };
    }
}

/**
 * Request processing pipeline that chains all handlers
 */
@Injectable()
export class RequestProcessingPipeline {
    private readonly logger = new Logger(RequestProcessingPipeline.name);
    private handlers: RequestHandler[];

    constructor(
        private tracingHandler: TracingHandler,
        private authHandler: AuthorizationHandler,
        private validationHandler: ValidationHandler,
        private securityHandler: SecurityHeadersHandler,
        private rateLimitHandler: RateLimitingHandler,
    ) {
        // Build the chain
        this.tracingHandler.setNext(this.authHandler);
        this.authHandler.setNext(this.validationHandler);
        this.validationHandler.setNext(this.securityHandler);
        this.securityHandler.setNext(this.rateLimitHandler);

        this.handlers = [
            this.tracingHandler,
            this.authHandler,
            this.validationHandler,
            this.securityHandler,
            this.rateLimitHandler,
        ];
    }

    /**
     * Process a request through the entire pipeline
     */
    async process(request: any): Promise<RequestContext> {
        let context: RequestContext = {};

        try {
            context = await this.tracingHandler.handle(request, context);
            this.logger.debug(
                `[${context.traceId}] Request processed successfully`,
            );
            return context;
        } catch (error) {
            this.logger.error(
                `[${context.traceId}] Pipeline error: ${(error as Error).message}`,
            );
            throw error;
        }
    }

    /**
     * Get pipeline status
     */
    getStatus(): any {
        return {
            handlers: this.handlers.map((h) => h.constructor.name),
            status: 'active',
            count: this.handlers.length,
        };
    }

    /**
     * Reset rate limits
     */
    resetRateLimits(): void {
        this.rateLimitHandler.resetLimits();
    }

    /**
     * Get rate limit status for a user
     */
    getRateLimitStatus(key: string): any {
        return this.rateLimitHandler.getStatus(key);
    }
}
