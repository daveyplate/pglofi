-- inserts a row into public.profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, image)
  values (new.id, new.name, new.image);
  return new;
end;
$$;

create or replace function public.handle_update_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.profiles set name = new.name, image = new.image, "updatedAt" = now() where id = new.id;
  return new;
end;
$$;

-- trigger the function every time a user is created
drop trigger if exists on_auth_user_created on public.users;
create trigger on_auth_user_created
  after insert on public.users
  for each row execute procedure public.handle_new_user();

drop trigger if exists on_auth_user_updated on public.users;
create trigger on_auth_user_updated
  after update on public.users
  for each row execute procedure public.handle_update_user();