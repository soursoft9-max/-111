
// =============================================
// نظام سَكَن | SAKAN
// الملف الرئيسي main.js
// الجزء الأول: الاتصال والأدوات الأساسية
// =============================================

import { createClient } from
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// =============================================
// 1. إعداد الاتصال بقاعدة بيانات سَكَن
// =============================================

const SUPABASE_URL =
  "https://qvctiztgjcjtpaezfrck.supabase.co";

// ضعي مفتاح anon أو publishable العام من إعدادات Supabase
// لا تضعي service_role أو أي مفتاح سري هنا.
const SUPABASE_ANON_KEY = "sb_publishable_r-C9NyoZgnf5wCqlaMBwEg_TWokuxL4";

import {
  statusPill, gatePill, stepsTrack, loadPlaces, requestDetailsHTML,
  cardImagesHTML, hydrateCardImages, compressImage, TYPE_LABELS
} from "./sakan-shared.js";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// =============================================
// 2. أدوات الوصول إلى عناصر الصفحة
// =============================================

const $ = (selector, parent = document) =>
  parent.querySelector(selector);

const $$ = (selector, parent = document) =>
  [...parent.querySelectorAll(selector)];

function setMessage(element, message, type = "info") {
  if (!element) return;

  element.textContent = message;
  element.dataset.type = type;
}

function showMessage(id, message, type = "info") {
  setMessage(document.getElementById(id), message, type);
}

function formatDate(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("ar-OM", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

// =============================================
// 3. بيانات الجلسة الحالية
// =============================================

let currentUser = null;
let currentProfile = null;

const ROLES = {
  STUDENT: "student",
  SUPERVISOR: "supervisor",
  SECURITY: "security",
  ADMIN: "admin"
};

async function loadCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;

  currentUser = data.user;

  if (!currentUser) {
    currentProfile = null;
    return null;
  }

  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (profileError) throw profileError;

  // حساب دخول بلا ملف مستخدم: نُنشئ ملفه من بيانات التسجيل
  if (!profile) {
    const { error: ensureError } = await supabase.rpc("sakan_ensure_my_profile");

    if (!ensureError) {
      ({ data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle());
    } else {
      console.error("Ensure profile error:", ensureError);
    }
  }

  currentProfile = profile;

  return {
    user: currentUser,
    profile: currentProfile
  };
}

// =============================================
// 4. التحقق من تسجيل الدخول والدور
// =============================================

async function requireRole(allowedRoles = []) {
  try {
    const session = await loadCurrentUser();

    if (!session?.user) {
      window.location.href = "login.html";
      return false;
    }

    if (!session.profile || !session.profile.is_active) {
      await supabase.auth.signOut();
      alert("الحساب غير نشط أو لم يتم إعداد بياناته.");
      window.location.href = "login.html";
      return false;
    }

    if (
      allowedRoles.length &&
      !allowedRoles.includes(session.profile.role)
    ) {
      alert("ليس لديكِ صلاحية الدخول إلى هذه الصفحة.");
      window.location.href = "index.html";
      return false;
    }

    return true;

  } catch (error) {
    console.error("خطأ التحقق من الحساب:", error);
    alert("تعذر التحقق من بيانات الحساب.");
    return false;
  }
}

// =============================================
// 5. تسجيل الخروج
// =============================================

async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("خطأ تسجيل الخروج:", error);
    alert("تعذر تسجيل الخروج.");
    return;
  }

  window.location.href = "login.html";
}

// =============================================
// 6. ربط أزرار تسجيل الخروج
// =============================================

function setupLogoutButtons() {
  const logoutIds = [
    "logout-button",
    "security-logout-button",
    "admin-logout-button"
  ];

  logoutIds.forEach(id => {
    const button = document.getElementById(id);

    if (!button) return;

    button.addEventListener("click", async event => {
      event.preventDefault();
      await logout();
    });
  });
}

// =============================================
// 7. الاستماع لتغييرات حالة تسجيل الدخول
// =============================================

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    currentUser = null;
    currentProfile = null;
  }
});

// =============================================
// 8. تهيئة الملف
// =============================================

setupLogoutButtons();

console.log("تم تحميل أساسيات نظام سَكَن.");

// =============================================
// نظام سَكَن | SAKAN
// الجزء الثاني: تسجيل الدخول وإنشاء الحساب
// =============================================

// =============================================
// 1. تحديد صفحة الدخول حسب الدور
// =============================================

const ROLE_PAGES = {
  student: "student-dashboard.html",
  supervisor: "supervisor-dashboard.html",
  security: "security-dashboard.html",
  admin: "admin-dashboard.html"
};

// =============================================
// 2. تسجيل الدخول
// =============================================

