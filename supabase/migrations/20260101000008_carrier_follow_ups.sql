-- =====================================================================
-- Carrier follow-ups
-- =====================================================================
-- Customers got "remind me to get back to them" in Phase 2; carriers did
-- not. A dispatcher who tells a carrier "call me Tuesday about the rate"
-- needs the same nudge on the carrier list, so the column, the index and
-- the view column mirror customer_interactions exactly.

alter table public.carrier_interactions
  add column if not exists follow_up_at timestamptz;

comment on column public.carrier_interactions.follow_up_at is
  'A date the dispatcher wants to be reminded to get back to this carrier.
   Surfaced on the carrier list when due, the same way customer follow-ups
   are.';

create index if not exists carrier_interactions_followup_idx
  on public.carrier_interactions (follow_up_at) where follow_up_at is not null;

-- Same columns in the same order with follow_up_at appended at the END.
-- CREATE OR REPLACE VIEW only permits adding columns at the end, and the
-- view carries grants that a DROP would throw away.
create or replace view public.v_carrier_recent_interactions
with (security_invoker = true) as
select
  ci.id,
  ci.carrier_id,
  ci.load_id,
  l.load_number,
  ci.interaction_type_id,
  it.key      as interaction_type_key,
  it.label    as interaction_type_label,
  it.severity,
  ci.body,
  ci.created_by,
  p.full_name as created_by_name,
  ci.created_at,
  case
    when ci.created_at >= now() - interval '30 days' then 'recent'
    when ci.created_at >= now() - interval '1 year'  then 'caution'
    else 'archive'
  end as age_bucket,
  ci.follow_up_at
from public.carrier_interactions ci
left join public.interaction_types it on it.id = ci.interaction_type_id
left join public.loads l              on l.id  = ci.load_id
left join public.profiles p           on p.id  = ci.created_by;
