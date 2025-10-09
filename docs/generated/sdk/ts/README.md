# SMS Marketing Backend API - TypeScript SDK

A lightweight, type-safe TypeScript SDK for the SMS Marketing Backend API.

## Installation

```bash
# Copy the SDK file to your project
cp sms-marketing-api.ts src/api/
```

## Usage

### Basic Setup

```typescript
import { SmsMarketingApiClient, createSmsMarketingClient } from './sms-marketing-api';

// Create a client instance
const client = createSmsMarketingClient({
  baseUrl: 'http://localhost:3001',
  accessToken: 'your-jwt-token-here',
  timeout: 30000, // optional, defaults to 30 seconds
});

// Or use the class directly
const client = new SmsMarketingApiClient({
  baseUrl: 'http://localhost:3001',
  accessToken: 'your-jwt-token-here',
});
```

### Authentication

```typescript
// Register a new user
const registerResponse = await client.register({
  email: 'user@example.com',
  password: 'password123',
  senderName: 'MyStore',
  company: 'My Company Ltd'
});

// Login
const loginResponse = await client.login({
  email: 'user@example.com',
  password: 'password123'
});

// Set the access token
client.setAccessToken(loginResponse.data.accessToken);

// Get current user with credits
const user = await client.getCurrentUser();
console.log(`User: ${user.data.email}, Credits: ${user.data.credits}`);
```

### Contact Management

```typescript
// Create a contact
const contact = await client.createContact({
  phone: '+1234567890',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  gender: 'male',
  birthday: '1990-01-01'
});

// List contacts with pagination
const contacts = await client.getContacts({
  page: 1,
  pageSize: 20,
  isSubscribed: true
});

// Update contact
const updatedContact = await client.updateContact(contact.data.id, {
  firstName: 'Jane',
  lastName: 'Smith',
  isSubscribed: true
});

// Delete contact
await client.deleteContact(contact.data.id);
```

### List Management

```typescript
// Create a contact list
const list = await client.createList({
  name: 'VIP Customers',
  description: 'High-value customers'
});

// Add contact to list
await client.addContactToList(list.data.id, contact.data.id);

// Get list members
const members = await client.getListMembers(list.data.id, {
  page: 1,
  pageSize: 50
});
```

### Template Management

```typescript
// Create a message template
const template = await client.createTemplate({
  name: 'Welcome Message',
  text: 'Welcome to our store! Use code WELCOME10 for 10% off your first purchase.'
});

// List templates
const templates = await client.getTemplates({
  page: 1,
  pageSize: 20
});
```

### Campaign Management

```typescript
// Create a campaign with template
const campaign = await client.createCampaign({
  name: 'Black Friday Sale',
  templateId: template.data.id,
  listId: 'ALL', // or specific list ID
  scheduledAt: '2024-11-29T09:00:00Z'
});

// Create a campaign with custom text
const campaign2 = await client.createCampaign({
  name: 'Flash Sale',
  text: 'Flash sale! 50% off everything today only! Use code FLASH50',
  listId: list.data.id.toString()
});

// Preview campaign
const preview = await client.previewCampaign(campaign.data.id);
console.log(`Will send to ${preview.data.totalRecipients} recipients`);

// Enqueue campaign (starts sending)
const enqueueResult = await client.enqueueCampaign(campaign.data.id);
console.log(`Queued ${enqueueResult.data.queued} messages`);

// Get campaign status
const status = await client.getCampaignStatus(campaign.data.id);
console.log(`Status: ${status.data.metrics.sent} sent, ${status.data.metrics.delivered} delivered`);
```

### Campaign Analytics

```typescript
// Get campaign statistics
const stats = await client.getCampaignStats(campaign.data.id);
console.log(`Conversion rate: ${stats.data.conversionRate * 100}%`);

// Get bulk campaign stats
const bulkStats = await client.getBulkCampaignStats([1, 2, 3]);
```

### Dashboard

```typescript
// Get dashboard KPIs
const kpis = await client.getDashboardKPIs();
console.log(`Total campaigns: ${kpis.data.totalCampaigns}`);
console.log(`Total messages: ${kpis.data.totalMessages}`);
console.log(`Delivery rate: ${kpis.data.deliveredRate * 100}%`);
```

### Billing

```typescript
// Get wallet balance
const balance = await client.getWalletBalance();
console.log(`Current balance: ${balance.data.balance} credits`);

// List available packages
const packages = await client.getPackages();
console.log('Available packages:', packages.data);

// Purchase credits
const purchase = await client.purchasePackage(1, 'unique-idempotency-key');
console.log(`Purchased ${purchase.data.credited} credits`);
console.log(`New balance: ${purchase.data.balance} credits`);
```

### Tracking

```typescript
// Check tracking ID (public endpoint)
const trackingCheck = await client.checkTrackingId('abc123def456');
console.log(`Exists: ${trackingCheck.data.exists}, Redeemed: ${trackingCheck.data.alreadyRedeemed}`);

// Redeem tracking ID
const redeemResult = await client.redeemTrackingId('abc123def456');
console.log(`Redemption status: ${redeemResult.data.status}`);

// Get offer details (public endpoint)
const offer = await client.getOfferDetails('abc123def456');
console.log(`Store: ${offer.data.storeName}`);
console.log(`Offer: ${offer.data.offerText}`);
```

### Error Handling

```typescript
try {
  const response = await client.getCurrentUser();
  console.log('User:', response.data);
} catch (error) {
  if (error.message.includes('401')) {
    console.log('Authentication required');
    // Redirect to login or refresh token
  } else if (error.message.includes('429')) {
    console.log('Rate limit exceeded');
    // Wait and retry
  } else {
    console.error('API Error:', error.message);
  }
}
```

### Configuration

```typescript
// Update configuration
client.setAccessToken('new-token');
client.setBaseUrl('https://api.production.com');

// Get current configuration
const token = client.getAccessToken();
const baseUrl = client.getBaseUrl();
```

## Type Safety

The SDK provides full TypeScript type safety for all API responses and request parameters:

```typescript
// All responses are typed
const contact: Contact = response.data; // Fully typed Contact object

// Request parameters are validated
await client.createContact({
  phone: '+1234567890', // ✅ Valid
  // phone: 'invalid', // ❌ TypeScript error
});
```

## Response Format

All API methods return a standardized response format:

```typescript
interface ApiResponse<T> {
  data: T;           // The actual response data
  status: number;    // HTTP status code
  statusText: string; // HTTP status text
  headers: Headers;   // Response headers
}
```

## Pagination

Paginated endpoints return a standardized format:

```typescript
interface PaginatedResponse<T> {
  items: T[];        // Array of items
  total: number;     // Total number of items
  page: number;      // Current page
  pageSize: number;  // Items per page
}
```

## Rate Limiting

The API implements rate limiting. The SDK will throw errors for rate limit violations (HTTP 429). Implement retry logic with exponential backoff:

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.message.includes('429') && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const contacts = await retryWithBackoff(() => 
  client.getContacts({ page: 1, pageSize: 20 })
);
```

## Environment Variables

For production usage, consider using environment variables:

```typescript
const client = createSmsMarketingClient({
  baseUrl: process.env.SMS_API_BASE_URL || 'http://localhost:3001',
  accessToken: process.env.SMS_API_TOKEN,
  timeout: parseInt(process.env.SMS_API_TIMEOUT || '30000'),
});
```

## License

This SDK is part of the SMS Marketing Backend project and follows the same license terms.
