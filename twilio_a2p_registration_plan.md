# Twilio A2P 10DLC Automated Registration Plan

This plan outlines the process for automating the mandatory A2P 10DLC registration for new customers during the onboarding flow. This ensures compliance with US carrier regulations for SMS.

## 1. Prerequisites (Data Collection)
To automate registration, we must collect the following additional fields during the **Signup Process**:
- **Legal Business Name** (Must match Tax records exactly)
- **Business Type** (Corporation, LLC, etc.)
- **EIN (Employer Identification Number)** (9-digit US Tax ID)
- **Business Website URL**
- **Business Address**
- **Point of Contact** (Name, Email, Phone)

## 2. Technical Workflow (Backend)
  
The registration will be triggered automatically after the **Twilio Sub-account** is created and the initial payment is confirmed.

### Step 1: Twilio Trust Hub Registration
We will use the Twilio `Trust Hub API` to register the business identity.
1. **Create Customer Profile**: Submit the EIN and business details.
2. **Register Brand**: Create a "Brand" entity tied to the Customer Profile. This verifies the business with the carriers.

### Step 2: Messaging Service & Number Provisioning
1. **Create Messaging Service**: A container for the user's messaging traffic.
2. **Provision Phone Number**: Buy a local 10DLC number and add it to the Messaging Service.

### Step 3: A2P Campaign Submission
Register the "use case" (e.g., "Low Volume Mixed" or "Marketing").
- **Requirements**:
    - **Use Case Description**: (e.g., "Sending account alerts and follow-up messages to customers who have opted-in.")
    - **Sample Messages**: 2-3 examples of typical SMS sent via the dialer.
    - **Opt-in Description**: Explanation of how users give consent (e.g., "Customers opt-in via a lead form on our website.")

### Step 4: Status Monitoring
- **Polling/Webhooks**: Implement a worker to check the `brand_registration_status` and `campaign_status`.
- **Approval Logic**:
    - **Pending**: User can make calls but SMS is blocked/queued.
    - **Approved**: SMS functionality is fully enabled.
    - **Rejected**: Notify admin/user to correct business details.

## 3. UI/UX Changes
- **Signup Form**: Add a "Business Details" step after plan selection.
- **User Dashboard**: Add a status badge: `SMS Status: Pending Approval`.

## 4. Automation Service Structure
Create a `src/services/twilioRegistrationService.ts`:
```typescript
class TwilioRegistrationService {
  async registerA2P(userId: string) {
    // 1. Create Trust Hub Profile
    // 2. Register Brand
    // 3. Create Messaging Service
    // 4. Submit Campaign
  }
}
```

## 5. Security & Costs
- **Security**: Store EINs encrypted in the database or only in memory during the registration call.
- **Costs**: Twilio Brand/Campaign fees should be automatically deducted from the user's balance or included in your platform subscription.
