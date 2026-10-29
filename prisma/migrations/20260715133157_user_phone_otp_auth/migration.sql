-- Phone-first auth for the customer app (Zomato-style OTP): phone becomes
-- unique like email already was, and email becomes optional since phone-OTP
-- signups never set it. Postgres unique indexes don't apply across NULLs, so
-- both columns can be freely absent while still being unique when set.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