async function handleLogin(formId, emailId, passwordId, messageId, expectedRole = null) {
  const form = document.getElementById(formId);

  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const email = document.getElementById(emailId)?.value.trim();
    const password = document.getElementById(passwordId)?.value;
    const message = document.getElementById(messageId);

    if (!email || !password) {
      setMessage(message, "يرجى إدخال البريد الإلكتروني وكلمة المرور.", "error");
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');

    if (submitButton) submitButton.disabled = true;

    setMessage(message, "جارٍ التحقق من بيانات الدخول...", "info");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      const session = await loadCurrentUser();

      if (!session?.profile) {
        await supabase.auth.signOut();
        throw new Error("لا يوجد ملف مستخدم مرتبط بهذا الحساب. تأكد من تشغيل ملف قاعدة البيانات database/00-sakan-schema.sql بنجاح.");
      }

      const profile = session.profile;

      if (!profile.is_active) {
        await supabase.auth.signOut();
        throw new Error("هذا الحساب غير نشط. يرجى مراجعة الإدارة.");
      }

      if (expectedRole && profile.role !== expectedRole) {
        await supabase.auth.signOut();
        throw new Error("هذا الحساب لا يملك صلاحية الدخول من هذه الصفحة.");
      }

      const destination = ROLE_PAGES[profile.role];

      if (!destination) {
        await supabase.auth.signOut();
        throw new Error("نوع الحساب غير معروف. يرجى مراجعة الإدارة.");
      }

      setMessage(message, "تم تسجيل الدخول بنجاح.", "success");

      window.location.href = destination;

    } catch (error) {
      console.error("Login error:", error);

      setMessage(
        message,
        error.message || "تعذر تسجيل الدخول.",
        "error"
      );

    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

// =============================================
// 3. ربط صفحات تسجيل الدخول
// =============================================

handleLogin(
  "login-form",
  "login-email",
  "login-password",
  "auth-message",
  ROLES.STUDENT
);

handleLogin(
  "supervisor-login-form",
  "supervisor-email",
  "supervisor-password",
  "supervisor-auth-message",
  ROLES.SUPERVISOR
);

handleLogin(
  "security-login-form",
  "security-email",
  "security-password",
  "security-auth-message",
  ROLES.SECURITY
);

handleLogin(
  "admin-login-form",
  "admin-email",
  "admin-password",
  "admin-login-message",
  ROLES.ADMIN
);

// إنشاء الحسابات لكل دور: انظر signupPage في sakan-features.js

// =============================================
// نظام سَكَن | SAKAN
// الجزء الثالث: لوحة الطالبة وطلبات الخدمات
// =============================================

// =============================================
// 1. أسماء حالات الطلبات
// =============================================

const REQUEST_STATUS_LABELS = {
  pending_supervisor: "بانتظار موافقة المشرفة",
  pending_admin: "بانتظار موافقة الإدارة",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  cancelled: "ملغي",
  completed: "مكتمل"
};

const REQUEST_TYPE_LABELS = {
  exit_permit: "استئذان خروج",
  hosting: "استضافة",
  dorm_transfer: "نقل بين السكنات",
  room_change: "تغيير الغرفة"
};

// =============================================
// 2. عرض بيانات الطالبة
// =============================================

async function loadStudentDashboard() {
  const studentEmail = document.getElementById("student-email");
  const dashboardMessage = document.getElementById("dashboard-message");

  if (studentEmail && currentUser) {
    studentEmail.textContent = currentProfile?.full_name ||
      currentUser.email ||
      "الطالبة";
  }

  if (dashboardMessage) {
    setMessage(dashboardMessage, "مرحبًا بكِ في نظام سَكَن.", "success");
  }

  await loadStudentRequests();
}

// =============================================
// 3. جلب طلبات الطالبة
// =============================================

async function loadStudentRequests() {
  const list = document.getElementById("my-requests-list");

  if (!list || !currentProfile) return;

  list.innerHTML = "<p>جارٍ تحميل طلباتك...</p>";

  try {
    const { data, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("student_id", currentProfile.id)
      .eq("request_type", "exit_permit")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      list.innerHTML = "<p>لا توجد طلبات حتى الآن.</p>";
      return;
    }

    list.innerHTML = data.map(request => `
      <article class="request-card sk-req">
        <div class="sk-req-head">
          <h3>${escapeHTML(TYPE_LABELS[request.request_type] || request.request_type)}</h3>
          <div class="sk-row">${statusPill(request.status)}${gatePill(request)}</div>
        </div>
        ${stepsTrack(request)}
        ${requestDetailsHTML(request)}
      </article>
    `).join("");

  } catch (error) {
    console.error("Student requests error:", error);

    list.innerHTML =
      "<p>تعذر تحميل الطلبات. تحققي من اتصال قاعدة البيانات وصلاحيات RLS.</p>";
  }
}

// =============================================
// 4. إرسال طلب خدمة جديد
// =============================================

function setupStudentRequestForm() {
  const form = document.getElementById("leave-request-form");

  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const message = document.getElementById("submit-request-message");
    const button = document.getElementById("submit-request-button");

    if (!currentProfile) {
      setMessage(message, "تعذر تحديد حساب الطالبة.", "error");
      return;
    }

    const requestType = $("#request-type")?.value;
    const startValue = $("#request-start")?.value;
    const endValue = $("#request-end")?.value;
    const detailsText = $("#request-details")?.value.trim() || "";
    const destination = $("#request-destination")?.value.trim() || "";

    if (requestType !== "exit_permit") {
      setMessage(message, "نوع الطلب غير صحيح.", "error");
      return;
    }

    if (!startValue || !endValue) {
      setMessage(message, "يرجى تحديد وقت المغادرة ووقت العودة.", "error");
      return;
    }

    const startDate = new Date(startValue);
    const endDate = new Date(endValue);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      endDate <= startDate
    ) {
      setMessage(message, "يجب أن يكون وقت العودة بعد وقت المغادرة.", "error");
      return;
    }

    const studentFile = $("#student-card-image")?.files?.[0];
    const guardianFile = $("#guardian-card-image")?.files?.[0];

    if (!studentFile || !guardianFile) {
      setMessage(message, "يرجى إرفاق صورة البطاقة الشخصية للطالبة وصورة بطاقة ولي الأمر.", "error");
      return;
    }

    const studentName = $("#ocr-student-name")?.value?.trim() || null;
    const studentCivilId = $("#ocr-student-number")?.value?.trim() || null;
    const guardianName = $("#ocr-guardian-name")?.value?.trim() || null;
    const guardianCivilId = $("#ocr-guardian-number")?.value?.trim() || null;

    if (!studentName || !studentCivilId || !guardianName || !guardianCivilId) {
      setMessage(message, "اقرئي البطاقتين أو اكتبي الاسم والرقم المدني لكل منهما.", "error");
      return;
    }

    if (button) button.disabled = true;

    try {
      // رفع صور البطاقات إلى التخزين الخاص (المسار يبدأ بمعرّف الطالبة)
      setMessage(message, "جارٍ رفع صور البطاقات...", "info");

      const stamp = Date.now();
      const uploads = [
        [studentFile, `${currentProfile.id}/${stamp}-student.jpg`],
        [guardianFile, `${currentProfile.id}/${stamp}-guardian.jpg`]
      ];

      for (const [file, path] of uploads) {
        const blob = await compressImage(file);
        const { error: uploadError } = await supabase.storage
          .from("id-cards")
          .upload(path, blob, { contentType: "image/jpeg", upsert: false });

        if (uploadError) throw uploadError;
      }

      setMessage(message, "جارٍ إرسال الطلب...", "info");

      const { error } = await supabase
        .from("service_requests")
        .insert({
          student_id: currentProfile.id,
          request_type: requestType,
          status: "pending_supervisor",
          start_at: startDate.toISOString(),
          end_at: endDate.toISOString(),
          details: {
            description: detailsText,
            destination,
            student_card: {
              full_name: studentName,
              id_number: studentCivilId,
              image_path: uploads[0][1]
            },
            guardian_card: {
              full_name: guardianName,
              id_number: guardianCivilId,
              image_path: uploads[1][1]
            }
          }
        });

      if (error) throw error;

      // تحديث بيانات الطالبة من البطاقة الشخصية العُمانية
      const { error: identityError } = await supabase.rpc(
        "update_my_identity_from_card",
        {
          p_full_name: studentName,
          p_civil_id: studentCivilId
        }
      );

      if (identityError) {
        console.error("Identity update error:", identityError);
      }

      setMessage(message, "تم إرسال الطلب بنجاح، وهو الآن بانتظار موافقة المشرفة.", "success");

      form.reset();

      await loadStudentRequests();

    } catch (error) {
      console.error("Submit request error:", error);

      const text = /[\u0600-\u06FF]/.test(error?.message || "")
        ? error.message
        : "تعذر إرسال الطلب. تأكدي من تشغيل ملف قاعدة البيانات database/01-sakan-features.sql.";

      setMessage(message, text, "error");

    } finally {
      if (button) button.disabled = false;
    }
  });
}

