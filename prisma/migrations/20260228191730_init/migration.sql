-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "expiryDate" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "latestSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingEvent" (
    "id" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "from" TEXT,
    "subject" TEXT,
    "snippet" TEXT,
    "source" TEXT NOT NULL,
    "listingId" TEXT,

    CONSTRAINT "ListingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_email_key" ON "OAuthToken"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_urlHash_key" ON "Listing"("urlHash");

-- CreateIndex
CREATE INDEX "ListingEvent_urlHash_idx" ON "ListingEvent"("urlHash");

-- CreateIndex
CREATE UNIQUE INDEX "ListingEvent_emailMessageId_urlHash_key" ON "ListingEvent"("emailMessageId", "urlHash");

-- AddForeignKey
ALTER TABLE "ListingEvent" ADD CONSTRAINT "ListingEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
