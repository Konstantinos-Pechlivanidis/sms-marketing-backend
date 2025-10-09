# SMS Marketing Backend API Documentation

Complete documentation for the SMS Marketing Backend API - a comprehensive SMS marketing platform built with Node.js/Express, PostgreSQL, and Redis.

## 📚 Documentation Overview

This documentation set provides everything you need to integrate with the SMS Marketing Backend API:

- **OpenAPI 3.1 Specification** - Complete API reference with examples
- **Interactive Documentation** - Built with Redocly for easy navigation
- **Postman Collection** - Ready-to-use API testing collection
- **TypeScript SDK** - Type-safe client library
- **Database Schema** - Entity Relationship Diagram (ERD)

## 🚀 Quick Start

### 1. Generate Types
```bash
npm run openapi:types
```

### 2. Build Documentation Site
```bash
npm run docs:build
```

### 3. Serve Documentation Locally
```bash
npm run docs:serve
```
Open http://localhost:8088 to view the interactive documentation.

### 4. Generate Database ERD
```bash
npm run prisma:erd
```

## 📁 Documentation Structure

```
docs/
├── openapi/
│   └── openapi.yaml          # OpenAPI 3.1 specification
├── site/                      # Built documentation site (generated)
├── generated/
│   ├── openapi-types/
│   │   └── openapi-types.d.ts # Generated TypeScript types
│   └── sdk/
│       └── ts/              # TypeScript SDK
├── postman/
│   └── collection.json      # Postman collection
├── erd/
│   └── diagram.svg          # Database ERD
└── README.md               # This file
```

## 🔧 Available Scripts

| Script | Description |
|--------|-------------|
| `docs:lint` | Lint OpenAPI specification |
| `docs:build` | Build documentation site |
| `docs:serve` | Serve documentation locally |
| `openapi:types` | Generate TypeScript types |
| `prisma:erd` | Generate database ERD |
| `docs:generate` | Run all generation tasks |

## 🏗️ API Architecture

### Technology Stack
- **Runtime**: Node.js with Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis (optional, falls back to in-memory)
- **Queue**: BullMQ for background jobs
- **Auth**: JWT with refresh tokens
- **Rate Limiting**: Redis-backed with fallback

### Key Features
- **Multi-tenant**: User-scoped data isolation
- **Rate Limited**: Configurable per-endpoint limits
- **Idempotent**: Safe retry mechanisms
- **Real-time**: WebSocket support for live updates
- **Scalable**: Horizontal scaling ready

## 🔐 Authentication

The API uses JWT-based authentication with refresh tokens:

```typescript
// Login flow
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});

const { accessToken, user } = await response.json();

// Use access token for authenticated requests
const apiResponse = await fetch('/api/me', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

### Token Management
- **Access Token**: Short-lived (15 minutes), used for API requests
- **Refresh Token**: Long-lived (7 days), stored in httpOnly cookie
- **Auto-refresh**: SDK handles token renewal automatically

## 📊 Rate Limiting

The API implements comprehensive rate limiting:

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Public endpoints | 60 req/min | Per IP |
| Authenticated endpoints | 200 req/min | Per IP |
| Login attempts | 8 req/10min | Per email |
| Registration | 2 req/10min | Per email |
| Contact operations | 60 req/min | Per IP |

## 🗄️ Database Schema

The API uses PostgreSQL with the following main entities:

### Core Entities
- **Users**: Account management and authentication
- **Contacts**: Customer information and segmentation
- **Lists**: Contact grouping and targeting
- **Templates**: Reusable message templates
- **Campaigns**: SMS campaign management
- **Messages**: Individual SMS tracking
- **Redemptions**: Offer redemption tracking

### System Lists
- **Male/Female**: Auto-managed gender-based lists
- **High Conversions**: Virtual list based on redemption count
- **All Contacts**: Virtual list for broadcast campaigns

## 📱 SMS Campaign Flow

1. **Create Campaign**: Define message and audience
2. **Preview**: Review rendered messages
3. **Enqueue**: Start sending (debits credits)
4. **Track**: Monitor delivery and engagement
5. **Analyze**: Review performance metrics

## 💰 Billing System

### Credit-Based System
- **Wallet**: User credit balance
- **Packages**: Predefined credit bundles
- **Transactions**: Credit debit/credit history
- **Campaign Cost**: 1 credit per SMS sent

### Purchase Flow
1. **Select Package**: Choose credit bundle
2. **Purchase**: Process payment (Stripe integration)
3. **Credit Wallet**: Add credits to user balance
4. **Use Credits**: Automatically debit for campaigns

## 🔄 Background Jobs

### Job Types
- **SMS Sending**: Queue and process SMS messages
- **Campaign Scheduling**: Delayed campaign execution
- **Automation Triggers**: Birthday/nameday messages
- **Webhook Processing**: External service integration

### Queue Health
Monitor job queue health via `/api/jobs/health` endpoint.

## 📈 Analytics & Tracking

### Campaign Metrics
- **Delivery Rate**: Percentage of successfully delivered messages
- **Conversion Rate**: Percentage of messages resulting in redemptions
- **Engagement**: Click-through and redemption tracking
- **Real-time**: Live campaign progress monitoring

### Dashboard KPIs
- **Total Campaigns**: Number of campaigns created
- **Total Messages**: Total SMS sent
- **Overall Performance**: Aggregate delivery and conversion rates

## 🔗 Webhooks

### Supported Webhooks
- **Campaign Completed**: Triggered when campaign finishes
- **Delivery Reports**: SMS delivery status updates
- **Inbound Messages**: STOP detection and response handling

### Webhook Security
- **HMAC Verification**: Cryptographic signature validation
- **Retry Logic**: Automatic retry with exponential backoff
- **Idempotency**: Duplicate event handling

## 🛠️ Development

### Local Setup
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Run database migrations
npm run prisma:migrate

# Start development server
npm run dev
```