// =============================================
// 5. تهيئة صفحات الطالبة
// =============================================

async function initializeStudentPages() {
  const isStudentPage =
    document.getElementById("student-email") ||
    document.getElementById("leave-request-form");

  if (!isStudentPage) return;

  const allowed = await requireRole([ROLES.STUDENT]);

  if (!allowed) return;

  await loadStudentDashboard();

  setupStudentRequestForm();
}

// =============================================
// 6. تشغيل الجزء الثالث
// =============================================

initializeStudentPages();

// =============================================
// نظام سَكَن | SAKAN
// الجزء الرابع: لوحة المشرفة
// =============================================

let supervisorRequests = [];
let supervisorCurrentFilter = "pending_supervisor";

// =============================================
// 1. جلب الطلبات
// =============================================

let supervisorPlaces = null;

async function loadSupervisorRequests() {
  const container = document.getElementById("requests-list");
  const message = document.getElementById("dashboard-message");

  if (!container) return;

  container.innerHTML = "<p>جارٍ تحميل الطلبات...</p>";

  try {
    if (!supervisorPlaces) supervisorPlaces = await loadPlaces(supabase);

    const { data, error } = await supabase
      .from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    supervisorRequests = data || [];

    updateSupervisorStatistics();
    renderSupervisorRequests();

    setMessage(message, "تم تحديث قائمة الطلبات.", "success");

  } catch (error) {
    console.error("Supervisor requests error:", error);

    container.innerHTML =
      "<p>تعذر تحميل الطلبات. تحققي من صلاحيات العرض في قاعدة البيانات.</p>";

    setMessage(message, "حدث خطأ أثناء تحميل الطلبات.", "error");
  }
}

// =============================================
// 2. تحديث الإحصائيات
// =============================================

function updateSupervisorStatistics() {
  const pending = supervisorRequests.filter(
    item => item.status === "pending_supervisor"
  ).length;

  const approved = supervisorRequests.filter(
    item => item.status === "approved"
  ).length;

  const rejected = supervisorRequests.filter(
    item => item.status === "rejected"
  ).length;

  const pendingElement = document.getElementById("pending-count");
  const approvedElement = document.getElementById("approved-count");
  const rejectedElement = document.getElementById("rejected-count");

  if (pendingElement) pendingElement.textContent = pending;
  if (approvedElement) approvedElement.textContent = approved;
  if (rejectedElement) rejectedElement.textContent = rejected;
}

// =============================================
// 3. عرض الطلبات
// =============================================


function renderSupervisorRequests() {
  const container = document.getElementById("requests-list");

  if (!container) return;

  let filtered = supervisorRequests;

  if (supervisorCurrentFilter !== "all") {
    filtered = supervisorRequests.filter(
      item => item.status === supervisorCurrentFilter
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = "<p>لا توجد طلبات في هذا القسم.</p>";
    return;
  }

  const approveLabel = {
    exit_permit: "✓ موافقة وإرسال للأمن",
    hosting: "✓ موافقة على الاستضافة",
    room_change: "✓ موافقة وتنفيذ تغيير الغرفة",
    dorm_transfer: "✓ موافقة وإحالة للإدارة"
  };

  container.innerHTML = filtered.map(request => `
    <article class="request-card sk-req" data-request-id="${escapeHTML(request.id)}">
      <div class="sk-req-head">
        <h3>${escapeHTML(TYPE_LABELS[request.request_type] || request.request_type)}</h3>
        <div class="sk-row">${statusPill(request.status)}${gatePill(request)}</div>
      </div>
      ${stepsTrack(request)}
      ${requestDetailsHTML(request, supervisorPlaces)}
      ${cardImagesHTML(request)}
      ${
        request.status === "pending_supervisor"
          ? `
            <div class="request-actions sk-actions">
              <textarea
                class="supervisor-decision-note"
                data-note-for="${escapeHTML(request.id)}"
                placeholder="ملاحظة المشرفة (إلزامية عند الرفض)"
                rows="2"
              ></textarea>
              <button type="button" class="approve-request-button sk-btn good"
                data-action="approved" data-request-id="${escapeHTML(request.id)}">
                ${approveLabel[request.request_type] || "✓ موافقة"}
              </button>
              <button type="button" class="reject-request-button sk-btn bad"
                data-action="rejected" data-request-id="${escapeHTML(request.id)}">
                ✕ رفض الطلب
              </button>
            </div>
          `
          : ""
      }
    </article>
  `).join("");

  hydrateCardImages(supabase, container);
}

// =============================================
// 5. زر تحديث الطلبات
// =============================================

function setupSupervisorRefresh() {
  const button = document.getElementById("refresh-requests");

  if (!button) return;

  button.addEventListener("click", async () => {
    button.disabled = true;

    await loadSupervisorRequests();

    button.disabled = false;
  });
}

// =============================================
// 6. تهيئة لوحة المشرفة
// =============================================
// إعداد أزرار تصفية طلبات المشرفة
function setupSupervisorFilters() {
  const filterButtons = document.querySelectorAll("[data-filter]");

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      supervisorCurrentFilter = button.dataset.filter;

      filterButtons.forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");

      renderSupervisorRequests();
    });
  });
}

