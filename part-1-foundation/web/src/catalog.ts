export type ProductArtKind = 'gpu' | 'cpu' | 'memory' | 'chassis' | 'switch' | 'cooling';

export type AuctionItem = {
  slug: string;
  title: string;
  kicker: string;
  category: string;
  art: ProductArtKind;
  currentPrice: number;
  bidCount: number;
  currentBidder: string;
  timeLeft: string;
  seller: string;
  sellerRating: string;
  location: string;
  condition: string;
  description: string;
  specs: Array<[string, string]>;
};

export const catalog: AuctionItem[] = [
  { slug: 'nvidia-h100-sxm-80gb', title: 'NVIDIA H100 SXM 80GB', kicker: 'Retired from a very serious rack', category: 'GPUs', art: 'gpu', currentPrice: 18450, bidCount: 22, currentBidder: 'tensor_tamer', timeLeft: '2h 14m', seller: 'North Loop Compute', sellerRating: '99.8% positive', location: 'Minneapolis, MN', condition: 'Used · Fully tested', description: 'A production-pulled H100 accelerator with a clean diagnostic report. It spent its first career training recommendation models and is ready for something more interesting.', specs: [['Memory', '80GB HBM3'], ['Interface', 'SXM5'], ['TDP', '700W'], ['Included', 'Protective carrier']] },
  { slug: 'amd-epyc-9654', title: 'AMD EPYC 9654 · 96 cores', kicker: 'Has seen things. Mostly Kubernetes.', category: 'CPUs', art: 'cpu', currentPrice: 4725, bidCount: 14, currentBidder: 'thread_ripper_47', timeLeft: '5h 48m', seller: 'Decommissioned Dreams', sellerRating: '100% positive', location: 'Columbus, OH', condition: 'Open box · Bench tested', description: 'Ninety-six Zen 4 cores looking for a loving socket. Removed during a capacity refresh, cleaned, inspected, and tested under sustained all-core load.', specs: [['Cores / threads', '96 / 192'], ['Base clock', '2.4 GHz'], ['Socket', 'SP5'], ['L3 cache', '384MB']] },
  { slug: 'one-point-five-tb-ddr5-ecc', title: '1.5TB DDR5 ECC memory kit', kicker: 'Enough RAM to finally open Chrome', category: 'Memory', art: 'memory', currentPrice: 6890, bidCount: 31, currentBidder: 'segfault_sally', timeLeft: '38m', seller: 'Heap & Sons', sellerRating: '99.6% positive', location: 'Ashburn, VA', condition: 'Used · Matched set', description: 'A matched set of twenty-four 64GB DDR5 ECC RDIMMs. Every module passed a 72-hour memory test, which is more rest than any of us got this week.', specs: [['Capacity', '24 × 64GB'], ['Speed', 'DDR5-4800'], ['Type', 'ECC RDIMM'], ['Test result', '0 errors / 72 hours']] },
  { slug: 'supermicro-4u-gpu-chassis', title: 'Supermicro 4U GPU chassis', kicker: 'Rack mount, emotionally available', category: 'Chassis', art: 'chassis', currentPrice: 2120, bidCount: 9, currentBidder: 'four_u_and_me', timeLeft: '1d 3h', seller: 'Bare Metal Matchmakers', sellerRating: '98.9% positive', location: 'Chicago, IL', condition: 'Used · Minor rack wear', description: 'A dense 4U platform for up to eight double-width accelerators. Fans are loud, airflow is excellent, and the bezel has only the tasteful amount of data-center patina.', specs: [['GPU capacity', '8 × double-width'], ['Power', '4 × 2,000W'], ['Drive bays', '24 × 2.5-inch'], ['Rails', 'Included']] },
  { slug: 'quantum-2-400g-switch', title: 'NVIDIA Quantum-2 400Gb switch', kicker: 'Latency has left the chat', category: 'Networking', art: 'switch', currentPrice: 12750, bidCount: 18, currentBidder: 'packet_wrangler', timeLeft: '7h 06m', seller: 'Layer Eight Supply', sellerRating: '99.9% positive', location: 'Dallas, TX', condition: 'Certified refurbished', description: 'A 64-port NDR InfiniBand switch for clusters that have places to be. Firmware is current, ports are verified, and both redundant power supplies are included.', specs: [['Ports', '64 × NDR 400Gb/s'], ['Throughput', '51.2Tb/s'], ['Form factor', '1U'], ['Airflow', 'Port-to-power']] },
  { slug: 'direct-to-chip-cooling-loop', title: 'Direct-to-chip cooling loop', kicker: "Please don't spill it", category: 'Cooling', art: 'cooling', currentPrice: 980, bidCount: 7, currentBidder: 'thermal_throttler', timeLeft: '2d 11h', seller: 'Cool Story Systems', sellerRating: '99.3% positive', location: 'Austin, TX', condition: 'New old stock', description: 'A sealed dual-block liquid cooling assembly sized for a 2U compute sled. Pressure-tested, leak-free, and considerably less alarming than the prototype looked.', specs: [['Cold plates', '2 × nickel-plated copper'], ['Tubing', 'EPDM, quick disconnect'], ['Rated load', '1,200W'], ['Coolant', 'Not included']] },
];

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
