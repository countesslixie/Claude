-- CreateTable
CREATE TABLE "ClientBirLogin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "eafsUsername" TEXT,
    "eafsPassword" TEXT,
    "eafsNotes" TEXT,
    "alphalistUsername" TEXT,
    "alphalistPassword" TEXT,
    "alphalistNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientBirLogin_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientBirLogin_clientId_key" ON "ClientBirLogin"("clientId");