// =============================================
// تنفيذ قرارات المشرفة: موافقة أو رفض
// =============================================

function setupSupervisorDecisionActions() {
  const container = document.getElementById("requests-list");

  if (!container || container.dataset.decisionBound) return;

  container.dataset.decisionBound = "true";

  container.addEventListener("click", async event => {
    const button = event.target.closest(
      "[data-action][data-request-id]"
    );

    if (!button) return;

    const requestId = button.dataset.requestId;
    const decision = button.dataset.action;

    if (!["approved", "rejected"].includes(decision)) return;

    const noteField = container.querySelector(
      `[data-note-for="${requestId}"]`
    );

    const note = noteField?.value.trim() || "";

    if (decision === "rejected" && !note) {
      alert("يرجى كتابة سبب رفض الطلب.");
      noteField?.focus();
      return;
    }

    const confirmation =
      decision === "approved"
        ? "هل تريدين الموافقة على هذا الطلب؟"
        : "هل أنت متأكدة من رفض الطلب؟";

    if (!confirm(confirmation)) return;

    button.disabled = true;

    try {
      const { data: newStatus, error } = await supabase.rpc(
        "sakan_decide_request",
        {
          p_request_id: requestId,
          p_decision: decision,
          p_note: note || null
        }
      );

      if (error) throw error;

      setMessage(
        document.getElementById("dashboard-message"),
        decision === "rejected"
          ? "تم رفض الطلب بنجاح."
          : newStatus === "completed"
            ? "تمت الموافقة وتنفيذ تغيير الغرفة."
            : newStatus === "pending_admin"
              ? "تمت الموافقة وإحالة طلب النقل للإدارة."
              : "تمت الموافقة على الطلب.",
        "success"
      );

      await loadSupervisorRequests();

    } catch (error) {
      console.error("Supervisor decision error:", error);

      alert(
        error.message || "تعذر تنفيذ القرار. يرجى المحاولة مرة أخرى."
      );

      button.disabled = false;
    }
  });
}

async function initializeSupervisorDashboard() {
  if (!document.getElementById("requests-list")) return;

  const allowed = await requireRole([ROLES.SUPERVISOR]);

  if (!allowed) return;

  const emailElement = document.getElementById("student-email");

  if (emailElement && currentProfile) {
    emailElement.textContent =
      currentProfile.full_name || currentUser.email;
  }

  setupSupervisorFilters();
  setupSupervisorRefresh();
  setupSupervisorDecisionActions();

  await loadSupervisorRequests();
}

// =============================================
// 7. تشغيل الجزء الرابع
// =============================================

initializeSupervisorDashboard();

// =============================================
// نظام سَكَن | SAKAN
// الجزء الخامس: لوحة الأمن
// =============================================

let securityRequests = [];

// =============================================
// 1. تسميات حالات الأمن
// =============================================

const SECURITY_STATUS_LABELS = {
  not_received: "لم يتم استلام البطاقة",
  received: "تم استلام البطاقة",
  verified: "تم التحقق من البطاقة",
  mismatch: "يوجد اختلاف في البيانات"
};

// =============================================
// 2. تحميل طلبات الأمن
// =============================================


async function loadSecurityRequests() {
  const container = document.getElementById(
    "security-requests-container"
  );

  const message = document.getElementById(
    "security-dashboard-message"
  );

  if (!container) return;

  container.innerHTML = "<p>جارٍ تحميل الطلبات...</p>";

  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 19) + "Z";

    const { data, error } = await supabase
      .from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .in("request_type", ["exit_permit", "hosting"])
      .or(`status.eq.approved,and(status.eq.completed,created_at.gte.${since})`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    securityRequests = data || [];

    updateSecurityStatistics();
    renderSecurityRequests();

    setMessage(message, "تم تحديث بيانات الأمن.", "success");

  } catch (error) {
    console.error("Security requests error:", error);

    container.innerHTML =
      "<p>تعذر تحميل الطلبات. تحققي من صلاحيات الأمن وسياسات RLS.</p>";

    setMessage(message, "حدث خطأ أثناء تحميل الطلبات.", "error");
  }
}

// =============================================
// 3. تحديث إحصائيات الأمن
// =============================================

function updateSecurityStatistics() {
  const exits = securityRequests.filter(r => r.request_type === "exit_permit" && r.status === "approved");

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("security-total", exits.length);
  set("security-pending", exits.filter(r => !r.security_status || r.security_status === "not_received").length);
  set("security-received", exits.filter(r => r.security_status === "received").length);
  set("security-verified", exits.filter(r => r.security_status === "verified" && !r.gate_out_at).length);
  set("security-out", exits.filter(r => r.gate_out_at && !r.gate_in_at).length);
  set("security-guests", securityRequests.filter(r => r.request_type === "hosting" && r.status === "approved").length);
}

// =============================================
// 4. عرض الطلبات في لوحة الأمن
// =============================================

