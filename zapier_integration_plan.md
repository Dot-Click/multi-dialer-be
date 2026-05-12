# Zapier Integration Implementation Plan

This document outlines the technical strategy for replacing GoHighLevel (GHL) with a direct Zapier integration. This will allow the Multi-Dialer platform to receive leads from any external source (Facebook, Google Sheets, etc.) via a secure webhook.

## 1. Database Schema Changes

We need to store unique API keys for each user to secure the webhooks.

### [User Model Update]
Add an `apiKey` field to the `User` model to facilitate secure webhook access.
```prisma
model User {
  // ... existing fields
  apiKey    String?   @unique @default(cuid())
  // ...
}
```

## 2. Backend Architecture

### New Webhook Endpoint
- **URL**: `POST /api/webhooks/zapier/:apiKey`
- **Method**: `POST`
- **Authentication**: The `:apiKey` in the URL identifies the user. No JWT required for the public Zapier call.

### Logic Flow (`processZapierWebhook`)
1. **Identify User**: Look up the user by the provided `apiKey`.
2. **Normalize Data**: 
    - Auto-map `Name`, `Full Name`, `FirstName` + `LastName` to `fullName`.
    - Auto-map `Phone`, `Mobile`, `Cell` to the contact's phone list.
    - Auto-map `Email` to the contact's email list.
3. **Capture Extra Data**: All other incoming fields (e.g., "Interest", "Industry") will be stored in the `miscValues` JSON blob.
4. **Duplicate Handling**: Use the existing duplicate detection logic (Phone/Email) to either "Keep Old" or "Overwrite."
5. **Auto-Assignment**: 
    - Create/Find a list named "Zapier Imports" for that user.
    - Assign the new contact to that list immediately.

## 3. Frontend Implementation

### Integrations Settings Page
A new tab in the Admin settings for managing the Zapier connection.

- **Webhook URL Display**: A "copy to clipboard" box containing: `https://api.yourdomain.com/api/webhooks/zapier/[USER_API_KEY]`
- **Key Rotation**: A "Regenerate Key" button for security.
- **Setup Guide**: 
    1. Create a Zap in Zapier.
    2. Choose "Webhooks by Zapier" as the Action.
    3. Select "POST" and paste your URL.
    4. Map your lead fields to our standard keys.

## 4. Why this replaces GHL effectively?
- **Cost**: Zero additional cost to the client (using Zapier's free/cheap tiers).
- **Control**: You no longer rely on GHL's API or sub-account limits.
- **Scalability**: You can handle thousands of leads from hundreds of different sources simultaneously.

## 5. Security Considerations
- **API Key Scoping**: The API key is ONLY valid for the `/api/webhooks` routes. It cannot be used to delete contacts or access sensitive admin data.
- **Rate Limiting**: Implement a 60-requests-per-minute limit per API key to prevent spam.
