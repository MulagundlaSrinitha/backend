import { Global, Module } from '@nestjs/common';
import { RazorpayService } from './razorpay.service';

@Global()
@Module({
  providers: [RazorpayService],
  exports: [RazorpayService],
})
export class RazorpayModule {}