function securityActionsHTML(request) {
  const id = escapeHTML(request.id);
  const btn = (attr, label, tone = "primary") =>
    `<button type="button" class="security-action-button sk-btn ${tone}" ${attr} data-request-id="${id}">${label}</button>`;

  if (request.status !== "approved") return "";

  if (request.request_type === "exit_permit") {
    if (!request.security_status || request.security_status === "not_received") return btn('data-action="received"', "✓ تم استلام البطاقة");
    if (request.security_status === "received") return btn('data-action="verified"', "✓ تم التحقق من البطاقة");
    if (request.security_status === "verified" && !request.gate_out_at) return btn('data-gate="out"', "تسجيل خروج الطالبة", "gold");
    if (request.gate_out_at && !request.gate_in_at) return btn('data-gate="in"', "تسجيل عودة الطالبة", "gold");
  }

  if (request.request_type === "hosting") {
    if (!request.gate_in_at) return btn('data-gate="in"', "تسجيل دخول الضيفة", "gold");
    if (!request.gate_out_at) return btn('data-gate="out"', "تسجيل مغادرة الضيفة", "gold");
  }
  return "";
}

function renderSecurityRequests() {
  const container = document.getElementById(
    "security-requests-container"
  );

  if (!container) return;

  if (securityRequests.length === 0) {
    container.innerHTML =
      "<p>لا توجد طلبات متاحة للأمن حاليًا.</p>";
    return;
  }

  // الطلبات التي تحتاج إجراء أولاً، ثم المكتملة
  const ordered = [...securityRequests].sort((a, b) =>
    (a.status === "completed") - (b.status === "completed"));

  container.innerHTML = ordered.map(request => {
    const actions = securityActionsHTML(request);

    return `
      <article class="request-card sk-req" data-request-id="${escapeHTML(request.id)}">
        <div class="sk-req-head">
          <h3>${escapeHTML(TYPE_LABELS[request.request_type] || request.request_type)}</h3>
          <div class="sk-row">${statusPill(request.status)}${gatePill(request)}</div>
        </div>
        ${stepsTrack(request)}
        ${requestDetailsHTML(request)}
        ${cardImagesHTML(request)}
        ${actions ? `<div class="security-actions sk-actions">${actions}</div>` : ""}
      </article>
    `;
  }).join("");

  hydrateCardImages(supabase, container);
}

// =============================================
// 5. زر تحديث لوحة الأمن
// =============================================

function setupSecurityRefresh() {
  const button = document.getElementById(
    "security-refresh-button"
  );

  if (!button) return;

  button.addEventListener("click", async () => {
    button.disabled = true;

    try {
      await loadSecurityRequests();
    } finally {
      button.disabled = false;
    }
  });
}

// =============================================
// 6. تهيئة لوحة الأمن
// =============================================

function setupSecurityActions() {
  const container = document.getElementById(
    "security-requests-container"
  );

  if (!container) return;

  container.addEventListener("click", async event => {
    const button = event.target.closest(".security-action-button");

    if (!button) return;

    const requestId = button.dataset.requestId;
    const action = button.dataset.action;
    const gate = button.dataset.gate;

    if (!requestId) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "جارٍ التنفيذ...";

    try {
      let error;

      if (gate) {
        ({ error } = await supabase.rpc("sakan_security_gate", {
          p_request_id: requestId,
          p_action: gate
        }));
      } else if (["received", "verified"].includes(action)) {
        ({ error } = await supabase.rpc("security_update_request", {
          p_request_id: requestId,
          p_action: action,
          p_note: null
        }));
      } else {
        return;
      }

      if (error) throw error;

      await loadSecurityRequests();

    } catch (error) {
      console.error("Security action error:", error);

      setMessage(
        document.getElementById("security-dashboard-message"),
        error.message || "تعذر تنفيذ الإجراء. حاولي مرة أخرى.",
        "error"
      );

      button.disabled = false;
      button.textContent = original;
    }
  });
}


async function initializeSecurityDashboard() {
  if (!document.getElementById("security-requests-container")) {
    return;
  }

  const allowed = await requireRole([ROLES.SECURITY]);

  if (!allowed) return;

  setupSecurityRefresh();
  setupSecurityActions();

  await loadSecurityRequests();
}


// =============================================
// 7. تشغيل الجزء الخامس
// =============================================

initializeSecurityDashboard();

// =============================================
// نظام سَكَن | SAKAN
// الجزء السادس: لوحة الإدارة والإحصائيات
// =============================================

// =============================================
// 1. إظهار لوحة الإدارة بعد التحقق
// =============================================

function showAdminDashboard() {
  document.querySelectorAll("[data-admin-dashboard]").forEach(
    element => {
      element.style.display = "block";
    }
  );
}

// =============================================
// 2. تحميل إحصائيات الإدارة
// =============================================

async function loadAdminStatistics() {
  const message = document.getElementById("admin-auth-message");

  try {
    const [
      dormitoriesResult,
      studentsResult,
      supervisorsResult,
      requestsResult
    ] = await Promise.all([
      supabase
        .from("dormitories")
        .select("id", { count: "exact", head: true }),

      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "student"),

      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "supervisor"),

      supabase
        .from("service_requests")
        .select("id", { count: "exact", head: true })
    ]);

    const results = [
      dormitoriesResult,
      studentsResult,
      supervisorsResult,
      requestsResult
    ];

    const failed = results.find(result => result.error);

    if (failed) throw failed.error;

    const dormitoriesElement =
      document.getElementById("admin-total-dormitories");

    const studentsElement =
      document.getElementById("admin-total-students");

    const supervisorsElement =
      document.getElementById("admin-total-supervisors");

    const requestsElement =
      document.getElementById("admin-total-requests");

    if (dormitoriesElement) {
      dormitoriesElement.textContent = dormitoriesResult.count ?? 0;
    }

    if (studentsElement) {
      studentsElement.textContent = studentsResult.count ?? 0;
    }

    if (supervisorsElement) {
      supervisorsElement.textContent = supervisorsResult.count ?? 0;
    }

    if (requestsElement) {
      requestsElement.textContent = requestsResult.count ?? 0;
    }

  } catch (error) {
    console.error("Admin statistics error:", error);

    setMessage(
      message,
      "تعذر تحميل الإحصائيات. تحققي من صلاحيات الإدارة وسياسات قاعدة البيانات.",
      "error"
    );
  }
}

