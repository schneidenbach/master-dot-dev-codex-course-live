import { type AuctionItem, formatCurrency, formatTimeLeft } from '../catalog';
import { ProductArt } from './ProductArt';

export function ProductCard({ item }: { item: AuctionItem }) {
  const timeLeft = formatTimeLeft(item.endsAt);
  return <article className="product-card"><a className="product-image-link" href={`/items/${item.slug}`}><ProductArt kind={item.art} label={`Illustration of ${item.title}`} /><span className="time-pill">{timeLeft === 'Ended' ? timeLeft : `${timeLeft} left`}</span></a><div className="product-card-body"><p className="product-category">{item.category}</p><h3><a href={`/items/${item.slug}`}>{item.title}</a></h3><p className="product-kicker">{item.kicker}</p><div className="price-row"><strong>{formatCurrency(item.currentPriceCents)}</strong><span>{item.bidCount} {item.bidCount === 1 ? 'bid' : 'bids'}</span></div></div></article>;
}
