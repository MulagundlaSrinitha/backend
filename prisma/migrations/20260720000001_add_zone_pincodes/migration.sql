-- Add pincodes array field to Zone model for serviceable pincode lists
ALTER TABLE "Zone" ADD COLUMN IF NOT EXISTS "pincodes" TEXT[] DEFAULT '{}'::TEXT[];