// =============================================
// 3. تحميل قائمة الطالبات
// =============================================

let adminStudents = [];

let adminPlaces = null;
const adminListRole = new URLSearchParams(location.search).get("role") || "student";

async function loadAdminStudents() {
  const tableBody = document.getElementById("students-table-body");
  const countElement = document.getElementById("students-count");
  const message = document.getElementById("students-message");

  if (!tableBody) return;

  tableBody.innerHTML =
    '<tr><td colspan="6">جارٍ التحميل...</td></tr>';

  document.querySelectorAll("[data-role-tab]").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.roleTab === adminListRole);
  });

  try {
    if (!adminPlaces) adminPlaces = await loadPlaces(supabase);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, student_number, role, dormitory_id, room_id, fingerprint_id, is_active")
      .eq("role", adminListRole)
      .order("full_name", { ascending: true });

    if (error) throw error;

    adminStudents = data || [];

    if (countElement) {
      countElement.textContent = adminStudents.length;
    }

    renderAdminStudents();

    setMessage(message, "تم تحميل القائمة.", "success");

  } catch (error) {
    console.error("Admin students error:", error);

    tableBody.innerHTML =
      '<tr><td colspan="6">تعذر تحميل القائمة.</td></tr>';

    setMessage(message, "تعذر تحميل البيانات.", "error");
  }
}

function renderAdminStudents(searchText = "") {
  const tableBody = document.getElementById("students-table-body");

  if (!tableBody) return;

  const search = searchText.trim().toLowerCase();

  const filtered = adminStudents.filter(item =>
    (item.full_name || "").toLowerCase().includes(search) ||
    (item.student_number || "").toLowerCase().includes(search) ||
    (item.fingerprint_id || "").includes(search)
  );

  if (filtered.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="6">لا توجد نتائج مطابقة.</td></tr>';
    return;
  }

  tableBody.innerHTML = filtered.map(item => `
    <tr>
      <td>${escapeHTML(item.full_name || "غير محدد")}</td>
      <td>${escapeHTML(item.student_number || "—")}</td>
      <td>${escapeHTML(adminPlaces?.dorms.get(item.dormitory_id) || "—")}${item.room_id ? " · " + escapeHTML(adminPlaces?.rooms.get(item.room_id) || "") : ""}</td>
      <td>${escapeHTML(item.fingerprint_id || "—")}</td>
      <td>${item.is_active ? "نشط" : "غير نشط"}</td>
      <td><a class="sk-btn sm" href="admin-edit-user.html?id=${encodeURIComponent(item.id)}">تعديل</a></td>
    </tr>
  `).join("");
}

function setupAdminStudentsSearch() {
  const searchInput = document.getElementById("students-search");

  if (!searchInput) return;

  searchInput.addEventListener("input", () => {
    renderAdminStudents(searchInput.value);
  });
}

// =============================================
// إدارة السكنات
// =============================================

let adminDormitories = [];

// تحميل السكنات وعدد الطالبات
async function loadAdminDormitories() {
  const tableBody = document.getElementById("dormitories-table-body");
  const message = document.getElementById("admin-auth-message");

  if (!tableBody) return;

  tableBody.innerHTML =
    '<tr><td colspan="6">جارٍ تحميل السكنات...</td></tr>';

  try {
    const [
      dormitoriesResult,
      studentsResult
    ] = await Promise.all([
      supabase
        .from("dormitories")
        .select("id, name, address, is_active, created_at")
        .order("created_at", { ascending: false }),

      supabase
        .from("profiles")
        .select("dormitory_id")
        .eq("role", "student")
    ]);

    if (dormitoriesResult.error) throw dormitoriesResult.error;
    if (studentsResult.error) throw studentsResult.error;

    const studentCounts = {};

    (studentsResult.data || []).forEach(student => {
      const dormitoryId = student.dormitory_id;

      if (dormitoryId) {
        studentCounts[dormitoryId] =
          (studentCounts[dormitoryId] || 0) + 1;
      }
    });

    adminDormitories = (dormitoriesResult.data || []).map(dormitory => ({
      ...dormitory,
      students_count: studentCounts[dormitory.id] || 0
    }));

    renderAdminDormitories();

    setMessage(message, "تم تحميل السكنات بنجاح.", "success");

  } catch (error) {
    console.error("Admin dormitories error:", error);

    tableBody.innerHTML =
      '<tr><td colspan="6">تعذر تحميل السكنات.</td></tr>';

    setMessage(
      message,
      "تعذر تحميل السكنات. تحققي من صلاحيات قاعدة البيانات.",
      "error"
    );
  }
}

// عرض السكنات
function renderAdminDormitories(searchText = "") {
  const tableBody = document.getElementById("dormitories-table-body");

  if (!tableBody) return;

  const search = searchText.trim().toLowerCase();

  const filteredDormitories = adminDormitories.filter(dormitory => {
    const name = (dormitory.name || "").toLowerCase();
    const address = (dormitory.address || "").toLowerCase();

    return name.includes(search) || address.includes(search);
  });

  if (filteredDormitories.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="6" class="empty-message">لا توجد سكنات مطابقة.</td></tr>';
    return;
  }

  tableBody.innerHTML = filteredDormitories.map((dormitory, index) => `
    <tr>
      <td>${index + 1}</td>

      <td>${escapeHTML(dormitory.name || "غير محدد")}</td>

      <td>${escapeHTML(dormitory.address || "غير محدد")}</td>

      <td>${dormitory.students_count}</td>

      <td>
        ${dormitory.is_active ? "نشط" : "متوقف"}
      </td>

      <td>
        <button
          type="button"
          class="primary-button"
          data-dormitory-action="edit"
          data-id="${escapeHTML(dormitory.id)}">
          تعديل
        </button>

        <a class="primary-button" href="admin-rooms.html?dorm=${encodeURIComponent(dormitory.id)}">الغرف</a>

        <button
          type="button"
          class="primary-button"
          data-dormitory-action="toggle"
          data-id="${escapeHTML(dormitory.id)}">
          ${dormitory.is_active ? "إيقاف" : "تفعيل"}
        </button>
      </td>
    </tr>
  `).join("");
}