### Environment Variables
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sms_marketing"
DIRECT_DATABASE_URL="postgresql://user:password@localhost:5432/sms_marketing"

# Redis (optional)
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-secret-key"

# CORS
CORS_ALLOWLIST="http://localhost:3000,https://yourdomain.com"

# Rate Limiting
RL_PUBLIC_POINTS=60
RL_AUTH_POINTS=200
```

## 🧪 Testing

### Postman Collection
Import the provided Postman collection for comprehensive API testing:

1. Import `docs/postman/collection.json`
2. Set environment variables:
   - `baseUrl`: Your API base URL
   - `accessToken`: JWT token (auto-set on login)

### SDK Testing
```typescript
import { createSmsMarketingClient } from './docs/generated/sdk/ts/sms-marketing-api';

const client = createSmsMarketingClient({
  baseUrl: 'http://localhost:3001',
  accessToken: 'your-token'
});

// Test API calls
const user = await client.getCurrentUser();
console.log('User:', user.data);
```

## 📋 API Reference

### Endpoints Overview

#### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user

#### User Management
- `GET /api/me` - Get current user profile
- `PUT /api/user` - Update user profile
- `PUT /api/user/password` - Change password

#### Contacts
- `GET /api/contacts` - List contacts
- `POST /api/contacts` - Create contact
- `GET /api/contacts/{id}` - Get contact
- `PUT /api/contacts/{id}` - Update contact
- `DELETE /api/contacts/{id}` - Delete contact

#### Lists
- `GET /api/lists` - List contact lists
- `POST /api/lists` - Create list
- `GET /api/lists/{id}` - Get list
- `GET /api/lists/{id}/contacts` - Get list members
- `POST /api/lists/{id}/contacts/{contactId}` - Add contact to list
- `DELETE /api/lists/{id}/contacts/{contactId}` - Remove contact from list

#### Templates
- `GET /api/templates` - List templates
- `POST /api/templates` - Create template
- `GET /api/templates/{id}` - Get template
- `PUT /api/templates/{id}` - Update template
- `DELETE /api/templates/{id}` - Delete template

#### Campaigns
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns/{id}` - Get campaign
- `PUT /api/campaigns/{id}` - Update campaign
- `DELETE /api/campaigns/{id}` - Delete campaign
- `GET /api/campaigns/{id}/preview` - Preview campaign
- `POST /api/campaigns/{id}/enqueue` - Enqueue campaign
- `GET /api/campaigns/{id}/status` - Get campaign status

#### Analytics
- `GET /api/v1/campaigns/stats` - Bulk campaign stats
- `GET /api/v1/campaigns/{id}/stats` - Campaign statistics
- `GET /api/dashboard/kpis` - Dashboard KPIs

#### Billing
- `GET /api/billing/balance` - Get wallet balance
- `GET /api/billing/transactions` - List credit transactions
- `GET /api/billing/packages` - List available packages
- `POST /api/billing/purchase` - Purchase credit package

#### Tracking
- `GET /tracking/redeem/{trackingId}` - Check tracking ID (public)
- `POST /tracking/redeem` - Redeem tracking ID
- `GET /api/tracking/offer/{trackingId}` - Get offer details (public)

#### Public Endpoints
- `POST /api/contacts/enroll` - Public contact enrollment
- `POST /api/contacts/unsubscribe` - Public unsubscribe
- `GET /api/contacts/enroll/{code}` - Resolve enrollment code

## 🔍 Error Handling

### Standard Error Response
```json
{
  "message": "Error description",
  "code": "ERROR_CODE",
  "details": {},
  "traceId": "unique-trace-id"
}
```

### Common Error Codes
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (duplicate resource)
- `422` - Validation Error (invalid request data)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## 📞 Support

For questions, issues, or contributions:

1. **Documentation Issues**: Check the OpenAPI specification
2. **API Questions**: Review the interactive documentation
3. **Integration Help**: Use the provided SDK and examples
4. **Bug Reports**: Include request/response details and trace IDs

## 📄 License

This project is licensed under the ISC License. See the main project repository for details.

---

**Generated Documentation** - Last updated: $(date)
**API Version**: 1.0.0
**OpenAPI Version**: 3.1.0
