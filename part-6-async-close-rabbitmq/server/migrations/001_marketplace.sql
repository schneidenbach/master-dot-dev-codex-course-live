CREATE TABLE IF NOT EXISTS users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name text NOT NULL UNIQUE CHECK (length(trim(display_name)) BETWEEN 2 AND 40),
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]+$')
);

CREATE TABLE IF NOT EXISTS auctions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  seller_user_id integer NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),
  kicker text NOT NULL DEFAULT '' CHECK (length(kicker) <= 160),
  category text NOT NULL CHECK (category IN ('GPUs', 'CPUs', 'Memory', 'Chassis', 'Networking', 'Cooling')),
  art text NOT NULL CHECK (art IN ('gpu', 'cpu', 'memory', 'chassis', 'switch', 'cooling')),
  starting_price_cents integer NOT NULL CHECK (starting_price_cents > 0),
  ends_at timestamptz NOT NULL,
  location text NOT NULL CHECK (length(trim(location)) BETWEEN 2 AND 100),
  condition text NOT NULL CHECK (length(trim(condition)) BETWEEN 2 AND 100),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 4000),
  specs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(specs) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bids (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id bigint NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  bidder_user_id integer NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bids_auction_created_idx ON bids (auction_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS auctions_ends_at_idx ON auctions (ends_at);

INSERT INTO users (display_name, handle) VALUES
  ('Avery Chen', 'avery'), ('Maya Thompson', 'maya'), ('Theo Brooks', 'theo'),
  ('Priya Shah', 'priya'), ('Jordan Lee', 'jordan'), ('Sam Rivera', 'sam'),
  ('Nora Williams', 'nora'), ('Eli Martin', 'eli'), ('Zoe Patel', 'zoe'),
  ('Marcus Green', 'marcus')
ON CONFLICT DO NOTHING;

INSERT INTO auctions (
  slug, seller_user_id, title, kicker, category, art, starting_price_cents, ends_at,
  location, condition, description, specs
) VALUES
  ('nvidia-h100-sxm-80gb', 1, 'NVIDIA H100 SXM 80GB', 'Retired from a very serious rack', 'GPUs', 'gpu', 1845000, now() + interval '2 hours 14 minutes', 'Minneapolis, MN', 'Used · Fully tested', 'A production-pulled H100 accelerator with a clean diagnostic report. It spent its first career training recommendation models and is ready for something more interesting.', '[["Memory","80GB HBM3"],["Interface","SXM5"],["TDP","700W"],["Included","Protective carrier"]]'),
  ('amd-epyc-9654', 2, 'AMD EPYC 9654 · 96 cores', 'Has seen things. Mostly Kubernetes.', 'CPUs', 'cpu', 472500, now() + interval '5 hours 48 minutes', 'Columbus, OH', 'Open box · Bench tested', 'Ninety-six Zen 4 cores looking for a loving socket. Removed during a capacity refresh, cleaned, inspected, and tested under sustained all-core load.', '[["Cores / threads","96 / 192"],["Base clock","2.4 GHz"],["Socket","SP5"],["L3 cache","384MB"]]'),
  ('one-point-five-tb-ddr5-ecc', 3, '1.5TB DDR5 ECC memory kit', 'Enough RAM to finally open Chrome', 'Memory', 'memory', 689000, now() + interval '38 minutes', 'Ashburn, VA', 'Used · Matched set', 'A matched set of twenty-four 64GB DDR5 ECC RDIMMs. Every module passed a 72-hour memory test, which is more rest than any of us got this week.', '[["Capacity","24 × 64GB"],["Speed","DDR5-4800"],["Type","ECC RDIMM"],["Test result","0 errors / 72 hours"]]'),
  ('supermicro-4u-gpu-chassis', 4, 'Supermicro 4U GPU chassis', 'Rack mount, emotionally available', 'Chassis', 'chassis', 212000, now() + interval '1 day 3 hours', 'Chicago, IL', 'Used · Minor rack wear', 'A dense 4U platform for up to eight double-width accelerators. Fans are loud, airflow is excellent, and the bezel has only the tasteful amount of data-center patina.', '[["GPU capacity","8 × double-width"],["Power","4 × 2,000W"],["Drive bays","24 × 2.5-inch"],["Rails","Included"]]'),
  ('quantum-2-400g-switch', 5, 'NVIDIA Quantum-2 400Gb switch', 'Latency has left the chat', 'Networking', 'switch', 1275000, now() + interval '7 hours 6 minutes', 'Dallas, TX', 'Certified refurbished', 'A 64-port NDR InfiniBand switch for clusters that have places to be. Firmware is current, ports are verified, and both redundant power supplies are included.', '[["Ports","64 × NDR 400Gb/s"],["Throughput","51.2Tb/s"],["Form factor","1U"],["Airflow","Port-to-power"]]'),
  ('direct-to-chip-cooling-loop', 6, 'Direct-to-chip cooling loop', 'Please don''t spill it', 'Cooling', 'cooling', 98000, now() + interval '2 days 11 hours', 'Austin, TX', 'New old stock', 'A sealed dual-block liquid cooling assembly sized for a 2U compute sled. Pressure-tested, leak-free, and considerably less alarming than the prototype looked.', '[["Cold plates","2 × nickel-plated copper"],["Tubing","EPDM, quick disconnect"],["Rated load","1,200W"],["Coolant","Not included"]]')
ON CONFLICT DO NOTHING;
