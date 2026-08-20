import { type FormEvent, useState } from 'react';
import { createAuction, type DemoUser, parseDollarsToCents } from '../catalog';

const categories = ['GPUs', 'CPUs', 'Memory', 'Chassis', 'Networking', 'Cooling'];

function localDateTimeValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function NewAuctionPage({ activeUser }: { activeUser: DemoUser | null }) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const minimumEnd = localDateTimeValue(new Date(Date.now() + 120_000));
  const defaultEnd = localDateTimeValue(new Date(Date.now() + 86_400_000));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeUser) {
      setError('Wait for an active seller to be selected.');
      return;
    }
    const data = new FormData(event.currentTarget);
    const startingPriceCents = parseDollarsToCents(String(data.get('startingPrice')));
    if (!startingPriceCents) {
      setError('Enter a valid starting price with no more than two decimal places.');
      return;
    }
    const endsAt = new Date(String(data.get('endsAt')));
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now() + 60_000) {
      setError('Choose a closing time at least one minute in the future.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const created = await createAuction({
        userId: activeUser.id,
        title: String(data.get('title')),
        category: String(data.get('category')),
        description: String(data.get('description')),
        condition: String(data.get('condition')),
        location: String(data.get('location')),
        startingPriceCents,
        endsAt: endsAt.toISOString(),
      });
      window.location.assign(`/items/${created.slug}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not post this auction.');
      setSubmitting(false);
    }
  }

  return <main className="new-auction-page container"><div className="breadcrumbs"><a href="/">Home</a><span>/</span><span>Sell equipment</span></div><div className="new-auction-heading"><p className="eyebrow">New auction</p><h1>Give good hardware a second life.</h1><p>Set the essentials now. Your listing goes live as soon as you post it.</p></div><form className="auction-create-form" onSubmit={submit}><section><div className="form-section-heading"><span>01</span><div><h2>Equipment</h2><p>Tell bidders exactly what is on the rack.</p></div></div><div className="form-grid"><label className="wide">Title<input name="title" required minLength={3} maxLength={120} placeholder="NVIDIA A100 PCIe 80GB" /></label><label>Category<select name="category" required defaultValue="GPUs">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Condition<select name="condition" required defaultValue="Used · Fully tested"><option>Used · Fully tested</option><option>Open box · Bench tested</option><option>Certified refurbished</option><option>New old stock</option><option>Used · Minor wear</option></select></label><label className="wide">Description<textarea name="description" required minLength={10} maxLength={4000} rows={6} placeholder="What was it used for, how was it tested, and what is included?" /></label></div></section><section><div className="form-section-heading"><span>02</span><div><h2>Auction details</h2><p>Choose where bidding starts and when it ends.</p></div></div><div className="form-grid"><label>Starting price<span className="money-input"><span>$</span><input name="startingPrice" required inputMode="decimal" placeholder="1250.00" pattern="\d+(?:\.\d{1,2})?" /></span></label><label>Closing time<input name="endsAt" type="datetime-local" required min={minimumEnd} defaultValue={defaultEnd} /></label><label className="wide">Item location<input name="location" required minLength={2} maxLength={100} placeholder="Chicago, IL" /></label></div></section><div className="form-submit"><div className="seller-identity"><span className="seller-avatar">{activeUser?.displayName.charAt(0) ?? '…'}</span><div><small>Posting as</small><strong>{activeUser?.displayName ?? 'Choosing a seller…'}</strong>{activeUser && <span>@{activeUser.handle}</span>}</div></div><div>{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" disabled={submitting || !activeUser}>{submitting ? 'Posting…' : 'Post auction'}</button></div></div></form></main>;
}
