export type ProductArtKind = 'gpu' | 'cpu' | 'memory' | 'chassis' | 'switch' | 'cooling';

export type DemoUser = {
  id: number;
  displayName: string;
  handle: string;
};

export type AuctionItem = {
  slug: string;
  title: string;
  kicker: string;
  category: string;
  art: ProductArtKind;
  currentPriceCents: number;
  bidCount: number;
  currentBidder: string | null;
  endsAt: string;
  seller: DemoUser;
  location: string;
  condition: string;
  description: string;
  specs: Array<[string, string]>;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function fetchAuctions(query = ''): Promise<AuctionItem[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  return getJson(`/api/auctions${params.size ? `?${params.toString()}` : ''}`);
}

export function fetchAuction(slug: string): Promise<AuctionItem> {
  return getJson(`/api/auctions/${encodeURIComponent(slug)}`);
}

export function fetchUsers(): Promise<DemoUser[]> {
  return getJson('/api/users');
}

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatTimeLeft(endsAt: string, now = Date.now()): string {
  const remainingMinutes = Math.ceil((new Date(endsAt).getTime() - now) / 60_000);
  if (remainingMinutes <= 0) return 'Ended';
  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor((remainingMinutes % 1_440) / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
