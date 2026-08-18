/* ================================================================
   SUGGEST AN EDIT — faculty edit-suggestion form (Web3Forms)
   Faculty can propose changes to a course file or a specific CLO.
   Submissions are emailed via Web3Forms; nothing is written back
   to the repo automatically — a maintainer reviews and applies them.
================================================================ */
const WEB3FORMS_ACCESS_KEY = "22b2ac1e-25c4-45c5-80ee-66d3060470b6";
const WEB3FORMS_ENDPOINT   = "https://api.web3forms.com/submit";

window.openSuggestFromEl = function(el) {
  openSuggestModal({
    courseCode: el.dataset.course || "",
    courseTitle: el.dataset.title || "",
    context: el.dataset.context || "",
    currentText: el.dataset.current || "",
  });
};

window.openSuggestModal = function({ courseCode, courseTitle, context, currentText }) {
  document.getElementById("sg-course").textContent = courseTitle ? `${courseCode} — ${courseTitle}` : (courseCode || "General");
  document.getElementById("sg-context").textContent = context || "";
  document.getElementById("sg-course-code").value = courseCode || "";
  document.getElementById("sg-context-field").value = context || "";

  const curWrap = document.getElementById("sg-current-wrap");
  const curEl   = document.getElementById("sg-current");
  if (currentText) {
    curEl.value = currentText;
    curWrap.classList.remove("hidden");
  } else {
    curEl.value = "";
    curWrap.classList.add("hidden");
  }

  document.getElementById("sg-suggested").value = "";
  document.getElementById("sg-name").value = "";
  document.getElementById("sg-email").value = "";
  document.getElementById("sg-notes").value = "";
  setSuggestStatus("");
  document.getElementById("sg-submit").disabled = false;

  document.getElementById("suggest-modal").classList.remove("hidden");
};

window.closeSuggestModal = function() {
  document.getElementById("suggest-modal").classList.add("hidden");
};
window.onSuggestModalOverlayClick = function(e) {
  if (e.target === document.getElementById("suggest-modal")) closeSuggestModal();
};

function setSuggestStatus(msg, kind) {
  const el = document.getElementById("sg-status");
  el.textContent = msg || "";
  el.className = "sg-status" + (kind ? ` sg-${kind}` : "");
}

window.submitSuggestForm = async function(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("sg-submit");
  const name    = document.getElementById("sg-name").value.trim();
  const email   = document.getElementById("sg-email").value.trim();
  const change  = document.getElementById("sg-suggested").value.trim();
  if (!name || !email || !change) {
    setSuggestStatus("Please fill in your name, email, and the suggested change.", "err");
    return;
  }

  const courseCode = document.getElementById("sg-course-code").value;
  const context     = document.getElementById("sg-context-field").value;

  const payload = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `ChE Curriculum — suggested edit: ${courseCode || "General"} (${context || "unspecified"})`,
    from_name: name,
    email: email,
    course_code: courseCode || "(not specified)",
    field_being_edited: context || "(not specified)",
    current_text: document.getElementById("sg-current").value || "(not provided)",
    suggested_change: change,
    additional_notes: document.getElementById("sg-notes").value.trim() || "(none)",
  };

  submitBtn.disabled = true;
  setSuggestStatus("Submitting…");

  try {
    const r = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (data.success) {
      setSuggestStatus("Thanks — your suggestion was sent to the curriculum team.", "ok");
      setTimeout(closeSuggestModal, 1800);
    } else {
      setSuggestStatus(data.message || "Something went wrong. Please try again.", "err");
      submitBtn.disabled = false;
    }
  } catch (err) {
    setSuggestStatus("Network error — please try again.", "err");
    submitBtn.disabled = false;
  }
};