// إضافة سكن جديد
async function addAdminDormitory() {
  const name = prompt("أدخلي اسم السكن الجديد:");

  if (name === null) return;

  if (!name.trim()) {
    alert("يرجى إدخال اسم السكن.");
    return;
  }

  const address = prompt("أدخلي عنوان السكن:");

  if (address === null) return;

  try {
    const { error } = await supabase
      .from("dormitories")
      .insert({
        name: name.trim(),
        address: address.trim() || null,
        is_active: true
      });

    if (error) throw error;

    alert("تمت إضافة السكن بنجاح.");

    await loadAdminDormitories();

  } catch (error) {
    console.error("Add dormitory error:", error);
    alert("تعذرت إضافة السكن. تحققي من صلاحيات قاعدة البيانات.");
  }
}

// تعديل بيانات السكن
async function editAdminDormitory(id) {
  const dormitory = adminDormitories.find(item => item.id === id);

  if (!dormitory) return;

  const name = prompt("تعديل اسم السكن:", dormitory.name || "");

  if (name === null) return;

  if (!name.trim()) {
    alert("اسم السكن مطلوب.");
    return;
  }

  const address = prompt("تعديل عنوان السكن:", dormitory.address || "");

  if (address === null) return;

  try {
    const { error } = await supabase
      .from("dormitories")
      .update({
        name: name.trim(),
        address: address.trim() || null
      })
      .eq("id", id);

    if (error) throw error;

    alert("تم تعديل بيانات السكن بنجاح.");

    await loadAdminDormitories();

  } catch (error) {
    console.error("Edit dormitory error:", error);
    alert("تعذر تعديل بيانات السكن.");
  }
}

// تفعيل أو إيقاف السكن
async function toggleAdminDormitory(id) {
  const dormitory = adminDormitories.find(item => item.id === id);

  if (!dormitory) return;

  const action = dormitory.is_active ? "إيقاف" : "تفعيل";

  if (!confirm(`هل أنتِ متأكدة من ${action} هذا السكن؟`)) {
    return;
  }

  try {
    const { error } = await supabase
      .from("dormitories")
      .update({
        is_active: !dormitory.is_active
      })
      .eq("id", id);

    if (error) throw error;

    alert(`تم ${action} السكن بنجاح.`);

    await loadAdminDormitories();

  } catch (error) {
    console.error("Toggle dormitory error:", error);
    alert("تعذر تغيير حالة السكن.");
  }
}

// ربط البحث والأزرار
function setupAdminDormitoriesActions() {
  const searchInput = document.getElementById("dormitories-search");
  const addButton = document.getElementById("add-dormitory-button");
  const tableBody = document.getElementById("dormitories-table-body");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";

    searchInput.addEventListener("input", () => {
      renderAdminDormitories(searchInput.value);
    });
  }

  if (addButton && !addButton.dataset.bound) {
    addButton.dataset.bound = "true";

    addButton.addEventListener("click", addAdminDormitory);
  }

  if (tableBody && !tableBody.dataset.bound) {
    tableBody.dataset.bound = "true";

    tableBody.addEventListener("click", async event => {
      const button = event.target.closest("[data-dormitory-action]");

      if (!button) return;

      const id = button.dataset.id;
      const action = button.dataset.dormitoryAction;

      if (action === "edit") {
        await editAdminDormitory(id);
      }

      if (action === "toggle") {
        await toggleAdminDormitory(id);
      }
    });
  }
}

// =============================================
// 5. تهيئة صفحات الإدارة
// =============================================

async function initializeAdminPages() {
  const isAdminPage =
    document.getElementById("admin-auth-message") ||
    document.getElementById("admin-total-students") ||
    document.getElementById("students-table-body") ||
    document.getElementById("dormitories-table-body") ||
    document.querySelector("[data-admin-dashboard]");

  if (!isAdminPage) return;

  const allowed = await requireRole([ROLES.ADMIN]);

  if (!allowed) return;

  showAdminDashboard();

  const message = document.getElementById("admin-auth-message");

  if (message && currentUser) {
    setMessage(message, "تم التحقق من صلاحية الإدارة.", "success");
  }

  if (
    document.getElementById("admin-total-dormitories") ||
    document.getElementById("admin-total-students") ||
    document.getElementById("admin-total-supervisors") ||
    document.getElementById("admin-total-requests")
  ) {
    await loadAdminStatistics();
  }

  if (document.getElementById("students-table-body")) {
    setupAdminStudentsSearch();
    await loadAdminStudents();
  }

  if (document.getElementById("dormitories-table-body")) {
    setupAdminDormitoriesActions();
    await loadAdminDormitories();
  }
}

initializeAdminPages();
// 2. تحسين الصورة قبل القراءة
async function preprocessCardImage(file) {
  const image = await createImageBitmap(file);

  const canvas = document.createElement("canvas");

  const scale = Math.min(2.5, 2600 / image.width);

  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const gray =
      0.299 * pixels[i] +
      0.587 * pixels[i + 1] +
      0.114 * pixels[i + 2];

    const enhanced = Math.max(
      0,
      Math.min(255, (gray - 128) * 1.35 + 128)
    );

    pixels[i] = enhanced;
    pixels[i + 1] = enhanced;
    pixels[i + 2] = enhanced;
  }

  context.putImageData(imageData, 0, 0);

  image.close();

  return canvas;
}

// 3. استخراج الرقم المدني

