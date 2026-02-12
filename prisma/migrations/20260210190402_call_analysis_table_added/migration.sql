-- CreateTable
CREATE TABLE "call_analysis" (
    "id" TEXT NOT NULL,
    "callSid" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "transcript" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_analysis_callSid_key" ON "call_analysis"("callSid");
