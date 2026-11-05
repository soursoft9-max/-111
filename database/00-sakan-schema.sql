-- =====================================================================
-- نظام سَكَن | بناء قاعدة البيانات من الصفر
-- يُشغَّل في Supabase > SQL Editor
--
-- تحذير: الجزء الأول يحذف كل الجداول والدوال في المخطط public
--        ويحذف كل حسابات المستخدمين (auth.users) وبياناتهم.
--        لا يحذف صور البطاقات المرفوعة: افرغي الحاوية id-cards من
--        Storage يدوياً إن أردتِ.
-- =====================================================================


-- =====================================================================
-- الجزء الأول: الحذف
-- =====================================================================
do $$
declare r record;
begin
  -- السياسات على صور البطاقات
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (qual ilike '%id-cards%' or with_check ilike '%id-cards%')
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;

  for r in select c.relname as viewname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('v','m')
             and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop view if exists public.%I cascade', r.viewname);
  end loop;
  for r in select c.relname as tablename from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
             and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
  -- حذف الدوال يحذف معها أي مُشغِّل (trigger) عليها، ومنها مُشغِّل التسجيل في auth.users
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

delete from auth.users;


-- =====================================================================
-- الجزء الثاني: الجداول
-- =====================================================================
create table public.settings (
  key   text primary key,
  value text
);
comment on table public.settings is
  'رموز التسجيل الاختيارية: signup_code_admin / signup_code_supervisor / signup_code_security / signup_code_student. القيمة الفارغة تعني تسجيلاً مفتوحاً.';

create table public.dormitories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  dormitory_id uuid not null references public.dormitories(id) on delete cascade,
  room_number  text not null,
  capacity     int  not null check (capacity between 1 and 20),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (dormitory_id, room_number)
);

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  email          text,
  role           text not null default 'student' check (role in ('student','supervisor','security','admin')),
  student_number text unique,
  civil_id       text,
  phone          text,
  guardian_name  text,
  guardian_phone text,
  dormitory_id   uuid references public.dormitories(id) on delete set null,
  room_id        uuid references public.rooms(id) on delete set null,
  fingerprint_id text unique,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.service_requests (
  id                       uuid primary key default gen_random_uuid(),
  student_id               uuid not null,
  request_type             text not null check (request_type in ('exit_permit','hosting','dorm_transfer','room_change')),
  source_dormitory_id      uuid references public.dormitories(id) on delete set null,
  source_room_id           uuid references public.rooms(id) on delete set null,
  destination_dormitory_id uuid references public.dormitories(id) on delete set null,
  destination_room_id      uuid references public.rooms(id) on delete set null,
  start_at                 timestamptz,
  end_at                   timestamptz,
  details                  jsonb not null default '{}'::jsonb,
  status                   text not null default 'pending_supervisor'
                           check (status in ('pending_supervisor','pending_admin','approved','rejected','cancelled','completed')),
  supervisor_decision_by   uuid,
  supervisor_decision_at   timestamptz,
  admin_decision_by        uuid,
  admin_decision_at        timestamptz,
  decision_note            text,
  security_status          text default 'not_received' check (security_status in ('not_received','received','verified','mismatch')),
  security_received_by     uuid,
  security_received_at     timestamptz,
  security_verified_by     uuid,
  security_verified_at     timestamptz,
  security_note            text,
  gate_out_at              timestamptz,
  gate_in_at               timestamptz,
  gate_by                  uuid,
  created_at               timestamptz not null default now(),
  constraint service_requests_student_id_fkey foreign key (student_id) references public.profiles(id) on delete cascade
);
create index service_requests_student_idx on public.service_requests (student_id, created_at desc);
create index service_requests_status_idx on public.service_requests (status, request_type);

create table public.attendance (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null,
  status          text not null default 'registered' check (status in ('registered','present','absent','late','excused')),
  method          text not null default 'web' check (method in ('web','fingerprint','web_fingerprint','manual')),
  registered_at   timestamptz,
  fingerprint_at  timestamptz,
  recorded_by     uuid,
  created_at      timestamptz not null default now(),
  unique (student_id, attendance_date)
);
create index attendance_date_idx on public.attendance (attendance_date);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  message    text not null,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);


