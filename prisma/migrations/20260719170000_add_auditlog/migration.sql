CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_adminId_fkey"
FOREIGN KEY ("adminId")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "AuditLog_adminId_createdAt_idx"
ON "AuditLog"("adminId","createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_resource_resourceId_idx"
ON "AuditLog"("resource","resourceId");

CREATE INDEX IF NOT EXISTS "AuditLog_action_idx"
ON "AuditLog"("action");