import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmsModule } from '../providers/sms/sms.module';
import { redisProvider, REDIS_CLIENT } from '../providers/redis/redis.provider';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error(
            'JWT_SECRET is required. Set it in environment configuration.',
          );
        }
        return {
          secret,
          signOptions: { expiresIn: '7d' },
        };
      },
    }),
    NotificationsModule,
    SmsModule,
  ],
  controllers: [AuthController],
  providers: [redisProvider, AuthService, JwtStrategy, RolesGuard],
  exports: [AuthService, JwtModule, PassportModule, REDIS_CLIENT],
})
export class AuthModule {}