-- =====================================================================
-- الجزء الثالث: دوال مساعدة
-- =====================================================================
create function public.sakan_today()
returns date language sql stable
as $$ select (now() at time zone 'Asia/Muscat')::date $$;

create function public.sakan_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid() and is_active $$;

create function public.sakan_user_dormitory()
returns uuid language sql stable security definer set search_path = public
as $$ select dormitory_id from profiles where id = auth.uid() $$;


-- =====================================================================
-- الجزء الرابع: إنشاء ملف المستخدم تلقائياً عند التسجيل
-- يقرأ البيانات المرسلة من صفحة إنشاء الحساب (options.data)
-- =====================================================================
create function public.sakan_insert_profile(p_id uuid, p_email text, p_meta jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  m jsonb := coalesce(p_meta, '{}'::jsonb);
  v_role text := coalesce(nullif(m->>'role', ''), 'student');
  v_code text;
  v_dorm uuid;
begin
  if v_role not in ('student','supervisor','security','admin') then
    raise exception 'نوع الحساب غير صحيح';
  end if;

  -- رمز التسجيل الاختياري لكل دور (إن لم يُضبط فالتسجيل مفتوح)
  select value into v_code from settings where key = 'signup_code_' || v_role;
  if coalesce(v_code, '') <> '' and coalesce(m->>'signup_code', '') <> v_code then
    raise exception 'رمز التسجيل غير صحيح';
  end if;

  if nullif(m->>'dormitory_id', '') is not null then
    select id into v_dorm from dormitories where id = (m->>'dormitory_id')::uuid and is_active;
  end if;
  if v_role = 'supervisor' and v_dorm is null then
    raise exception 'اختاري سكن المشرفة';
  end if;

  insert into profiles (id, full_name, email, role, student_number, phone, dormitory_id, is_active)
  values (
    p_id,
    coalesce(nullif(trim(m->>'full_name'), ''), split_part(p_email, '@', 1)),
    p_email,
    v_role,
    case when v_role = 'student' then nullif(trim(m->>'student_number'), '') end,
    nullif(trim(m->>'phone'), ''),
    case when v_role in ('student','supervisor') then v_dorm end,
    true
  )
  on conflict (id) do nothing;
end $$;
revoke all on function public.sakan_insert_profile(uuid, text, jsonb) from public, anon, authenticated;

create function public.sakan_handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform sakan_insert_profile(new.id, new.email, new.raw_user_meta_data);
  return new;
end $$;

-- إصلاح ذاتي: إن وُجد حساب دخول بلا ملف مستخدم يُنشأ ملفه عند الدخول
create function public.sakan_ensure_my_profile()
returns void language plpgsql security definer set search_path = public
as $$
declare u record;
begin
  if auth.uid() is null or exists (select 1 from profiles where id = auth.uid()) then return; end if;
  select id, email, raw_user_meta_data into u from auth.users where id = auth.uid();
  if found then perform sakan_insert_profile(u.id, u.email, u.raw_user_meta_data); end if;
end $$;
grant execute on function public.sakan_ensure_my_profile() to authenticated;

create trigger sakan_on_auth_user_created
  after insert on auth.users
  for each row execute function public.sakan_handle_new_user();


-- =====================================================================
-- الجزء الخامس: الطلبات
-- =====================================================================
-- تعبئة سكن وغرفة الطالبة تلقائياً + التحقق من طلبات النقل + منع التكرار
create function public.sakan_before_request_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_room rooms;
  v_used int;
begin
  select dormitory_id, room_id into new.source_dormitory_id, new.source_room_id
  from profiles where id = new.student_id;

  if new.request_type in ('room_change','dorm_transfer') then
    if new.source_dormitory_id is null then raise exception 'لم يُحدد سكنك بعد. راجعي الإدارة'; end if;
    if new.request_type = 'room_change' then
      new.destination_dormitory_id := new.source_dormitory_id;
    elsif new.destination_dormitory_id = new.source_dormitory_id then
      raise exception 'اختاري سكناً آخر غير سكنك الحالي';
    end if;
    select * into v_room from rooms where id = new.destination_room_id and is_active;
    if not found or v_room.dormitory_id is distinct from new.destination_dormitory_id then
      raise exception 'الغرفة المطلوبة غير صحيحة';
    end if;
    if new.destination_room_id = new.source_room_id then raise exception 'هذه غرفتك الحالية'; end if;
    select count(*) into v_used from profiles where room_id = v_room.id and role = 'student' and is_active;
    if v_used >= v_room.capacity then raise exception 'الغرفة المطلوبة ممتلئة'; end if;
  end if;

  if new.request_type in ('exit_permit','hosting') then
    if new.start_at is null or new.end_at is null or new.end_at <= new.start_at then
      raise exception 'وقت النهاية يجب أن يكون بعد وقت البداية';
    end if;
  end if;

  if exists (select 1 from service_requests
             where student_id = new.student_id and request_type = new.request_type
               and status in ('pending_supervisor','pending_admin')) then
    raise exception 'لديك طلب من نفس النوع قيد المراجعة';
  end if;
  return new;
end $$;

create trigger sakan_before_request_insert
  before insert on public.service_requests
  for each row execute function public.sakan_before_request_insert();

-- تنفيذ النقل (داخلي، يُستدعى من دالة القرار فقط)
create function public.sakan_apply_move(p_request_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  r service_requests;
  v_room rooms;
  v_used int;
begin
  select * into r from service_requests where id = p_request_id;
  select * into v_room from rooms where id = r.destination_room_id and is_active;
  if not found then raise exception 'الغرفة المطلوبة لم تعد متاحة'; end if;
  select count(*) into v_used from profiles
   where room_id = v_room.id and role = 'student' and is_active and id <> r.student_id;
  if v_used >= v_room.capacity then raise exception 'الغرفة المطلوبة ممتلئة الآن'; end if;
  update profiles set dormitory_id = v_room.dormitory_id, room_id = v_room.id where id = r.student_id;
end $$;
revoke all on function public.sakan_apply_move(uuid) from public, anon, authenticated;

-- قرار المشرفة / الإدارة لكل أنواع الطلبات
create function public.sakan_decide_request(p_request_id uuid, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path = public
as $$
declare
  r service_requests;
  v_role text := sakan_user_role();
  v_uid uuid := auth.uid();
  v_new text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'قرار غير صحيح'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'يرجى كتابة سبب الرفض'; end if;

  select * into r from service_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;

  if v_role = 'supervisor' then
    if r.status <> 'pending_supervisor' then raise exception 'تمت معالجة هذا الطلب مسبقاً'; end if;
    if r.source_dormitory_id is distinct from sakan_user_dormitory() then raise exception 'هذا الطلب ليس من سكنك'; end if;
    if p_decision = 'rejected' then v_new := 'rejected';
    elsif r.request_type = 'dorm_transfer' then v_new := 'pending_admin';
    elsif r.request_type = 'room_change' then perform sakan_apply_move(r.id); v_new := 'completed';
    else v_new := 'approved';
    end if;
    update service_requests
       set status = v_new, supervisor_decision_by = v_uid, supervisor_decision_at = now(),
           decision_note = coalesce(nullif(trim(p_note), ''), decision_note)
     where id = r.id;

  elsif v_role = 'admin' then
    if r.status not in ('pending_supervisor','pending_admin') then raise exception 'تمت معالجة هذا الطلب مسبقاً'; end if;
    if p_decision = 'rejected' then v_new := 'rejected';
    elsif r.request_type in ('dorm_transfer','room_change') then perform sakan_apply_move(r.id); v_new := 'completed';
    else v_new := 'approved';
    end if;
    update service_requests
       set status = v_new, admin_decision_by = v_uid, admin_decision_at = now(),
           decision_note = coalesce(nullif(trim(p_note), ''), decision_note)
     where id = r.id;
  else
    raise exception 'ليست لديك صلاحية لهذا الإجراء';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (v_uid, 'request_' || p_decision, 'service_request', r.id,
          jsonb_build_object('new_status', v_new, 'note', p_note, 'role', v_role));

  insert into notifications (user_id, title, message)
  values (r.student_id, 'تحديث على طلبك',
          case v_new
            when 'rejected' then 'تم رفض طلبك' || coalesce(': ' || nullif(trim(p_note), ''), '')
            when 'pending_admin' then 'وافقت المشرفة على طلب النقل، وهو الآن بانتظار الإدارة'
            when 'completed' then 'تم تنفيذ النقل وتحديث سكنك وغرفتك'
            else 'تمت الموافقة على طلبك'
          end);
  return v_new;
end $$;
grant execute on function public.sakan_decide_request(uuid, text, text) to authenticated;

-- الأمن: استلام البطاقة والتحقق منها (أو تسجيل اختلاف)
create function public.security_update_request(p_request_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = public
as $$
declare r service_requests;
begin
  if sakan_user_role() <> 'security' then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.request_type <> 'exit_permit' or r.status <> 'approved' then
    raise exception 'التصريح غير معتمد';
  end if;

  if p_action = 'received' then
    if r.security_status <> 'not_received' then raise exception 'استُلمت البطاقة مسبقاً'; end if;
    update service_requests set security_status = 'received', security_received_by = auth.uid(),
           security_received_at = now(), security_note = coalesce(p_note, security_note) where id = r.id;
  elsif p_action = 'verified' then
    if r.security_status <> 'received' then raise exception 'استلمي البطاقة أولاً'; end if;
    update service_requests set security_status = 'verified', security_verified_by = auth.uid(),
           security_verified_at = now(), security_note = coalesce(p_note, security_note) where id = r.id;
  elsif p_action = 'mismatch' then
    update service_requests set security_status = 'mismatch', security_note = p_note where id = r.id;
  else
    raise exception 'إجراء غير صحيح';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'security_' || p_action, 'service_request', r.id, jsonb_build_object('note', p_note));
  return p_action;
end $$;
grant execute on function public.security_update_request(uuid, text, text) to authenticated;

-- الأمن: خروج الطالبة وعودتها، ودخول الضيفة ومغادرتها
create function public.sakan_security_gate(p_request_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public
as $$
declare r service_requests;
begin
  if sakan_user_role() <> 'security' then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.status <> 'approved' then raise exception 'الطلب غير معتمد'; end if;

  if r.request_type = 'exit_permit' then
    if p_action = 'out' then
      if r.security_status <> 'verified' then raise exception 'تحققي من البطاقة أولاً'; end if;
      if r.gate_out_at is not null then raise exception 'سُجّل الخروج مسبقاً'; end if;
      update service_requests set gate_out_at = now(), gate_by = auth.uid() where id = r.id;
    elsif p_action = 'in' then
      if r.gate_out_at is null then raise exception 'لم يُسجَّل خروج الطالبة'; end if;
      update service_requests set gate_in_at = now(), gate_by = auth.uid(), status = 'completed' where id = r.id;
    else raise exception 'إجراء غير صحيح'; end if;

  elsif r.request_type = 'hosting' then
    if p_action = 'in' then
      if r.gate_in_at is not null then raise exception 'سُجّل دخول الضيفة مسبقاً'; end if;
      update service_requests set gate_in_at = now(), gate_by = auth.uid() where id = r.id;
    elsif p_action = 'out' then
      if r.gate_in_at is null then raise exception 'لم يُسجَّل دخول الضيفة'; end if;
      update service_requests set gate_out_at = now(), gate_by = auth.uid(), status = 'completed' where id = r.id;
    else raise exception 'إجراء غير صحيح'; end if;
  else
    raise exception 'هذا الطلب لا يمر عبر البوابة';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'gate_' || p_action, 'service_request', r.id, jsonb_build_object('type', r.request_type));
  return p_action;
end $$;
grant execute on function public.sakan_security_gate(uuid, text) to authenticated;

-- الطالبة: حفظ الرقم المدني المقروء من بطاقتها (إن لم يكن محفوظاً)
create function public.update_my_identity_from_card(p_full_name text default null, p_civil_id text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update profiles
     set civil_id = coalesce(civil_id, nullif(trim(p_civil_id), ''))
   where id = auth.uid() and role = 'student';
end $$;
grant execute on function public.update_my_identity_from_card(text, text) to authenticated;


-- =====================================================================
-- الجزء السادس: الحضور (التسجيل ثم البصمة)
-- =====================================================================
create function public.sakan_register_attendance()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row attendance;
begin
  if sakan_user_role() <> 'student' then raise exception 'هذه الخدمة للطالبات فقط'; end if;
  insert into attendance (student_id, attendance_date, status, method, registered_at)
  values (auth.uid(), sakan_today(), 'registered', 'web', now())
  on conflict (student_id, attendance_date) do nothing;
  select * into v_row from attendance where student_id = auth.uid() and attendance_date = sakan_today();
  return to_jsonb(v_row);
end $$;
grant execute on function public.sakan_register_attendance() to authenticated;

create function public.sakan_record_fingerprint(p_fingerprint_id text, p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_student profiles;
  v_day date := (p_at at time zone 'Asia/Muscat')::date;
  v_row attendance;
begin
  if sakan_user_role() not in ('security','admin') then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;

  select * into v_student from profiles where fingerprint_id = trim(p_fingerprint_id) and role = 'student';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown', 'message', 'رقم البصمة غير مسجّل لأي طالبة');
  end if;

  select * into v_row from attendance where student_id = v_student.id and attendance_date = v_day for update;
  if not found or v_row.registered_at is null or v_row.registered_at > p_at then
    return jsonb_build_object('ok', false, 'code', 'not_registered',
      'message', v_student.full_name || ': لم تسجّل حضورها في الموقع قبل البصمة');
  end if;
  if v_row.fingerprint_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already', 'message', v_student.full_name || ': البصمة مسجلة مسبقاً');
  end if;

  update attendance
     set fingerprint_at = p_at, status = 'present', method = 'web_fingerprint', recorded_by = auth.uid()
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'code', 'confirmed', 'message', 'تم تأكيد حضور ' || v_student.full_name);
end $$;
grant execute on function public.sakan_record_fingerprint(text, timestamptz) to authenticated;

-- الغرف المتاحة مع الإشغال (أعداد فقط بلا أسماء)
create function public.sakan_room_availability()
returns table (room_id uuid, dormitory_id uuid, dormitory_name text, room_number text, capacity int, occupied int)
language sql stable security definer set search_path = public
as $$
  select r.id, r.dormitory_id, d.name, r.room_number, r.capacity,
         (select count(*)::int from profiles p where p.room_id = r.id and p.role = 'student' and p.is_active)
  from rooms r join dormitories d on d.id = r.dormitory_id
  where r.is_active and d.is_active
  order by d.name, r.room_number
$$;
grant execute on function public.sakan_room_availability() to authenticated;


-- =====================================================================
-- الجزء السابع: الصلاحيات (RLS)
-- =====================================================================
alter table public.settings         enable row level security;
alter table public.dormitories      enable row level security;
alter table public.rooms            enable row level security;
alter table public.profiles         enable row level security;
alter table public.service_requests enable row level security;
alter table public.attendance       enable row level security;
alter table public.notifications    enable row level security;
alter table public.audit_logs       enable row level security;

-- الإعدادات: الإدارة فقط
create policy "Admins manage settings" on public.settings for all to authenticated
  using (sakan_user_role() = 'admin') with check (sakan_user_role() = 'admin');

-- السكنات: قائمة السكنات النشطة متاحة لصفحة إنشاء الحساب قبل الدخول
create policy "Anyone views active dormitories" on public.dormitories for select to anon, authenticated
  using (is_active);
create policy "Admins manage dormitories" on public.dormitories for all to authenticated
  using (sakan_user_role() = 'admin') with check (sakan_user_role() = 'admin');

-- الغرف
create policy "Users view active rooms" on public.rooms for select to authenticated
  using (is_active);
create policy "Admins manage rooms" on public.rooms for all to authenticated
  using (sakan_user_role() = 'admin') with check (sakan_user_role() = 'admin');

-- ملفات المستخدمين
create policy "Scoped profile read" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or sakan_user_role() = 'admin'
    or (sakan_user_role() = 'supervisor' and dormitory_id = sakan_user_dormitory())
    or (sakan_user_role() = 'security' and exists (
          select 1 from service_requests sr
           where sr.student_id = profiles.id
             and sr.request_type in ('exit_permit','hosting')
             and sr.status in ('approved','completed')))
  );
create policy "Admins update profiles" on public.profiles for update to authenticated
  using (sakan_user_role() = 'admin') with check (sakan_user_role() = 'admin');
create policy "Admins delete profiles" on public.profiles for delete to authenticated
  using (sakan_user_role() = 'admin');

-- الطلبات: القراءة حسب الدور، والإنشاء للطالبة فقط، والتعديل عبر الدوال فقط
create policy "Scoped request read" on public.service_requests for select to authenticated
  using (
    student_id = auth.uid()
    or sakan_user_role() = 'admin'
    or (sakan_user_role() = 'supervisor'
        and (source_dormitory_id = sakan_user_dormitory() or destination_dormitory_id = sakan_user_dormitory()))
    or (sakan_user_role() = 'security'
        and request_type in ('exit_permit','hosting') and status in ('approved','completed'))
  );
create policy "Students submit requests" on public.service_requests for insert to authenticated
  with check (
    student_id = auth.uid() and sakan_user_role() = 'student'
    and status = 'pending_supervisor'
    and supervisor_decision_by is null and admin_decision_by is null
    and coalesce(security_status, 'not_received') = 'not_received'
    and gate_out_at is null and gate_in_at is null
  );

-- الحضور: القراءة فقط (التسجيل والبصمة عبر الدوال)
create policy "Scoped attendance read" on public.attendance for select to authenticated
  using (
    student_id = auth.uid()
    or sakan_user_role() = 'admin'
    or (sakan_user_role() = 'supervisor' and exists (
          select 1 from profiles p where p.id = attendance.student_id and p.dormitory_id = sakan_user_dormitory()))
  );

-- الإشعارات
create policy "Users read own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "Users mark own notifications read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- السجل
create policy "Admins read audit logs" on public.audit_logs for select to authenticated
  using (sakan_user_role() = 'admin');


-- =====================================================================
-- الجزء الثامن: تخزين صور البطاقات (خاص)   المسار: <معرّف الطالبة>/<ملف>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-cards', 'id-cards', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

create policy "Students upload own id cards" on storage.objects for insert to authenticated
  with check (bucket_id = 'id-cards'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.sakan_user_role() = 'student');

create policy "Scoped id card read" on storage.objects for select to authenticated
  using (bucket_id = 'id-cards' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.sakan_user_role() = 'admin'
    or (public.sakan_user_role() = 'supervisor' and exists (
          select 1 from public.profiles p
           where p.id::text = (storage.foldername(name))[1]
             and p.dormitory_id = public.sakan_user_dormitory()))
    or (public.sakan_user_role() = 'security' and exists (
          select 1 from public.service_requests sr
           where sr.student_id::text = (storage.foldername(name))[1]
             and sr.request_type = 'exit_permit'
             and sr.status in ('approved','completed')))
  ));


-- =====================================================================
-- الجزء التاسع: بيانات أولية
-- =====================================================================
insert into public.settings (key, value) values
  ('signup_code_admin', null), ('signup_code_supervisor', null),
  ('signup_code_security', null), ('signup_code_student', null);

-- سكن أول تستطيع المشرفات والطالبات اختياره عند التسجيل (عدّليه أو احذفيه من لوحة الإدارة)
with d as (
  insert into public.dormitories (name, address) values ('السكن الرئيسي', null) returning id
)
insert into public.rooms (dormitory_id, room_number, capacity)
select d.id, n, 2 from d, unnest(array['101','102','103','104']) as n;
