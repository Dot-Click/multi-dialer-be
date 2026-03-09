-- CreateTable
CREATE TABLE "misc_fields" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "options" TEXT[],
    "countFrom" INTEGER,
    "countTo" INTEGER,
    "allowPastDates" BOOLEAN,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "misc_fields_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "misc_fields" ADD CONSTRAINT "misc_fields_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
