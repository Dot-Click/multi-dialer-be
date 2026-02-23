-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);
