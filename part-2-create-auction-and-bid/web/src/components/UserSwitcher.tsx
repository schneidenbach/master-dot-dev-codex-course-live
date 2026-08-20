import { type DemoUser } from '../catalog';

export const activeUserStorageKey = 'auction-house-active-user-id';

export function UserSwitcher({
  users,
  activeUserId,
  error,
  onChange,
}: {
  users: DemoUser[];
  activeUserId: number | null;
  error: string;
  onChange: (userId: number) => void;
}) {
  return <div className="user-switcher" id="demo-user"><label htmlFor="active-user"><span>Browsing as</span><select id="active-user" aria-label="Active demo user" value={activeUserId ?? ''} disabled={!users.length} onChange={(event) => onChange(Number(event.target.value))}>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName} (@{user.handle})</option>)}</select></label>{error && <small role="alert">{error}</small>}</div>;
}
