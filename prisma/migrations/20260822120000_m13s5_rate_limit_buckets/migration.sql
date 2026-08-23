CREATE TABLE "RateLimitBucket" (
    "scopeKey" VARCHAR(64) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("scopeKey", "windowStart"),
    CONSTRAINT "RateLimitBucket_requestCount_check" CHECK ("requestCount" >= 0)
);

CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