function normalizeOCRDigits(text = "") {
  return String(text)
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

function extractCardNumberFromOCR(text) {
  const normalized = normalizeOCRDigits(text);
  const lines = normalized.split(/\r?\n/);

  // البحث عن الرقم بجوار عبارة ID No.
  const labelPattern =
    /(?:ID\s*\.?\s*(?:NO|NUMBER)\s*\.?|CIVIL\s*(?:ID|NO|NUMBER)|رقم\s*البطاقة|الرقم\s*المدني)/i;

  for (let i = 0; i < lines.length; i++) {
    if (!labelPattern.test(lines[i])) continue;

    // النص الموجود بجوار المسمى أو في السطر التالي
    const sameLine = lines[i].replace(labelPattern, " ");

    const candidatesText = [
      sameLine,
      lines[i + 1] || ""
    ].join(" ");

    const candidates =
      candidatesText.match(/\d(?:[\s-]*\d){7,11}/g) || [];

    for (const candidate of candidates) {
      const number = candidate.replace(/\D/g, "");

      if (number.length >= 8 && number.length <= 12) {
        return number;
      }
    }
  }

  // لا نختار أرقامًا عشوائية من بقية البطاقة
  return "";
}

// =============================================
// 4. تنظيف النص العربي
// =============================================

function cleanArabicOCRLine(line) {
  return line
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[0-9٠-٩۰-۹]/g, "")
    .replace(/[^\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================
// 5. استخراج اسم صاحبة البطاقة
// =============================================

function extractCardNameFromOCR(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const nameLabel =
    /(?:الاسم|اسم\s*حامل\s*البطاقة|name)/i;

  for (let i = 0; i < lines.length; i++) {
    if (nameLabel.test(lines[i])) {
      const sameLine = cleanArabicOCRLine(
        lines[i].replace(nameLabel, "")
      );

      if (sameLine.split(/\s+/).filter(Boolean).length >= 2) {
        return sameLine;
      }

      if (lines[i + 1]) {
        const nextLine = cleanArabicOCRLine(lines[i + 1]);

        if (nextLine.split(/\s+/).filter(Boolean).length >= 2) {
          return nextLine;
        }
      }
    }
  }

  const candidates = lines
    .map(cleanArabicOCRLine)
    .filter(line => {
      const words = line.split(/\s+/).filter(Boolean);

      return (
        words.length >= 2 &&
        words.length <= 6 &&
        line.length >= 5
      );
    });

  return candidates[0] || "";
}

// =============================================
// 6. قراءة البطاقة الشخصية
// =============================================

async function runCardOCR(prefix) {
  const fileInput = document.getElementById(
    prefix + "-card-image"
  );

  const statusElement = document.getElementById(
    prefix + "-ocr-status"
  );

  const nameElement = document.getElementById(
    "ocr-" + prefix + "-name"
  );

  const numberElement = document.getElementById(
    "ocr-" + prefix + "-number"
  );

  const rawTextElement = document.getElementById(
    "ocr-" + prefix + "-raw-text"
  );

  const button = document.getElementById(
    "scan-" + prefix + "-card"
  );

  if (!fileInput?.files?.[0]) {
    setMessage(statusElement, "اختاري صورة البطاقة أولًا.", "error");
    return;
  }

  if (!window.Tesseract) {
    setMessage(
      statusElement,
      "مكتبة قراءة البطاقات غير متاحة.",
      "error"
    );
    return;
  }

  const file = fileInput.files[0];

  if (!file.type.startsWith("image/")) {
    setMessage(statusElement, "اختاري ملف صورة صحيحًا.", "error");
    return;
  }

  if (button) button.disabled = true;

  setMessage(statusElement, "جارٍ تجهيز الصورة...", "info");

  try {
    const preparedImage = await preprocessCardImage(file);

    // قراءة الاسم باللغة العربية
    setMessage(
      statusElement,
      "جارٍ قراءة الاسم...",
      "info"
    );

    const arabicResult = await window.Tesseract.recognize(
      preparedImage,
      "ara"
    );

    const arabicText = arabicResult.data.text || "";

    // قراءة الرقم باللغة الإنجليزية
    setMessage(
      statusElement,
      "جارٍ قراءة الرقم المدني...",
      "info"
    );

    const englishResult = await window.Tesseract.recognize(
      preparedImage,
      "eng"
    );

    const englishText = englishResult.data.text || "";

    const combinedText =
      arabicText + "\n" + englishText;

    if (rawTextElement) {
      rawTextElement.value = combinedText;
    }

    // استخراج الاسم من القراءة العربية
    const detectedName =
      extractCardNameFromOCR(arabicText);

    // استخراج الرقم مع التركيز على مسمى ID No.
    const detectedNumber =
      extractCardNumberFromOCR(
        englishText + "\n" + arabicText
      );

    if (nameElement) {
      nameElement.value = detectedName;
    }

    if (numberElement) {
      numberElement.value = detectedNumber;
    }

    if (!arabicText.trim() && !englishText.trim()) {
      setMessage(
        statusElement,
        "لم يتم التعرف على محتوى الصورة.",
        "error"
      );
    } else if (!detectedName || !detectedNumber) {
      setMessage(
        statusElement,
        "اكتملت القراءة جزئيًا. تحققي من البيانات.",
        "info"
      );
    } else {
      setMessage(
        statusElement,
        "تم استخراج البيانات مبدئيًا. يرجى التحقق من صحتها.",
        "success"
      );
    }

  } catch (error) {
    console.error("Card OCR error:", error);

    setMessage(
      statusElement,
      "تعذرت قراءة الصورة. جربي صورة أوضح.",
      "error"
    );

  } finally {
    if (button) button.disabled = false;
  }
}

// =============================================
// 7. ربط أزرار قراءة البطاقات
// =============================================

function setupCardOCR() {
  const buttons = [
    {
      id: "scan-student-card",
      prefix: "student"
    },
    {
      id: "scan-guardian-card",
      prefix: "guardian"
    }
  ];

  buttons.forEach(item => {
    const button = document.getElementById(item.id);

    if (!button || button.dataset.ocrBound) return;

    button.dataset.ocrBound = "true";

    button.addEventListener("click", () => {
      runCardOCR(item.prefix);
    });
  });
}

// =============================================
// 8. تشغيل قارئ البطاقات
// =============================================

setupCardOCR();

console.log("تم تشغيل قارئ البطاقات في نظام سَكَن.");
