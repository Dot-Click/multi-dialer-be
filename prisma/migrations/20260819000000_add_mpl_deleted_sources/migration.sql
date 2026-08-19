-- CreateTable
CREATE TABLE "my_plus_leads_deleted_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "my_plus_leads_deleted_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "my_plus_leads_deleted_sources_userId_idx" ON "my_plus_leads_deleted_sources"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "my_plus_leads_deleted_sources_userId_source_key" ON "my_plus_leads_deleted_sources"("userId", "source");

-- AddForeignKey
ALTER TABLE "my_plus_leads_deleted_sources" ADD CONSTRAINT "my_plus_leads_deleted_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
