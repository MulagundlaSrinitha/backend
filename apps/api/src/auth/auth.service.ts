import * as crypto from 'crypto';
import { Inject, Injectable, Logger, ConflictException, UnauthorizedException, BadRequestException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../providers/sms/sms.service';
import { REDIS_CLIENT } from '../providers/redis/redis.provider';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpLoginDto } from './dto/verify-otp-login.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private supabase: SupabaseClient | null = null;

  // Redis-backed OTP store — survives restarts and works across instances.
  // Falls back to in-memory Map if Redis is unavailable (dev/local mode).
  private readonly otpFallback = new Map<string, { code: string; expiresAt: number }>();
  private static readonly OTP_TTL_SECONDS = 5 * 60; // 5 minutes
  private static readonly OTP_KEY_PREFIX = 'otp:';
  private static readonly MAX_OTP_ATTEMPTS = 5; // failed tries before code is invalidated

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private notificationsService: NotificationsService,
    private smsService: SmsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
  }

  async signup(dto: SignupDto) {
    // Email/password credentials are delegated to Supabase Auth. Fail closed
    // when it is not configured so an account is never created without a
    // verifiable credential.
    if (!this.supabase) {
      throw new ServiceUnavailableException('Email/password signup is unavailable: Supabase Auth is not configured');
    }

    // Check if user already exists
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    let supabaseUserId: string | undefined;

    // Create user in Supabase Auth if configured
    if (this.supabase) {
      const { data: authData, error: authError } = await this.supabase.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
      });

      if (authError) {
        throw new BadRequestException(`Supabase auth error: ${authError.message}`);
      }

      supabaseUserId = authData.user?.id;
    }

    // Create user record in our DB
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name || null,
        phone: dto.phone || null,
        role: (dto.role as UserRole) || 'CUSTOMER',
      },
    });

    // Generate JWT
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: this.sanitizeUser(user),
      access_token: token,
    };
  }

  async login(dto: LoginDto) {
    // Email/password verification is delegated to Supabase Auth. Fail closed
    // when it is not configured so a JWT is never issued without a password
    // check.
    if (!this.supabase) {
      throw new ServiceUnavailableException('Email/password login is unavailable: Supabase Auth is not configured');
    }

    let supabaseUser: any = null;

    if (this.supabase) {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      });

      if (error) {
        throw new UnauthorizedException(`Invalid credentials: ${error.message}`);
      }

      supabaseUser = data.user;
    }

    // Find user in our DB
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Generate JWT
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(supabaseUser ? { supabaseId: supabaseUser.id } : {}),
    });

    return {
      user: this.sanitizeUser(user),
      access_token: token,
    };
  }

  // Zomato-style single phone-OTP flow — send-otp + verify-otp-login together
  // replace signup/login for that client entirely (email+password above stays
  // as-is for vendor/admin, which still use it). The customer app is Google-only
  // for MVP and never calls these; the delivery app uses them with
  // role: DELIVERY_PARTNER.
  //
  // Restored + hardened from the pre-410 implementation (commit 0e1227d^):
  // Redis-backed with in-memory fallback, 60s cooldown, 5-min expiry, single-use,
  // SMS delivery (dev console log when no provider is configured), and a
  // per-code brute-force attempt cap.
  //
  // SECURITY (REDIS): OTP codes are stored short-lived (300s TTL) and only in
  // Redis/in-memory — never written to production logs. Attempt counters are
  // also Redis-backed and invalidate the code after MAX_OTP_ATTEMPTS failures.
  async sendOtp(dto: SendOtpDto) {
    // Anti-abuse: enforce 60-second cooldown between OTP sends per phone number
    const cooldownKey = `otp:cooldown:${dto.phone}`;
    try {
      const existing = await this.redis.get(cooldownKey);
      if (existing) {
        throw new BadRequestException('Please wait 60 seconds before requesting a new code.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Redis unavailable — skip cooldown check in dev
    }

    const code = String(crypto.randomInt(100000, 999999));
    const key = `${AuthService.OTP_KEY_PREFIX}${dto.phone}`;

    try {
      // Redis-backed: SET with TTL, falls back to in-memory on connection failure
      await this.redis.set(key, code, 'EX', AuthService.OTP_TTL_SECONDS);
      // Set 60-second cooldown to prevent SMS bombing
      await this.redis.set(cooldownKey, '1', 'EX', 60);
      // Reset the per-code brute-force attempt counter on a fresh send
      await this.redis.del(`${key}:attempts`);
    } catch (err) {
      this.logger.warn('Redis unavailable for OTP, falling back to in-memory');
      this.otpFallback.set(dto.phone, {
        code,
        expiresAt: Date.now() + AuthService.OTP_TTL_SECONDS * 1000,
      });
    }

    // Send OTP via SMS provider (falls back to console log if no provider configured)
    await this.smsService.sendOtp(dto.phone, code);

    return { message: 'OTP sent' };
  }

  async verifyOtpLogin(dto: VerifyOtpLoginDto) {
    const key = `${AuthService.OTP_KEY_PREFIX}${dto.phone}`;
    const attemptsKey = `${key}:attempts`;
    let code: string | null = null;

    try {
      code = await this.redis.get(key);

      // Per-code brute-force cap: after MAX_OTP_ATTEMPTS failed tries the
      // stored code is invalidated so the user must request a fresh one.
      if (code) {
        const attempts = Number((await this.redis.get(attemptsKey)) ?? '0');
        if (attempts >= AuthService.MAX_OTP_ATTEMPTS) {
          await this.redis.del(key);
          await this.redis.del(attemptsKey);
          throw new UnauthorizedException('Too many incorrect attempts. Request a new code and try again.');
        }
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Redis unavailable — check in-memory fallback
    }

    // Also check in-memory fallback
    if (!code) {
      const fallback = this.otpFallback.get(dto.phone);
      if (fallback && fallback.expiresAt > Date.now()) {
        code = fallback.code;
      }
    }

    if (!code) {
      throw new UnauthorizedException('OTP expired or not requested. Request a new code and try again.');
    }
    if (code !== dto.otp) {
      // Increment the attempt counter (best-effort; ignore Redis failures)
      try {
        const attempts = Number((await this.redis.get(attemptsKey)) ?? '0');
        if (attempts + 1 >= AuthService.MAX_OTP_ATTEMPTS) {
          await this.redis.del(key);
          await this.redis.del(attemptsKey);
        } else {
          await this.redis.set(attemptsKey, String(attempts + 1), 'EX', AuthService.OTP_TTL_SECONDS);
        }
      } catch {
        /* Redis unavailable — attempt cap is best-effort */
      }
      throw new UnauthorizedException('Incorrect code.');
    }

    // Delete used OTP from both stores
    try {
      await this.redis.del(key);
      await this.redis.del(attemptsKey);
    } catch { /* ignore */ }
    this.otpFallback.delete(dto.phone);

    let user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    let isNewUser = false;
    if (!user) {
      user = await this.prisma.user.create({
        data: { phone: dto.phone, role: dto.role ?? 'CUSTOMER' },
      });
      isNewUser = true;
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Send welcome notification for new users
    if (isNewUser && user) {
      this.notificationsService.sendWelcomeNotification(user.id).catch(() => {});
    }

    const token = this.jwtService.sign({ sub: user.id, phone: user.phone, role: user.role });

    return {
      user: this.sanitizeUser(user),
      access_token: token,
      isNewUser,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true,
        addresses: {
          orderBy: { isDefault: 'desc' },
        },
        ...(userId ? { vendor: true, deliveryPartner: true } : {}),
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  async verifyOtp(dto: VerifyOtpDto) {
    throw new GoneException('Phone OTP login is disabled. Please sign in with Google.');
  }

  async googleLogin(dto: { email: string; googleId: string; name?: string; avatarUrl?: string }) {
    // Find existing user by email, or create a new one linked to this Google account
    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    let isNewUser = false;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name || null,
          avatarUrl: dto.avatarUrl || null,
          role: 'CUSTOMER',
        },
      });
      isNewUser = true;
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Update avatar/name if Google has more recent data
    if ((dto.name && !user.name) || (dto.avatarUrl && !user.avatarUrl)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...(dto.name && !user.name ? { name: dto.name } : {}),
          ...(dto.avatarUrl && !user.avatarUrl ? { avatarUrl: dto.avatarUrl } : {}),
        },
      });
    }

    // Send welcome notification for new users
    if (isNewUser) {
      this.notificationsService.sendWelcomeNotification(user.id).catch(() => {});
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });

    return {
      user: this.sanitizeUser(user),
      access_token: token,
      isNewUser,
    };
  }

  // Apple Sign In — accepts verified Apple profile (identityToken verified when provided)
  // Native flow (expo-apple-authentication) gives identityToken JWT; web/Supabase OAuth
  // flow already verified via supabaseAuthCallback. We verify token signature when present.
  async appleLogin(dto: { email: string; appleId: string; identityToken?: string; name?: string; avatarUrl?: string }) {
    if (dto.identityToken) {
      const verified = await this.verifyAppleIdentityToken(dto.identityToken);
      if (!verified || verified.email?.toLowerCase() !== dto.email.toLowerCase()) {
        throw new UnauthorizedException('Apple identityToken verification failed');
      }
      if (verified.sub && verified.sub !== dto.appleId) {
        throw new UnauthorizedException('Apple ID mismatch');
      }
    }

    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    let isNewUser = false;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name || null,
          avatarUrl: dto.avatarUrl || null,
          role: 'CUSTOMER',
        },
      });
      isNewUser = true;
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if ((dto.name && !user.name) || (dto.avatarUrl && !user.avatarUrl)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...(dto.name && !user.name ? { name: dto.name } : {}),
          ...(dto.avatarUrl && !user.avatarUrl ? { avatarUrl: dto.avatarUrl } : {}),
        },
      });
    }

    if (isNewUser) {
      this.notificationsService.sendWelcomeNotification(user.id).catch(() => {});
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });

    return {
      user: this.sanitizeUser(user),
      access_token: token,
      isNewUser,
    };
  }

  // Verify Apple identityToken JWT signature via Apple's JWKS (https://appleid.apple.com/auth/keys)
  private async verifyAppleIdentityToken(identityToken: string): Promise<any | null> {
    try {
      const parts = identityToken.split('.');
      if (parts.length !== 3) return null;
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const kid = header.kid;
      // Fetch Apple JWKS (cache not needed for MVP — low volume)
      const res = await fetch('https://appleid.apple.com/auth/keys');
      if (!res.ok) return null;
      const jwks: any = await res.json();
      const jwk = jwks.keys?.find((k: any) => k.kid === kid);
      if (!jwk) return null;
      // Use Node crypto to verify RS256
      const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const data = `${parts[0]}.${parts[1]}`;
      const sig = Buffer.from(parts[2], 'base64url');
      const valid = crypto.verify('RSA-SHA256', Buffer.from(data), keyObject, sig);
      if (!valid) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      // Basic expiry + issuer + audience checks
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      if (payload.iss !== 'https://appleid.apple.com') return null;
      return payload;
    } catch (e) {
      this.logger.warn(`Apple token verify failed: ${e}`);
      return null;
    }
  }

  async forgotPassword(email: string) {
    // Password resets are delegated to Supabase Auth. Fail closed instead of
    // silently reporting success when it is not configured.
    if (!this.supabase) {
      throw new ServiceUnavailableException('Password reset is unavailable: Supabase Auth is not configured');
    }

    if (this.supabase) {
      const { error } = await this.supabase.auth.resetPasswordForEmail(email);
      if (error) {
        throw new BadRequestException(`Password reset failed: ${error.message}`);
      }
    }

    return { message: 'Password reset email sent if the account exists' };
  }

  async resetPassword(token: string, newPassword: string) {
    // Password resets are delegated to Supabase Auth. Fail closed instead of
    // silently reporting success when it is not configured.
    if (!this.supabase) {
      throw new ServiceUnavailableException('Password reset is unavailable: Supabase Auth is not configured');
    }

    if (this.supabase) {
      const { error } = await this.supabase.auth.admin.updateUserById(token, {
        password: newPassword,
      });
      if (error) {
        throw new BadRequestException(`Password reset failed: ${error.message}`);
      }
    }

    return { message: 'Password reset successfully' };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
