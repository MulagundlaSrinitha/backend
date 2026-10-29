import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { VendorsModule } from './vendors/vendors.module';
import { ProductsModule } from './products/products.module';
import { UploadModule } from './upload/upload.module';
import { AddressesModule } from './addresses/addresses.module';
import { CartModule } from './cart/cart.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CouponsModule } from './coupons/coupons.module';
import { OffersModule } from './offers/offers.module';
import { ReturnsModule } from './returns/returns.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { CommissionModule } from './commission/commission.module';
import { BrandsModule } from './brands/brands.module';
import { KycModule } from './kyc/kyc.module';
import { SubCategoriesModule } from './sub-categories/sub-categories.module';
import { RolesModule } from './roles/roles.module';
import { CmsModule } from './cms/cms.module';
import { InventoryModule } from './inventory/inventory.module';
import { AiModule } from './ai/ai.module';
import { SeedModule } from './seed/seed.module';
import { DeliveryPartnersModule } from './delivery-partners/delivery-partners.module';
import { ZonesModule } from './zones/zones.module';
import { DisputesModule } from './disputes/disputes.module';
import { DeliveryModule } from './delivery/delivery.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { DeliverySlotModule } from './delivery-slot/delivery-slot.module';
import { SupportModule } from './support/support.module';
import { ReportsModule } from './reports/reports.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { PayoutsModule } from './payouts/payouts.module';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from './queue/queue.module';
import { RazorpayModule } from './razorpay/razorpay.module';
import { SmsModule } from './providers/sms/sms.module';
import { EmailModule } from './providers/email/email.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ThrottlerGuard } from './common/guards/throttler.guard';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      },
    }),
    // Single named throttler only. NestJS's global guard checks EVERY route
    // against EVERY registered throttler unless the route opts out — a second
    // 'auth' throttler here was silently capping the whole API (categories,
    // orders, everything) at 5 requests/minute, not just the login endpoints
    // it was meant for. Routes that need a stricter cap override 'default'
    // locally via @Throttle({ default: { ... } }) instead of adding a new name.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 1000,
        limit: 30,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    VendorsModule,
    ProductsModule,
    UploadModule,
    AddressesModule,
    CartModule,
    WishlistModule,
    ReviewsModule,
    CouponsModule,
    OffersModule,
    ReturnsModule,
    NotificationsModule,
    OrdersModule,
    PaymentsModule,
    CommissionModule,
    BrandsModule,
    KycModule,
    SubCategoriesModule,
    RolesModule,
    CmsModule,
    InventoryModule,
    AiModule,
    SeedModule,
    DeliveryPartnersModule,
    ZonesModule,
    DisputesModule,
    AuditModule,
    AdminModule,
    DeliverySlotModule,
    DeliveryModule,
    SupportModule,
    ReportsModule,
    LoyaltyModule,
    PayoutsModule,
    QueueModule,
    RazorpayModule,
    SmsModule,
    EmailModule,
  ],
  providers: [
    // Global rate limiting — ThrottlerModule.forRoot() above only defines the
    // limits; without this registration no route is actually throttled.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
