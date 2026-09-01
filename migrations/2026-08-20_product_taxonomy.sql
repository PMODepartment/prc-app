-- ════════════════════════════════════════════════════════════════════════════
-- migrations/2026-08-20_product_taxonomy.sql   (run once, idempotent, re-runnable)
-- ════════════════════════════════════════════════════════════════════════════
-- A HYBRID product taxonomy for vendor offerings.
--
--   Level 1  = Trade   (the 10 canonical trades)          ← canonical, locked
--   Level 2  = Works   (the WP form's Trade→Works ladder) ← canonical, locked
--   Level 3+ = free, arbitrary-depth sub-nodes            ← staff-managed
--
-- WHY hybrid: anchoring the top two levels to the SAME vocabulary the work
-- packages use (wp-form.html's TRADE_WORKS) is what makes "find me vendors who
-- supply this WP's works" a lookup instead of a guess. Below that, depth is
-- unconstrained so a category can be as specific as needed
-- (Structural Works → Rebar → Deformed Bars → Grade 60 → 16mm).
--
-- vendor_products.category (free text trade) and .item_type
-- (Materials/Labor/Service) are LEFT IN PLACE and still written — this is
-- additive. taxonomy_id is the new precise link; category remains the legacy
-- fallback for rows that were never classified.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The tree ─────────────────────────────────────────────────────────────
create table if not exists product_taxonomy (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references product_taxonomy(id) on delete cascade,
  name        text not null,
  -- Canonical anchors. trade is set on L1 AND inherited onto L2 so a WP's
  -- (trade, works) pair resolves to a node with one indexed lookup.
  trade       text,
  works       text,
  canonical   boolean not null default false,
  depth       int  not null default 1,
  path        uuid[] not null default '{}',   -- ancestors + self, maintained by trigger
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz,
  created_by  uuid,
  updated_by  uuid
);

comment on table product_taxonomy is
  'Hybrid product taxonomy. L1=Trade, L2=Works (both canonical, mirroring wp-form.html TRADE_WORKS so vendor offerings and work packages share one vocabulary); L3+ are free staff-managed sub-nodes of any depth. path/depth are maintained by internal.taxonomy_set_path.';
comment on column product_taxonomy.canonical is
  'true = seeded from the WP TRADE_WORKS ladder. The app blocks renaming/deleting these: they must stay in step with work_packages.trade / .works or WP-to-vendor matching silently breaks. Add free sub-nodes UNDER them instead.';
comment on column product_taxonomy.path is
  'Materialized ancestor path (includes self). Descendants of X = "where path @> array[X]::uuid[]" — one GIN index instead of a recursive CTE per query.';

-- Sibling names must be unique. Two indexes because SQL treats NULL parents as
-- distinct, so a plain unique(parent_id, name) would not constrain the roots.
create unique index if not exists product_taxonomy_sibling_uidx
  on product_taxonomy (parent_id, lower(name)) where parent_id is not null;
create unique index if not exists product_taxonomy_root_uidx
  on product_taxonomy (lower(name)) where parent_id is null;

create index if not exists product_taxonomy_parent_idx on product_taxonomy(parent_id);
create index if not exists product_taxonomy_path_idx   on product_taxonomy using gin(path);
create index if not exists product_taxonomy_tw_idx     on product_taxonomy(lower(trade), lower(works));

-- ── 2. Maintain depth + path ────────────────────────────────────────────────
-- BEFORE INSERT/UPDATE: the column default has already produced new.id by the
-- time a BEFORE trigger runs, so self can be appended on insert.
create or replace function internal.taxonomy_set_path()
returns trigger language plpgsql as $$
declare p record;
begin
  if new.parent_id is null then
    new.depth := 1;
    new.path  := array[new.id];
  else
    select depth, path into p from product_taxonomy where id = new.parent_id;
    if not found then
      raise exception 'parent % does not exist', new.parent_id;
    end if;
    -- A node may not be moved under itself or one of its own descendants.
    if new.parent_id = new.id or new.id = any(p.path) then
      raise exception 'cycle: node % cannot be a descendant of itself', new.id;
    end if;
    new.depth := p.depth + 1;
    new.path  := p.path || new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taxonomy_set_path on product_taxonomy;
create trigger trg_taxonomy_set_path before insert or update of parent_id
  on product_taxonomy for each row execute function internal.taxonomy_set_path();

-- Re-parenting a node must re-stamp every descendant.
--
-- TWO TRAPS, both deliberate:
--  1. The trigger is "AFTER UPDATE", NOT "AFTER UPDATE OF path". Postgres
--     decides "UPDATE OF col" from the columns named in the statement's SET
--     clause, NOT from what a BEFORE trigger assigned. A re-parent sets
--     parent_id, so "OF path" would never fire and descendants would keep
--     stale paths forever. The WHEN clause does the filtering instead.
--  2. The whole subtree is fixed in ONE recursive statement rather than by
--     touching children and letting the BEFORE trigger recurse per row.
--
-- Termination: this statement sets every descendant to its FINAL correct
-- value. Each descendant row it changes re-fires this trigger once; that
-- nested pass recomputes the same values, so its own UPDATE leaves path
-- unchanged, the WHEN clause is false, and firing stops. Nesting can never
-- exceed 2 levels regardless of how deep the tree is.
create or replace function internal.taxonomy_reparent_children()
returns trigger language plpgsql as $$
begin
  with recursive sub as (
    select new.id as id, new.path as path, new.depth as depth
    union all
    select c.id, s.path || c.id, s.depth + 1
      from product_taxonomy c
      join sub s on c.parent_id = s.id
  )
  update product_taxonomy t
     set path = s.path, depth = s.depth
    from sub s
   where t.id = s.id
     and t.id <> new.id
     and (t.path, t.depth) is distinct from (s.path, s.depth);
  return null;
end;
$$;

drop trigger if exists trg_taxonomy_reparent on product_taxonomy;
create trigger trg_taxonomy_reparent after update on product_taxonomy
  for each row when (new.path is distinct from old.path)
  execute function internal.taxonomy_reparent_children();

-- ── 3. Link vendor offerings to the tree ────────────────────────────────────
alter table vendor_products
  add column if not exists taxonomy_id uuid references product_taxonomy(id) on delete set null;
create index if not exists idx_vendor_products_taxonomy on vendor_products(taxonomy_id);

comment on column vendor_products.taxonomy_id is
  'Precise product_taxonomy node for this offering. NULL = unclassified (legacy row) — fall back to the free-text .category. ON DELETE SET NULL: removing a category must never delete the offering itself.';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- Everyone approved (INCLUDING a vendor login) can READ the tree — the vendor
-- portal needs it to classify their own offerings. Only staff may WRITE it.
alter table product_taxonomy enable row level security;

drop policy if exists "product_taxonomy_select" on product_taxonomy;
create policy "product_taxonomy_select" on product_taxonomy
  for select to authenticated
  using (internal.get_my_status() = 'approved');

drop policy if exists "product_taxonomy_write" on product_taxonomy;
create policy "product_taxonomy_write" on product_taxonomy
  for all to authenticated
  using      (internal.get_my_status() = 'approved'
              and internal.get_my_role() not in ('viewer','viewer_budget','vendor'))
  with check (internal.get_my_status() = 'approved'
              and internal.get_my_role() not in ('viewer','viewer_budget','vendor'));

grant select on product_taxonomy to authenticated;
grant insert, update, delete on product_taxonomy to authenticated;

-- ── 5. Seed the canonical levels from the WP TRADE_WORKS ladder ─────────────
-- Generated from wp-form.html's TRADE_WORKS (10 trades / 87 works).
-- KEEP IN SYNC: if you add a Works to that object, re-run this section.
insert into product_taxonomy (name, trade, canonical, sort_order)
select v.name, v.name, true, v.ord
from (values
    ('General Requirements', 1),
    ('Site Works', 2),
    ('Structural Works', 3),
    ('Architectural Works', 4),
    ('Mechanical Works', 5),
    ('Electrical and Auxiliary Works', 6),
    ('Plumbing Works', 7),
    ('Fire Protection Works', 8),
    ('Allied Services', 9),
    ('Site Development Works', 10)
) as v(name, ord)
where not exists (
  select 1 from product_taxonomy p
  where p.parent_id is null and lower(p.name) = lower(v.name)
);

insert into product_taxonomy (parent_id, name, trade, works, canonical, sort_order)
select p.id, v.works, v.trade, v.works, true, v.ord
from (values
    ('General Requirements', 'Mobilization/Demobilization', 1),
    ('General Requirements', 'Temporary Facilities', 2),
    ('General Requirements', 'Office Equipment & Supplies', 3),
    ('General Requirements', 'Support Crew', 4),
    ('General Requirements', 'Security Services', 5),
    ('General Requirements', 'Housekeeping & Sanitation', 6),
    ('General Requirements', 'Heavy Equipment', 7),
    ('General Requirements', 'Light Equipment and Tools', 8),
    ('General Requirements', 'Service Vehicle', 9),
    ('General Requirements', 'Fuel & Oil', 10),
    ('General Requirements', 'Falseworks', 11),
    ('General Requirements', 'Personal Protective Equipment & Safety Provisions', 12),
    ('General Requirements', 'Drawing Services', 13),
    ('General Requirements', 'Bonds, Insurances & Permits', 14),
    ('General Requirements', 'Material Testing', 15),
    ('Site Works', 'Bulk Excavation & Backfilling', 1),
    ('Site Works', 'Structural Excavation', 2),
    ('Site Works', 'Piling Works', 3),
    ('Site Works', 'Soil Protection', 4),
    ('Site Works', 'Chemical Treatment', 5),
    ('Site Works', 'Vapor Barrier', 6),
    ('Site Works', 'Dewatering', 7),
    ('Structural Works', 'Rebar', 1),
    ('Structural Works', 'Formworks', 2),
    ('Structural Works', 'Concrete', 3),
    ('Structural Works', 'Precast', 4),
    ('Structural Works', 'Structural Steel', 5),
    ('Structural Works', 'Post Tensioning', 6),
    ('Architectural Works', 'Block Works & Masonry Concrete', 1),
    ('Architectural Works', 'Precast', 2),
    ('Architectural Works', 'Sealant', 3),
    ('Architectural Works', 'Roof & Wall Sheeting', 4),
    ('Architectural Works', 'Stone & Tiles', 5),
    ('Architectural Works', 'Drywall & Ceiling', 6),
    ('Architectural Works', 'Waterproofing', 7),
    ('Architectural Works', 'Metal Doors', 8),
    ('Architectural Works', 'Wood Doors', 9),
    ('Architectural Works', 'PVC Doors', 10),
    ('Architectural Works', 'Door Hardware', 11),
    ('Architectural Works', 'Metal Works', 12),
    ('Architectural Works', 'Aluminum & Glazing', 13),
    ('Architectural Works', 'Paint', 14),
    ('Architectural Works', 'Cabinetry & Mill Works', 15),
    ('Architectural Works', 'Landscape & Amenities', 16),
    ('Architectural Works', 'Specialties', 17),
    ('Mechanical Works', 'Air Conditioning Equipment', 1),
    ('Mechanical Works', 'Fans & Blowers', 2),
    ('Mechanical Works', 'Airconditioning Pipes', 3),
    ('Mechanical Works', 'Insulation & Fittings', 4),
    ('Mechanical Works', 'Air Conditioning Valves & Accessories', 5),
    ('Mechanical Works', 'Ducting Works', 6),
    ('Mechanical Works', 'Specialties', 7),
    ('Electrical and Auxiliary Works', 'Distribution Equipment', 1),
    ('Electrical and Auxiliary Works', 'Lightning & Ground Protection', 2),
    ('Electrical and Auxiliary Works', 'Panel Boards & Breakers', 3),
    ('Electrical and Auxiliary Works', 'Raceways', 4),
    ('Electrical and Auxiliary Works', 'Conduits & Boxes', 5),
    ('Electrical and Auxiliary Works', 'Bus Ducts', 6),
    ('Electrical and Auxiliary Works', 'Wires & Cables', 7),
    ('Electrical and Auxiliary Works', 'Wiring Devices', 8),
    ('Electrical and Auxiliary Works', 'Lighting Fixtures', 9),
    ('Electrical and Auxiliary Works', 'Structured Cabling System', 10),
    ('Electrical and Auxiliary Works', 'Closed Circuit Television', 11),
    ('Electrical and Auxiliary Works', 'Public Address & Background Music', 12),
    ('Electrical and Auxiliary Works', 'Fire Detection & Alarm System', 13),
    ('Electrical and Auxiliary Works', 'Access Control System', 14),
    ('Electrical and Auxiliary Works', 'Building Management System', 15),
    ('Electrical and Auxiliary Works', 'Specialties', 16),
    ('Plumbing Works', 'Plumbing Fixtures', 1),
    ('Plumbing Works', 'Tanks, Pumps & Equipment', 2),
    ('Plumbing Works', 'Valves & Accessories', 3),
    ('Plumbing Works', 'Waterline Distribution Pipes & Fittings', 4),
    ('Plumbing Works', 'Sanitary Pipes & Fittings', 5),
    ('Plumbing Works', 'Sewer Treatment Plant', 6),
    ('Plumbing Works', 'Specialties', 7),
    ('Fire Protection Works', 'Tanks', 1),
    ('Fire Protection Works', 'Pumps & Equipment', 2),
    ('Fire Protection Works', 'Pipes & Fittings', 3),
    ('Fire Protection Works', 'Valves & Accessories', 4),
    ('Fire Protection Works', 'Cabinets, Sprinkler & Extinguishers', 5),
    ('Fire Protection Works', 'Specialties', 6),
    ('Allied Services', 'Elevators', 1),
    ('Allied Services', 'Escalators', 2),
    ('Allied Services', 'Transformers', 3),
    ('Allied Services', 'Building Management Units', 4),
    ('Allied Services', 'Generator Sets', 5),
    ('Site Development Works', 'Site Development', 1)
) as v(trade, works, ord)
join product_taxonomy p
  on p.parent_id is null and lower(p.name) = lower(v.trade)
where not exists (
  select 1 from product_taxonomy c
  where c.parent_id = p.id and lower(c.name) = lower(v.works)
);

-- Keep the canonical flag / trade anchor correct if a prior run seeded them
-- before these columns existed.
update product_taxonomy set canonical = true
 where canonical is not true and depth <= 2 and trade is not null;

-- ── 6. Backfill existing offerings ──────────────────────────────────────────
-- Conservative on purpose. vendor_products.category holds a free-text TRADE, so
-- the most we can infer is the level-1 node. We then UPGRADE to the level-2
-- Works node only where the offering's description matches a Works name under
-- that trade exactly (normalized) — never a fuzzy guess.
update vendor_products vp
   set taxonomy_id = t.id
  from product_taxonomy t
 where vp.taxonomy_id is null
   and t.parent_id is null
   and vp.category is not null
   and lower(btrim(vp.category)) = lower(t.name);

update vendor_products vp
   set taxonomy_id = c.id
  from product_taxonomy c
  join product_taxonomy p on p.id = c.parent_id
 where vp.taxonomy_id = p.id
   and p.parent_id is null
   and c.canonical
   and lower(btrim(regexp_replace(vp.description, '\s+', ' ', 'g'))) = lower(c.name);

-- ── 7. Report ───────────────────────────────────────────────────────────────
select
  (select count(*) from product_taxonomy where depth = 1)                    as trades,
  (select count(*) from product_taxonomy where depth = 2)                    as works,
  (select count(*) from product_taxonomy where depth > 2)                    as custom_subnodes,
  (select count(*) from vendor_products where taxonomy_id is not null)       as products_classified,
  (select count(*) from vendor_products where taxonomy_id is null)           as products_unclassified;
