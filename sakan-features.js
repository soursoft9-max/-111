// =============================================
// نظام سَكَن | الخدمات الإضافية
// الحضور، الاستضافة، النقل وتغيير الغرفة، الإشعارات،
// حضور السكن للمشرفة، البصمة اليدوية للأمن،
// وإدارة الطالبات والغرف والطلبات والحضور للإدارة
// =============================================

import { supabase } from "./main.js";
import {
  esc, fmtDateTime, fmtTime, fmtDay, todayStr, TYPE_LABELS, pill, statusPill, gatePill,
  stepsTrack, loadPlaces, requestDetailsHTML, cardImagesHTML, hydrateCardImages, setMsg
} from "./sakan-shared.js";

const $ = (s, p = document) => p.querySelector(s);
const page = document.body.dataset.page;
const ROLE_NAMES = { student: "طالبة", supervisor: "مشرفة", security: "أمن", admin: "إدارة" };

async function session(roles) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { location.href = roles.includes("student") ? "login.html" : "index.html"; return null; }
  let { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile && !(await supabase.rpc("sakan_ensure_my_profile")).error) {
    ({ data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle());
  }
  if (!profile || !profile.is_active || !roles.includes(profile.role)) { location.href = "index.html"; return null; }
  const who = $("#sk-who");
  if (who) who.textContent = profile.full_name || user.email;
  return { user, profile };
}

const errText = e => {
  const m = e?.message || "";
  if (e?.code === "23505") return "القيمة مستخدمة لحساب آخر (رقم البصمة أو الرقم الجامعي)";
  return /[؀-ۿ]/.test(m) ? m : "تعذّر تنفيذ العملية. حاولي مرة أخرى.";
};

/* =============================================
   الطالبة: الحضور (التسجيل ثم البصمة)
   ============================================= */
