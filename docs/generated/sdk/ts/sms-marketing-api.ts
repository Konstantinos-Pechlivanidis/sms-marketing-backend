/**
 * SMS Marketing Backend API Client
 * Generated TypeScript SDK for SMS Marketing Backend API
 * 
 * This is a lightweight fetch-based client for the SMS Marketing Backend API.
 * It provides type-safe methods for all API endpoints.
 */

export interface ApiConfig {
  baseUrl: string;
  accessToken?: string;
  timeout?: number;
}

export interface ApiResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ErrorResponse {
  message: string;
  code?: string;
  details?: any;
  traceId?: string;
}

// Base types
export interface User {
  id: number;
  email: string;
  name?: string;
  senderName?: string;
  company?: string;
  createdAt: string;
}

export interface UserWithCredits extends User {
  credits: number;
}

export interface Contact {
  id: number;
  ownerId: number;
  phone: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  birthday?: string;
  isSubscribed: boolean;
  unsubscribedAt?: string;
}

export interface List {
  id: number;
  ownerId: number;
  name: string;
  description?: string;
  isSystem: boolean;
  slug?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplate {
  id: number;
  ownerId: number;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: number;
  ownerId: number;
  name: string;
  templateId?: number;
  listId?: number;
  bodyOverride?: string;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed';
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  total: number;
  sent: number;
  failed: number;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignStats {
  campaignId: number;
  sent: number;
  delivered: number;
  failed: number;
  redemptions: number;
  unsubscribes: number;
  deliveredRate: number;
  conversionRate: number;
  firstSentAt?: string;
}

export interface WalletBalance {
  balance: number;
}

export interface CreditTransaction {
  id: number;
  ownerId: number;
  type: 'credit' | 'debit' | 'refund';
  amount: number;
  balanceAfter: number;
  reason?: string;
  campaignId?: number;
  messageId?: number;
  meta?: any;
  createdAt: string;
}

export interface Package {
  id: number;
  name: string;
  units: number;
  priceCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Purchase {
  id: number;
  ownerId: number;
  packageId: number;
  units: number;
  priceCents: number;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KPI {
  totalCampaigns: number;
  totalMessages: number;
  sent: number;
  delivered: number;
  failed: number;
  deliveredRate: number;
  conversion: number;
  conversionRate: number;
}

export interface Automation {
  id: number;
  ownerId: number;
  title: string;
  message: string;
  isActive: boolean;
  trigger: string;
  isSystem: boolean;
  systemSlug?: string;
  createdAt: string;
  updatedAt: string;
}

export class SmsMarketingApiClient {
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.config.accessToken) {
      headers['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let data: T;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = (await response.text()) as T;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // Authentication methods
  async register(data: {
    email: string;
    password: string;
    senderName?: string;
    company?: string;
  }): Promise<ApiResponse<User>> {
    return this.request<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: {
    email: string;
    password: string;
  }): Promise<ApiResponse<{ accessToken: string; user: User }>> {
    return this.request<{ accessToken: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async refresh(): Promise<ApiResponse<{ accessToken: string; user: User }>> {
    return this.request<{ accessToken: string; user: User }>('/api/auth/refresh', {
      method: 'POST',
    });
  }

  async logout(): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
  }

  // User management methods
  async getCurrentUser(): Promise<ApiResponse<UserWithCredits>> {
    return this.request<UserWithCredits>('/api/me');
  }

  async updateUser(data: {
    name?: string;
    senderName?: string;
    company?: string;
  }): Promise<ApiResponse<User>> {
    return this.request<User>('/api/user', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async changePassword(data: {
    oldPassword: string;
    newPassword: string;
  }): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('/api/user/password', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Contact methods
  async getContacts(params?: {
    page?: number;
    pageSize?: number;
    q?: string;
    isSubscribed?: boolean;
    listId?: number;
    gender?: string;
    birthdayFrom?: string;
    birthdayTo?: string;
    minConversions?: number;
  }): Promise<ApiResponse<PaginatedResponse<Contact>>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<PaginatedResponse<Contact>>(
      `/api/contacts${query ? `?${query}` : ''}`
    );
  }

  async createContact(data: {
    phone: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    gender?: 'male' | 'female' | 'other' | 'unknown';
    birthday?: string;
  }): Promise<ApiResponse<Contact>> {
    return this.request<Contact>('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getContact(id: number): Promise<ApiResponse<Contact>> {
    return this.request<Contact>(`/api/contacts/${id}`);
  }

  async updateContact(
    id: number,
    data: {
      phone?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      gender?: 'male' | 'female' | 'other' | 'unknown';
      birthday?: string;
      isSubscribed?: boolean;
    }
  ): Promise<ApiResponse<Contact>> {
    return this.request<Contact>(`/api/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteContact(id: number): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>(`/api/contacts/${id}`, {
      method: 'DELETE',
    });
  }

  async generateEnrollmentCode(): Promise<ApiResponse<{ code: string }>> {
    return this.request<{ code: string }>('/api/contacts/enroll-code', {
      method: 'POST',
    });
  }

  // List methods
  async getLists(params?: {
    page?: number;
    pageSize?: number;
    q?: string;
  }): Promise<ApiResponse<PaginatedResponse<List>>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<PaginatedResponse<List>>(
      `/api/lists${query ? `?${query}` : ''}`
    );
  }

  async createList(data: {
    name: string;
    description?: string;
  }): Promise<ApiResponse<List>> {
    return this.request<List>('/api/lists', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getList(id: number): Promise<ApiResponse<List>> {
    return this.request<List>(`/api/lists/${id}`);
  }

  async getListMembers(
    id: number,
    params?: {
      page?: number;
      pageSize?: number;
      isSubscribed?: boolean;
      minConversions?: number;
    }
  ): Promise<ApiResponse<PaginatedResponse<Contact>>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<PaginatedResponse<Contact>>(
      `/api/lists/${id}/contacts${query ? `?${query}` : ''}`
    );
  }

  async addContactToList(
    listId: number,
    contactId: number
  ): Promise<ApiResponse<{ id: number; listId: number; contactId: number; createdAt: string }>> {
    return this.request<{ id: number; listId: number; contactId: number; createdAt: string }>(
      `/api/lists/${listId}/contacts/${contactId}`,
      {
        method: 'POST',
      }
    );
  }

  async removeContactFromList(
    listId: number,
    contactId: number
  ): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>(
      `/api/lists/${listId}/contacts/${contactId}`,
      {
        method: 'DELETE',
      }
    );
  }

  // Template methods
  async getTemplates(params?: {
    page?: number;
    pageSize?: number;
    q?: string;
  }): Promise<ApiResponse<PaginatedResponse<MessageTemplate>>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<PaginatedResponse<MessageTemplate>>(
      `/api/templates${query ? `?${query}` : ''}`
    );
  }

  async createTemplate(data: {
    name: string;
    text: string;
  }): Promise<ApiResponse<MessageTemplate>> {
    return this.request<MessageTemplate>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getTemplate(id: number): Promise<ApiResponse<MessageTemplate>> {
    return this.request<MessageTemplate>(`/api/templates/${id}`);
  }

  async updateTemplate(
    id: number,
    data: {
      name: string;
      text: string;
    }
  ): Promise<ApiResponse<MessageTemplate>> {
    return this.request<MessageTemplate>(`/api/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTemplate(id: number): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>(`/api/templates/${id}`, {
      method: 'DELETE',
    });
  }

  // Campaign methods
  async getCampaigns(params?: {
    page?: number;
    pageSize?: number;
    status?: string;
  }): Promise<ApiResponse<PaginatedResponse<Campaign>>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<PaginatedResponse<Campaign>>(
      `/api/campaigns${query ? `?${query}` : ''}`
    );
  }

  async createCampaign(data: {
    name: string;
    templateId?: number;
    text?: string;
    listId: string;
    scheduledAt?: string;
  }): Promise<ApiResponse<Campaign>> {
    return this.request<Campaign>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getCampaign(id: number): Promise<ApiResponse<Campaign>> {
    return this.request<Campaign>(`/api/campaigns/${id}`);
  }

  async updateCampaign(
    id: number,
    data: {
      name?: string;
      templateId?: number;
      text?: string;
      listId?: string;
      scheduledAt?: string;
    }
  ): Promise<ApiResponse<Campaign>> {
    return this.request<Campaign>(`/api/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCampaign(id: number): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>(`/api/campaigns/${id}`, {
      method: 'DELETE',
    });
  }

  async previewCampaign(id: number): Promise<ApiResponse<{
    items: Array<{ to: string; text: string }>;
    totalRecipients: number;
  }>> {
    return this.request<{
      items: Array<{ to: string; text: string }>;
      totalRecipients: number;
    }>(`/api/campaigns/${id}/preview`);
  }

  async enqueueCampaign(id: number): Promise<ApiResponse<{
    ok: boolean;
    campaignId: number;
    queued: number;
  }>> {
    return this.request<{
      ok: boolean;
      campaignId: number;
      queued: number;
    }>(`/api/campaigns/${id}/enqueue`, {
      method: 'POST',
    });
  }

  async getCampaignStatus(id: number): Promise<ApiResponse<{
    campaign: Campaign;
    metrics: {
      queued: number;
      sent: number;
      delivered: number;
      failed: number;
    };
  }>> {
    return this.request<{
      campaign: Campaign;
      metrics: {
        queued: number;
        sent: number;
        delivered: number;
        failed: number;
      };
    }>(`/api/campaigns/${id}/status`);
  }

  // Campaign analytics methods
  async getBulkCampaignStats(ids: number[]): Promise<ApiResponse<{
    campaigns: CampaignStats[];
  }>> {
    return this.request<{ campaigns: CampaignStats[] }>(
      `/api/v1/campaigns/stats?ids=${ids.join(',')}`
    );
  }

  async getCampaignStats(id: number): Promise<ApiResponse<CampaignStats>> {
    return this.request<CampaignStats>(`/api/v1/campaigns/${id}/stats`);
  }

  // Dashboard methods
  async getDashboardKPIs(): Promise<ApiResponse<KPI>> {
    return this.request<KPI>('/api/dashboard/kpis');
  }

  // Automation methods
  async getAutomations(): Promise<ApiResponse<Automation[]>> {
    return this.request<Automation[]>('/api/automations');
  }

  async updateAutomation(
    id: number,
    data: {
      title: string;
      message: string;
      trigger: string;
    }
  ): Promise<ApiResponse<Automation>> {
    return this.request<Automation>(`/api/automations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateAutomationStatus(
    id: number,
    data: { isActive: boolean }
  ): Promise<ApiResponse<{ id: number; isActive: boolean }>> {
    return this.request<{ id: number; isActive: boolean }>(
      `/api/automations/${id}/status`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  }

  // Tracking methods
  async checkTrackingId(trackingId: string): Promise<ApiResponse<{
    exists: boolean;
    alreadyRedeemed: boolean;
  }>> {
    return this.request<{
      exists: boolean;
      alreadyRedeemed: boolean;
    }>(`/tracking/redeem/${trackingId}`);
  }

  async redeemTrackingId(trackingId: string): Promise<ApiResponse<{
    status: string;
    trackingId: string;
    messageId?: number;
    campaignId?: number;
    contactId?: number;
    redeemedAt?: string;
  }>> {
    return this.request<{
      status: string;
      trackingId: string;
      messageId?: number;
      campaignId?: number;
      contactId?: number;
      redeemedAt?: string;
    }>('/tracking/redeem', {
      method: 'POST',
      body: JSON.stringify({ trackingId }),
    });
  }

  async getOfferDetails(trackingId: string): Promise<ApiResponse<{
    trackingId: string;
    storeName: string;
    offerText: string;
  }>> {
    return this.request<{
      trackingId: string;
      storeName: string;
      offerText: string;
    }>(`/api/tracking/offer/${trackingId}`);
  }

  // Billing methods
  async getWalletBalance(): Promise<ApiResponse<WalletBalance>> {
    return this.request<WalletBalance>('/api/billing/balance');
  }

  async getCreditTransactions(params?: {
    page?: number;
    pageSize?: number;
  }): Promise<ApiResponse<PaginatedResponse<CreditTransaction>>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<PaginatedResponse<CreditTransaction>>(
      `/api/billing/transactions${query ? `?${query}` : ''}`
    );
  }

  async getPackages(): Promise<ApiResponse<Package[]>> {
    return this.request<Package[]>('/api/billing/packages');
  }

  async purchasePackage(
    packageId: number,
    idempotencyKey: string
  ): Promise<ApiResponse<{
    ok: boolean;
    purchase: Purchase;
    credited: number;
    balance: number;
    txn: CreditTransaction;
  }>> {
    return this.request<{
      ok: boolean;
      purchase: Purchase;
      credited: number;
      balance: number;
      txn: CreditTransaction;
    }>('/api/billing/purchase', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ packageId }),
    });
  }

  // Job methods
  async getJobHealth(): Promise<ApiResponse<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    queues: {
      sms: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
      };
      scheduler: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
      };
    };
  }>> {
    return this.request<{
      status: 'healthy' | 'degraded' | 'unhealthy';
      queues: {
        sms: {
          waiting: number;
          active: number;
          completed: number;
          failed: number;
        };
        scheduler: {
          waiting: number;
          active: number;
          completed: number;
          failed: number;
        };
      };
    }>('/api/jobs/health');
  }

  // Health methods
  async getHealth(): Promise<ApiResponse<{
    status: string;
    timestamp: string;
  }>> {
    return this.request<{
      status: string;
      timestamp: string;
    }>('/health');
  }

  // Utility methods
  setAccessToken(token: string): void {
    this.config.accessToken = token;
  }

  getAccessToken(): string | undefined {
    return this.config.accessToken;
  }

  setBaseUrl(url: string): void {
    this.config.baseUrl = url;
  }

  getBaseUrl(): string {
    return this.config.baseUrl;
  }
}

// Factory function for easy instantiation
export function createSmsMarketingClient(config: ApiConfig): SmsMarketingApiClient {
  return new SmsMarketingApiClient(config);
}

// Default export
export default SmsMarketingApiClient;
