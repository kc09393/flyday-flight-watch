alter table public.flight_watches add column if not exists search_mode text not null default 'exact';
alter table public.flight_watches add column if not exists travel_month date;
alter table public.flight_watches add column if not exists trip_days_min smallint;
alter table public.flight_watches add column if not exists trip_days_max smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flight_watches_search_mode_check') then
    alter table public.flight_watches add constraint flight_watches_search_mode_check check (search_mode in ('exact', 'month'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flight_watches_flexible_dates_check') then
    alter table public.flight_watches add constraint flight_watches_flexible_dates_check check (
      search_mode = 'exact' or (
        travel_month is not null and
        trip_days_min between 1 and 30 and
        trip_days_max between trip_days_min and 30
      )
    );
  end if;
end $$;
