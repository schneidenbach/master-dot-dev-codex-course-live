import { type AuctionItem, formatCurrency } from '../catalog';
import { ProductArt } from './ProductArt';

export function ProductCard({ item }: { item: AuctionItem }) {
  return <article className="product-card"><a className="product-image-link" href={`/items/${item.slug}`}><ProductArt kind={item.art} label={`Illustration of ${item.title}`} /><span className="time-pill">{item.timeLeft} left</span></a><div className="product-card-body"><p className="product-category">{item.category}</p><h3><a href={`/items/${item.slug}`}>{item.title}</a></h3><p className="product-kicker">{item.kicker}</p><div className="price-row"><strong>{formatCurrency(item.currentPrice)}</strong><span>{item.bidCount} bids</span></div></div></article>;
}