async function studentAttendance() {
  const s = await session(["student"]); if (!s) return;
  const msg = $("#att-message");

  async function render() {
    const { data, error } = await supabase.from("attendance")
      .select("*").eq("student_id", s.user.id).order("attendance_date", { ascending: false }).limit(30);
    if (error) { setMsg(msg, "تعذّر تحميل سجل الحضور.", "error"); return; }
    const today = (data || []).find(r => r.attendance_date === todayStr());
    const state = !today ? "لم تسجّلي حضورك اليوم"
      : today.fingerprint_at ? "الحضور مكتمل"
      : "سُجّل الحضور، توجّهي لجهاز البصمة";

    $("#att-today").innerHTML = `
      <div class="sk-today">
        <div><div class="sk-num" style="color:var(--muted)">${esc(fmtDay(todayStr()))}</div><div class="state">${esc(state)}</div></div>
        ${!today ? `<button class="sk-btn primary" id="att-register">تسجيل الحضور الآن</button>`
          : today.fingerprint_at ? pill("مكتمل " + fmtTime(today.fingerprint_at), "good") : pill("بانتظار البصمة", "warn")}
      </div>
      <div class="sk-twostep">
        <div class="${today ? "done" : ""}"><i>1</i><span><b>التسجيل في الموقع</b>${today ? esc(fmtTime(today.registered_at)) : "اضغطي زر تسجيل الحضور"}</span></div>
        <div class="${today?.fingerprint_at ? "done" : ""}"><i>2</i><span><b>البصمة على جهاز السكن</b>${today?.fingerprint_at ? esc(fmtTime(today.fingerprint_at)) : `رقمك في الجهاز: <span class="sk-num">${esc(s.profile.fingerprint_id || "لم يُحدد بعد")}</span>`}</span></div>
      </div>`;

    $("#att-history").innerHTML = data?.length ? `<div class="sk-table-wrap"><table class="sk-table">
      <thead><tr><th>اليوم</th><th>التسجيل</th><th>البصمة</th><th>الحالة</th></tr></thead><tbody>
      ${data.map(r => `<tr><td>${esc(fmtDay(r.attendance_date))}</td><td class="sk-num">${esc(fmtTime(r.registered_at || r.created_at))}</td><td class="sk-num">${esc(fmtTime(r.fingerprint_at))}</td>
        <td>${r.status === "present" ? pill("حاضرة", "good") : r.status === "registered" ? pill("بلا بصمة", "warn") : pill(r.status, "muted")}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="sk-empty">لا يوجد سجل حضور بعد.</p>`;

    $("#att-register")?.addEventListener("click", async e => {
      e.target.disabled = true;
      const { error } = await supabase.rpc("sakan_register_attendance");
      if (error) { setMsg(msg, errText(error), "error"); e.target.disabled = false; return; }
      setMsg(msg, "تم تسجيل حضورك. توجّهي الآن لجهاز البصمة لإكمال الحضور.", "success");
      render();
    });
  }
  if (!s.profile.fingerprint_id) setMsg(msg, "لم تُسجّل إدارة السكن رقم بصمتك بعد. راجعي الإدارة لإكمال الحضور بالبصمة.", "info");
  render();
}

/* =============================================
   قائمة طلبات الطالبة حسب النوع (مشتركة)
   ============================================= */
async function renderMyRequests(userId, types, el, places) {
  const { data, error } = await supabase.from("service_requests").select("*")
    .eq("student_id", userId).in("request_type", types).order("created_at", { ascending: false });
  if (error) { el.innerHTML = `<p class="sk-empty">تعذّر تحميل الطلبات.</p>`; return; }
  el.innerHTML = data?.length ? data.map(r => `
    <article class="sk-req"><div class="sk-req-head"><h3>${esc(TYPE_LABELS[r.request_type])}</h3><div class="sk-row">${statusPill(r.status)}${gatePill(r)}</div></div>
    ${stepsTrack(r)}${requestDetailsHTML(r, places)}</article>`).join("")
    : `<p class="sk-empty">لا توجد طلبات حتى الآن.</p>`;
}

/* =============================================
   الطالبة: الاستضافة
   ============================================= */
async function studentHosting() {
  const s = await session(["student"]); if (!s) return;
  const form = $("#hosting-form"), msg = $("#hosting-message"), list = $("#hosting-list");
  $("#h-date").value = todayStr();
  renderMyRequests(s.user.id, ["hosting"], list);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id).value.trim();
    const start = new Date(`${v("h-date")}T${v("h-from")}`), end = new Date(`${v("h-date")}T${v("h-to")}`);
    if (!(end > start)) return setMsg(msg, "وقت انتهاء الزيارة يجب أن يكون بعد وقت بدايتها.", "error");
    if (start < new Date(Date.now() - 3600e3)) return setMsg(msg, "موعد الزيارة في الماضي.", "error");
    const btn = form.querySelector("[type=submit]"); btn.disabled = true;
    setMsg(msg, "جارٍ إرسال الطلب...", "info");
    const { error } = await supabase.from("service_requests").insert({
      student_id: s.user.id, request_type: "hosting", status: "pending_supervisor",
      start_at: start.toISOString(), end_at: end.toISOString(),
      details: { description: v("h-note"), guest: { full_name: v("h-name"), relationship: v("h-rel"), civil_id: v("h-civil"), phone: v("h-phone") } }
    });
    btn.disabled = false;
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "أُرسل طلب الاستضافة إلى المشرفة.", "success");
    form.reset(); $("#h-date").value = todayStr();
    renderMyRequests(s.user.id, ["hosting"], list);
  });
}

/* =============================================
   الطالبة: النقل بين السكنات وتغيير الغرفة
   ============================================= */
async function studentTransfer() {
  const s = await session(["student"]); if (!s) return;
  const msg = $("#tr-message"), list = $("#tr-list");
  const [{ data: rooms, error }, places] = await Promise.all([supabase.rpc("sakan_room_availability"), loadPlaces(supabase)]);
  if (error) { setMsg(msg, "تعذّر تحميل الغرف المتاحة.", "error"); return; }
  let type = new URLSearchParams(location.search).get("type") === "dorm_transfer" ? "dorm_transfer" : "room_change";
  const cur = s.profile;
  $("#tr-current").textContent = cur.dormitory_id
    ? `${places.dorms.get(cur.dormitory_id) || "—"}${cur.room_id ? " · غرفة " + (places.rooms.get(cur.room_id) || "") : " · لم تُحدد غرفة"}`
    : "لم يُحدد سكنك بعد. راجعي الإدارة.";

  const dormSel = $("#tr-dorm"), roomSel = $("#tr-room");
  const dorms = [...new Map(rooms.map(r => [r.dormitory_id, r.dormitory_name]))];

  function fillRooms() {
    const dormId = type === "room_change" ? cur.dormitory_id : dormSel.value;
    const opts = rooms.filter(r => r.dormitory_id === dormId && r.room_id !== cur.room_id);
    roomSel.innerHTML = opts.length ? opts.map(r => {
      const full = r.occupied >= r.capacity;
      return `<option value="${r.room_id}" ${full ? "disabled" : ""}>غرفة ${esc(r.room_number)} — ${r.occupied}/${r.capacity}${full ? " (ممتلئة)" : ""}</option>`;
    }).join("") : `<option value="">لا توجد غرف أخرى في هذا السكن</option>`;
    const firstFree = opts.find(r => r.occupied < r.capacity);
    if (firstFree) roomSel.value = firstFree.room_id;
  }
  function setType(t) {
    type = t;
    document.querySelectorAll("[data-tr-type]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.trType === t)));
    $("#tr-dorm-field").hidden = t === "room_change";
    $("#tr-title").textContent = t === "room_change" ? "طلب تغيير الغرفة داخل سكنك" : "طلب النقل إلى سكن آخر";
    $("#tr-hint").textContent = t === "room_change" ? "يُنفَّذ التغيير بعد موافقة مشرفة السكن." : "يمر الطلب على المشرفة ثم الإدارة، ويُنفَّذ النقل بعد اعتماد الإدارة.";
    fillRooms();
  }
  dormSel.innerHTML = dorms.filter(([id]) => id !== cur.dormitory_id).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("") || `<option value="">لا توجد سكنات أخرى</option>`;
  dormSel.addEventListener("change", fillRooms);
  document.querySelectorAll("[data-tr-type]").forEach(b => b.addEventListener("click", () => setType(b.dataset.trType)));
  setType(type);
  renderMyRequests(s.user.id, ["room_change", "dorm_transfer"], list, places);

  $("#tr-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!cur.dormitory_id) return setMsg(msg, "لم يُحدد سكنك بعد. راجعي الإدارة.", "error");
    if (!roomSel.value) return setMsg(msg, "اختاري غرفة متاحة.", "error");
    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    const { error } = await supabase.from("service_requests").insert({
      student_id: s.user.id, request_type: type, status: "pending_supervisor",
      destination_dormitory_id: type === "room_change" ? cur.dormitory_id : dormSel.value,
      destination_room_id: roomSel.value,
      details: { description: $("#tr-reason").value.trim() }
    });
    btn.disabled = false;
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "أُرسل الطلب إلى المشرفة.", "success");
    $("#tr-reason").value = "";
    renderMyRequests(s.user.id, ["room_change", "dorm_transfer"], list, places);
  });
}

/* =============================================
   الإشعارات
   ============================================= */
async function notifications() {
  const s = await session(["student", "supervisor", "security", "admin"]); if (!s) return;
  const { data } = await supabase.from("notifications").select("*").eq("user_id", s.user.id).order("created_at", { ascending: false }).limit(50);
  $("#notif-list").innerHTML = data?.length ? data.map(n => `
    <article class="sk-req"><div class="sk-req-head"><h3>${esc(n.title)}</h3>${n.is_read ? "" : pill("جديد", "info")}</div>
    <p style="margin:0">${esc(n.message)}</p><small style="color:var(--muted)">${esc(fmtDateTime(n.created_at))}</small></article>`).join("")
    : `<p class="sk-empty">لا توجد إشعارات.</p>`;
  const unread = (data || []).filter(n => !n.is_read).map(n => n.id);
  if (unread.length) await supabase.from("notifications").update({ is_read: true }).in("id", unread);
}

/* =============================================
   جدول حضور (للمشرفة والإدارة)
   ============================================= */
function attendanceTable(students, records, places, showDorm) {
  const byStudent = new Map(records.map(r => [r.student_id, r]));
  const rows = students.map(st => {
    const r = byStudent.get(st.id);
    const state = r?.fingerprint_at || r?.status === "present" ? pill("حاضرة", "good") : r ? pill("بلا بصمة", "warn") : pill("لم تسجّل", "bad");
    return `<tr><td>${esc(st.full_name)}</td><td class="sk-num">${esc(st.student_number || "—")}</td>
      ${showDorm ? `<td>${esc(places.dorms.get(st.dormitory_id) || "—")}</td>` : ""}<td>${esc(places.rooms.get(st.room_id) || "—")}</td>
      <td class="sk-num">${esc(st.fingerprint_id || "—")}</td><td class="sk-num">${esc(fmtTime(r?.registered_at))}</td><td class="sk-num">${esc(fmtTime(r?.fingerprint_at))}</td><td>${state}</td></tr>`;
  });
  const present = students.filter(st => { const r = byStudent.get(st.id); return r?.fingerprint_at || r?.status === "present"; }).length;
  const regOnly = students.filter(st => { const r = byStudent.get(st.id); return r && !r.fingerprint_at && r.status !== "present"; }).length;
  return {
    stats: `<div class="sk-stat"><strong>${students.length}</strong><span>الطالبات</span></div><div class="sk-stat"><strong>${present}</strong><span>حاضرة (تسجيل وبصمة)</span></div>
      <div class="sk-stat"><strong>${regOnly}</strong><span>سجّلت بدون بصمة</span></div><div class="sk-stat"><strong>${students.length - present - regOnly}</strong><span>لم تسجّل</span></div>`,
    table: `<div class="sk-table-wrap"><table class="sk-table"><thead><tr><th>الطالبة</th><th>الرقم الجامعي</th>${showDorm ? "<th>السكن</th>" : ""}<th>الغرفة</th><th>رقم البصمة</th><th>التسجيل</th><th>البصمة</th><th>الحالة</th></tr></thead>
      <tbody>${rows.join("") || `<tr><td colspan="8" class="sk-empty">لا توجد طالبات.</td></tr>`}</tbody></table></div>`,
    csv: [["الطالبة", "الرقم الجامعي", "السكن", "الغرفة", "رقم البصمة", "التسجيل", "البصمة", "الحالة"],
      ...students.map(st => { const r = byStudent.get(st.id); return [st.full_name, st.student_number || "", places.dorms.get(st.dormitory_id) || "", places.rooms.get(st.room_id) || "", st.fingerprint_id || "", fmtTime(r?.registered_at), fmtTime(r?.fingerprint_at), r?.fingerprint_at || r?.status === "present" ? "حاضرة" : r ? "بلا بصمة" : "لم تسجّل"]; })]
  };
}
function downloadCSV(rows, name) {
  const text = "﻿" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function attendanceReport(isAdmin) {
  const s = await session([isAdmin ? "admin" : "supervisor"]); if (!s) return;
  const places = await loadPlaces(supabase);
  const dateIn = $("#rep-date"), dormSel = $("#rep-dorm"), msg = $("#rep-message");
  dateIn.value = todayStr();
  if (isAdmin) dormSel.innerHTML = `<option value="">كل السكنات</option>` + [...places.dorms].map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("");
  else { $("#rep-dorm-field").hidden = true; $("#rep-sub").textContent = places.dorms.get(s.profile.dormitory_id) || ""; }
  let last = null;

  async function load() {
    let q = supabase.from("profiles").select("id, full_name, student_number, dormitory_id, room_id, fingerprint_id")
      .eq("role", "student").eq("is_active", true).order("full_name");
    const dorm = isAdmin ? dormSel.value : s.profile.dormitory_id;
    if (dorm) q = q.eq("dormitory_id", dorm);
    const [{ data: students, error: e1 }, { data: recs, error: e2 }] = await Promise.all([q,
      supabase.from("attendance").select("*").eq("attendance_date", dateIn.value)]);
    if (e1 || e2) return setMsg(msg, "تعذّر تحميل الحضور.", "error");
    last = attendanceTable(students || [], recs || [], places, isAdmin);
    $("#rep-stats").innerHTML = last.stats; $("#rep-table").innerHTML = last.table;
  }
  dateIn.addEventListener("change", load); dormSel?.addEventListener("change", load);
  $("#rep-export").addEventListener("click", () => last && downloadCSV(last.csv, `حضور-${dateIn.value}.csv`));
  load();
}

/* =============================================
   الأمن: إدخال البصمة يدوياً
   ============================================= */
function fingerprintPanel() {
  const form = $("#fingerprint-form"); if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#fingerprint-id"), msg = $("#fingerprint-message");
    const { data, error } = await supabase.rpc("sakan_record_fingerprint", { p_fingerprint_id: input.value.trim() });
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, data.message, data.ok ? "success" : "error");
    if (data.ok) input.value = "";
    input.focus();
  });
}

/* =============================================
   الإدارة: تعديل بيانات حساب (طالبة / مشرفة / أمن)
   ============================================= */
async function adminEditUser() {
  const s = await session(["admin"]); if (!s) return;
  const id = new URLSearchParams(location.search).get("id");
  const msg = $("#edit-message");
  const [{ data: p, error }, { data: dorms }, { data: rooms }, { data: avail }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("dormitories").select("id, name, is_active").order("name"),
    supabase.from("rooms").select("id, dormitory_id, room_number, capacity, is_active").order("room_number"),
    supabase.rpc("sakan_room_availability")
  ]);
  if (error || !p) { setMsg(msg, "الحساب غير موجود.", "error"); return; }
  const occ = new Map((avail || []).map(r => [r.room_id, r.occupied]));
  const f = id => $("#" + id);
  f("e-title").textContent = p.full_name;
  ["full_name", "student_number", "civil_id", "phone", "guardian_name", "guardian_phone", "fingerprint_id"].forEach(k => f("e-" + k).value = p[k] || "");
  f("e-role").value = p.role; f("e-active").checked = p.is_active;
  f("e-dorm").innerHTML = `<option value="">— بدون —</option>` + (dorms || []).map(d => `<option value="${d.id}">${esc(d.name)}${d.is_active ? "" : " (متوقف)"}</option>`).join("");
  f("e-dorm").value = p.dormitory_id || "";
  function fillRooms() {
    const list = (rooms || []).filter(r => r.dormitory_id === f("e-dorm").value && r.is_active);
    f("e-room").innerHTML = `<option value="">— بدون —</option>` + list.map(r => {
      const n = (occ.get(r.id) || 0) - (r.id === p.room_id ? 1 : 0), full = n >= r.capacity;
      return `<option value="${r.id}" ${full ? "disabled" : ""}>${esc(r.room_number)} — ${n}/${r.capacity}${full ? " ممتلئة" : ""}</option>`;
    }).join("");
    if (list.some(r => r.id === p.room_id)) f("e-room").value = p.room_id;
  }
  function roleView() { document.querySelectorAll("[data-student-only]").forEach(x => x.hidden = f("e-role").value !== "student"); }
  f("e-dorm").addEventListener("change", fillRooms); f("e-role").addEventListener("change", roleView);
  fillRooms(); roleView();

  $("#edit-form").addEventListener("submit", async e => {
    e.preventDefault();
    const role = f("e-role").value;
    if (role === "supervisor" && !f("e-dorm").value) return setMsg(msg, "حددي سكن المشرفة.", "error");
    const upd = {
      full_name: f("e-full_name").value.trim(), role, is_active: f("e-active").checked,
      dormitory_id: f("e-dorm").value || null,
      room_id: role === "student" ? (f("e-room").value || null) : null,
      student_number: role === "student" ? (f("e-student_number").value.trim() || null) : null,
      fingerprint_id: role === "student" ? (f("e-fingerprint_id").value.trim() || null) : null,
      civil_id: f("e-civil_id").value.trim() || null, phone: f("e-phone").value.trim() || null,
      guardian_name: f("e-guardian_name").value.trim() || null, guardian_phone: f("e-guardian_phone").value.trim() || null
    };
    const { error } = await supabase.from("profiles").update(upd).eq("id", id);
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "حُفظت البيانات.", "success");
  });
}

/* =============================================
   الإدارة: غرف السكن
   ============================================= */
async function adminRooms() {
  const s = await session(["admin"]); if (!s) return;
  const msg = $("#rooms-message"), sel = $("#rooms-dorm");
  const { data: dorms } = await supabase.from("dormitories").select("id, name").order("name");
  sel.innerHTML = (dorms || []).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  const want = new URLSearchParams(location.search).get("dorm");
  if (want) sel.value = want;
  if (!dorms?.length) { $("#rooms-table").innerHTML = `<p class="sk-empty">أضيفي سكناً أولاً من صفحة السكنات.</p>`; return; }

  async function load() {
    const [{ data: rooms }, { data: studs }] = await Promise.all([
      supabase.from("rooms").select("*").eq("dormitory_id", sel.value).order("room_number"),
      supabase.from("profiles").select("full_name, room_id").eq("role", "student").eq("dormitory_id", sel.value).eq("is_active", true)
    ]);
    $("#rooms-table").innerHTML = rooms?.length ? `<div class="sk-table-wrap"><table class="sk-table"><thead><tr><th>الغرفة</th><th>السعة</th><th>الإشغال</th><th>الساكنات</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${rooms.map(r => {
        const ins = (studs || []).filter(x => x.room_id === r.id), pct = Math.min(100, ins.length / r.capacity * 100);
        return `<tr><td class="sk-num">${esc(r.room_number)}</td>
          <td><input type="number" min="1" max="20" value="${r.capacity}" data-cap="${r.id}" style="width:70px" aria-label="سعة الغرفة ${esc(r.room_number)}"></td>
          <td><span class="sk-occ"><span class="${ins.length >= r.capacity ? "full" : ""}" style="width:${pct}%"></span></span><span class="sk-num">${ins.length}/${r.capacity}</span></td>
          <td>${esc(ins.map(x => x.full_name).join("، ") || "—")}</td><td>${r.is_active ? pill("متاحة", "good") : pill("متوقفة", "muted")}</td>
          <td><button class="sk-btn sm" data-toggle="${r.id}" data-active="${r.is_active}">${r.is_active ? "إيقاف" : "تفعيل"}</button></td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="sk-empty">لا توجد غرف في هذا السكن بعد.</p>`;
  }
  sel.addEventListener("change", load);
  $("#rooms-table").addEventListener("change", async e => {
    const id = e.target.dataset.cap; if (!id) return;
    const { error } = await supabase.from("rooms").update({ capacity: +e.target.value }).eq("id", id);
    setMsg(msg, error ? errText(error) : "حُدّثت السعة.", error ? "error" : "success"); load();
  });
  $("#rooms-table").addEventListener("click", async e => {
    const b = e.target.closest("[data-toggle]"); if (!b) return;
    const { error } = await supabase.from("rooms").update({ is_active: b.dataset.active !== "true" }).eq("id", b.dataset.toggle);
    setMsg(msg, error ? errText(error) : "حُدّثت حالة الغرفة.", error ? "error" : "success"); load();
  });
  $("#room-add-form").addEventListener("submit", async e => {
    e.preventDefault();
    const { error } = await supabase.from("rooms").insert({ dormitory_id: sel.value, room_number: $("#room-no").value.trim(), capacity: +$("#room-cap").value, is_active: true });
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "أُضيفت الغرفة.", "success"); e.target.reset(); $("#room-cap").value = 2; load();
  });
  load();
}

/* =============================================
   الإدارة: كل الطلبات واعتماد النقل بين السكنات
   ============================================= */
async function adminRequests() {
  const s = await session(["admin"]); if (!s) return;
  const places = await loadPlaces(supabase);
  const list = $("#adm-req-list"), msg = $("#adm-req-message");
  let filter = "pending_admin", rows = [];

  async function load() {
    const { data, error } = await supabase.from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .order("created_at", { ascending: false }).limit(300);
    if (error) return setMsg(msg, "تعذّر تحميل الطلبات.", "error");
    rows = data || []; render();
  }
  function render() {
    document.querySelectorAll("[data-adm-filter]").forEach(b => {
      const k = b.dataset.admFilter, n = k === "all" ? rows.length : rows.filter(r => r.status === k).length;
      b.setAttribute("aria-pressed", String(k === filter)); b.querySelector("span").textContent = n;
    });
    const shown = filter === "all" ? rows : rows.filter(r => r.status === filter);
    list.innerHTML = shown.length ? shown.map(r => `
      <article class="sk-req"><div class="sk-req-head"><h3>${esc(TYPE_LABELS[r.request_type] || r.request_type)}</h3><div class="sk-row">${statusPill(r.status)}${gatePill(r)}</div></div>
      ${stepsTrack(r)}${requestDetailsHTML(r, places)}${cardImagesHTML(r)}
      ${["pending_admin", "pending_supervisor"].includes(r.status) ? `<div class="sk-actions">
        <textarea data-note="${r.id}" placeholder="ملاحظة الإدارة (إلزامية عند الرفض)"></textarea>
        <button class="sk-btn good" data-decide="approved" data-id="${r.id}">${r.request_type === "dorm_transfer" || r.request_type === "room_change" ? "اعتماد وتنفيذ النقل" : "اعتماد"}</button>
        <button class="sk-btn bad" data-decide="rejected" data-id="${r.id}">رفض</button></div>` : ""}
      </article>`).join("") : `<p class="sk-empty">لا توجد طلبات في هذا القسم.</p>`;
    hydrateCardImages(supabase, list);
  }
  document.querySelectorAll("[data-adm-filter]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.admFilter; render(); }));
  list.addEventListener("click", async e => {
    const b = e.target.closest("[data-decide]"); if (!b) return;
    const note = list.querySelector(`[data-note="${b.dataset.id}"]`)?.value.trim() || null;
    b.disabled = true;
    const { data, error } = await supabase.rpc("sakan_decide_request", { p_request_id: b.dataset.id, p_decision: b.dataset.decide, p_note: note });
    if (error) { setMsg(msg, errText(error), "error"); b.disabled = false; return; }
    setMsg(msg, data === "completed" ? "تم اعتماد الطلب وتنفيذ النقل." : data === "rejected" ? "رُفض الطلب." : "تم اعتماد الطلب.", "success");
    load();
  });
  load();
}

/* =============================================
   إنشاء حساب لكل دور (طالبة / مشرفة / أمن / إدارة)
   ============================================= */
const ROLE_HOME = { student: "student-dashboard.html", supervisor: "supervisor-dashboard.html", security: "security-dashboard.html", admin: "admin-dashboard.html" };
const ROLE_LOGIN = { student: "login.html", supervisor: "supervisor-login.html", security: "security-login.html", admin: "admin-login.html" };

async function signupPage() {
  const role = document.body.dataset.role;
  const form = $("#sk-signup-form"), msg = $("#sk-signup-message"), dormSel = $("#su-dorm");
  const show = (t, type) => { msg.textContent = t; msg.dataset.type = type; };

  if (dormSel) {
    const { data, error } = await supabase.from("dormitories").select("id, name").eq("is_active", true).order("name");
    dormSel.innerHTML = error || !data?.length
      ? `<option value="">لا توجد سكنات مسجلة بعد. راجعي الإدارة</option>`
      : `<option value="">اختاري السكن</option>` + data.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id)?.value.trim() || "";
    if (v("su-name").length < 3) return show("اكتبي الاسم الكامل.", "error");
    if (role === "student" && !v("su-number")) return show("اكتبي الرقم الجامعي.", "error");
    if (dormSel && !dormSel.value) return show("اختاري السكن.", "error");
    if (!/^\S+@\S+\.\S+$/.test(v("su-email"))) return show("اكتبي بريداً إلكترونياً صحيحاً.", "error");
    if ($("#su-password").value.length < 8) return show("كلمة المرور يجب ألا تقل عن 8 أحرف.", "error");
    if ($("#su-password").value !== $("#su-password2").value) return show("كلمتا المرور غير متطابقتين.", "error");

    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    show("جارٍ إنشاء الحساب...", "info");

    const { data, error } = await supabase.auth.signUp({
      email: v("su-email"),
      password: $("#su-password").value,
      options: {
        // بعد الضغط على رابط التأكيد يعود المستخدم إلى صفحة دخول دوره في نفس الموقع
        emailRedirectTo: new URL(ROLE_LOGIN[role], location.href).href,
        data: {
          role, full_name: v("su-name"), phone: v("su-phone"),
          student_number: v("su-number"), dormitory_id: dormSel?.value || "",
          signup_code: v("su-code")
        }
      }
    });
    btn.disabled = false;

    if (error) {
      const m = error.message || "";
      return show(
        /already registered|already exists/i.test(m) ? "هذا البريد مسجّل مسبقاً. سجّلي الدخول بدلاً من ذلك."
        : /Database error/i.test(m) ? "تعذّر إنشاء الحساب. تأكدي من رمز التسجيل (إن طُلب منكِ) ومن اختيار السكن، وأن الرقم الجامعي غير مستخدم."
        : /password/i.test(m) ? "كلمة المرور ضعيفة. استخدمي 8 أحرف على الأقل مع أرقام."
        : "تعذّر إنشاء الحساب. حاولي مرة أخرى.", "error");
    }
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return show("هذا البريد مسجّل مسبقاً. سجّلي الدخول بدلاً من ذلك.", "error");
    }
    if (data?.session) {
      show("تم إنشاء الحساب. جارٍ فتح لوحتك...", "success");
      location.href = ROLE_HOME[role];
      return;
    }
    form.reset();
    msg.innerHTML = "";
    show("تم إنشاء الحساب. أرسلنا رسالة تأكيد إلى بريدك، افتحيها ثم سجّلي الدخول.", "success");
    msg.insertAdjacentHTML("beforeend", ` <a href="${ROLE_LOGIN[role]}">تسجيل الدخول</a>`);
  });
}

/* =============================================
   التشغيل حسب الصفحة
   ============================================= */
const PAGES = {
  "student-attendance": studentAttendance,
  "student-hosting": studentHosting,
  "student-transfer": studentTransfer,
  "notifications": notifications,
  "supervisor-attendance": () => attendanceReport(false),
  "admin-attendance": () => attendanceReport(true),
  "admin-edit-user": adminEditUser,
  "admin-rooms": adminRooms,
  "admin-requests": adminRequests,
  "signup": signupPage
};
PAGES[page]?.();
fingerprintPanel();

// اسم المستخدمة في الشريط العلوي لباقي الصفحات
if (!PAGES[page] && $("#sk-who")) {
  supabase.auth.getUser().then(async ({ data: { user } }) => {
    if (!user) return;
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    $("#sk-who").textContent = p?.full_name || user.email;
  });
}

$("#sk-logout")?.addEventListener("click", async () => { await supabase.auth.signOut(); location.href = "index.html"; });
