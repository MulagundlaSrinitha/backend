import { Injectable, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard as NestThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ThrottlerGuard extends NestThrottlerGuard {
  // Use authenticated user's ID when available, fall back to IP.
  // This prevents a logged-in user from bypassing rate limits by rotating IPs
  // (e.g. mobile networks) and ensures per-user fairness.
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id || req.user?.sub;
    return userId ? `user:${userId}` : `ip:${req.ip}`;
  }

  protected getRequestResponse(context: ExecutionContext) {
    const ctx = context.switchToHttp();
    return { req: ctx.getRequest(), res: ctx.getResponse() };
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: { ttl: number; limit: number; key: string },
  ): Promise<void> {
    const response = context.switchToHttp().getResponse();
    response.setHeader('Retry-After', Math.ceil(throttlerLimitDetail.ttl / 1000));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests, please try again later',
        error: 'TOO_MANY_REQUESTS',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
