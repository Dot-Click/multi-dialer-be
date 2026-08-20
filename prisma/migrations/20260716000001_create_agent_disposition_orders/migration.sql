-- CreateTable
CREATE TABLE "agent_disposition_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dispositionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_disposition_orders_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "agent_disposition_orders_userId_dispositionId_key" ON "agent_disposition_orders"("userId", "dispositionId");
-- AddForeignKey
ALTER TABLE "agent_disposition_orders" ADD CONSTRAINT "agent_disposition_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agent_disposition_orders" ADD CONSTRAINT "agent_disposition_orders_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "dispositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
