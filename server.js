import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SUBMISSIONS_FILE = path.join(__dirname, "submissions", "data.json");
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "changeme123";
const YOUR_EMAIL = process.env.YOUR_EMAIL;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!fs.existsSync(path.join(__dirname, "submissions"))) {
  fs.mkdirSync(path.join(__dirname, "submissions"), { recursive: true });
}
if (!fs.existsSync(SUBMISSIONS_FILE)) {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify([]));
}

function loadSubmissions() {
  try { return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, "utf8")); }
  catch { return []; }
}

function saveSubmission(entry) {
  const all = loadSubmissions();
  all.unshift(entry);
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(all, null, 2));
}

function buildPrompt(fd) {
  const addr = [fd.street, fd.city, fd.state, fd.zip].filter(Boolean).join(", ");
  const testStr = fd.testimonials && fd.testimonials.length
    ? fd.testimonials.map(t => `"${t.text}" — ${t.name} (${t.rating}/5 stars)`).join("\n")
    : "None provided";

  return `You are an expert local business web designer. Create a complete, polished, single-file HTML website.

BUSINESS INFO:
Name: ${fd.name}
Type: ${fd.type}
Address: ${addr}
Phone: ${fd.phone}
Email: ${fd.email}
${fd.url ? "Website: " + fd.url : ""}
Hours: ${fd.hours}
Social: ${fd.social || "Not provided"}

SERVICES & PRICING:
${fd.services}
${fd.pricing ? "Pricing: " + fd.pricing : ""}

TARGET CUSTOMER:
${fd.customer}
Service area: ${fd.area || "Local area"}

BUSINESS GOALS:
${fd.goals}

ABOUT THE BUSINESS:
${fd.tagline ? "Tagline: " + fd.tagline : ""}
${fd.desc}

TESTIMONIALS:
${testStr}

DESIGN REQUIREMENTS:
Brand color: ${fd.color}
Style preference: ${fd.stylePrefs || "Professional and modern"}
${fd.styleNotes ? "Style notes: " + fd.styleNotes : ""}
Sections to include: ${fd.sections}
${fd.hasLogo ? "Note: Client has a logo — add a placeholder [LOGO] in the nav where it should go." : ""}
${fd.photoCount > 0 ? `Note: Client has ${fd.photoCount} photos — add [PHOTO_1], [PHOTO_2] etc. placeholders in appropriate sections.` : ""}

TECHNICAL REQUIREMENTS:
- Single self-contained HTML file (Google Fonts OK, no other external deps)
- Fully mobile responsive
- Use ${fd.color} as the primary brand color throughout
- Sticky navigation with smooth scroll
- Strong, prominent call-to-action buttons (especially for phone calls if goal is calls)
- All contact info displayed clearly
- If testimonials were provided, include them in a styled testimonials section
- Professional, trustworthy design appropriate for a local ${fd.type} business
- Include a footer with address, phone, email, hours

Return ONLY the complete HTML code starting with <!DOCTYPE html>. No explanation, no markdown fences, no commentary.`;
}

async function generateWebsite(fd) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const prompt = buildPrompt(fd);
  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });
  let html = msg.content.map(b => b.text || "").join("");
  html = html.replace(/```html\n?/gi, "").replace(/```\n?/g, "").trim();
  return { html, prompt };
}

async function sendEmails(fd, html, submissionId) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: YOUR_EMAIL, pass: GMAIL_APP_PASSWORD },
  });

  const addr = [fd.street, fd.city, fd.state, fd.zip].filter(Boolean).join(", ");
  const dashboardUrl = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/dashboard`
    : `http://localhost:${PORT}/dashboard`;

  await transporter.sendMail({
    from: YOUR_EMAIL,
    to: YOUR_EMAIL,
    subject: `New website submission — ${fd.name}`,
    html: `
      <h2>New client submission</h2>
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:6px 12px 6px 0;color:#666">Business</td><td><strong>${fd.name}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Type</td><td>${fd.type}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Address</td><td>${addr}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Phone</td><td>${fd.phone}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td>${fd.email}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Goals</td><td>${fd.goals}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Style</td><td>${fd.stylePrefs || "Not specified"}</td></tr>
      </table>
      <br>
      <a href="${dashboardUrl}" style="background:#1a6fcf;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-family:sans-serif">
        View in dashboard
      </a>
      <p style="font-family:sans-serif;font-size:13px;color:#888;margin-top:16px">
        The generated HTML file is attached to this email.
      </p>
    `,
    attachments: [{
      filename: `${fd.name.replace(/\s+/g, "-").toLowerCase()}-website.html`,
      content: html,
      contentType: "text/html",
    }],
  });

  if (fd.email) {
    await transporter.sendMail({
      from: YOUR_EMAIL,
      to: fd.email,
      subject: `We received your website request — ${fd.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
          <h2 style="font-size:22px;font-weight:600;margin-bottom:8px">Thanks, we got it!</h2>
          <p style="color:#444;line-height:1.6">
            Hi there — we've received your website information for <strong>${fd.name}</strong> 
            and we're already working on your site.
          </p>
          <p style="color:#444;line-height:1.6">
            We'll be in touch shortly with a preview for you to review. 
            If you have any questions in the meantime, just reply to this email.
          </p>
          <p style="color:#888;font-size:13px;margin-top:32px">
            — Your web design team
          </p>
        </div>
      `,
    });
  }
}

app.post("/api/submit", async (req, res) => {
  try {
    const fd = req.body;
    const submissionId = crypto.randomUUID();
    const submittedAt = new Date().toISOString();

    res.json({ success: true, message: "Received! Generating your website..." });

    const { html, prompt } = await generateWebsite(fd);

    const entry = {
      id: submissionId,
      submittedAt,
      status: "pending_review",
      formData: fd,
      generatedHtml: html,
      generatedPrompt: prompt,
    };

    saveSubmission(entry);

    await sendEmails(fd, html, submissionId).catch(err =>
      console.error("Email error:", err.message)
    );

  } catch (err) {
    console.error("Submit error:", err);
  }
});

app.post("/api/dashboard/auth", (req, res) => {
  const { password } = req.body;
  if (password === DASHBOARD_PASSWORD) {
    res.json({ success: true, token: Buffer.from(DASHBOARD_PASSWORD).toString("base64") });
  } else {
    res.status(401).json({ success: false, message: "Incorrect password" });
  }
});

function authMiddleware(req, res, next) {
  const token = req.headers["x-dashboard-token"];
  if (token === Buffer.from(DASHBOARD_PASSWORD).toString("base64")) return next();
  res.status(401).json({ error: "Unauthorized" });
}

app.get("/api/submissions", authMiddleware, (req, res) => {
  res.json(loadSubmissions());
});

app.get("/api/submissions/:id", authMiddleware, (req, res) => {
  const all = loadSubmissions();
  const entry = all.find(s => s.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Not found" });
  res.json(entry);
});

app.patch("/api/submissions/:id/status", authMiddleware, (req, res) => {
  const all = loadSubmissions();
  const idx = all.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  all[idx].status = req.body.status;
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(all, null, 2));
  res.json({ success: true });
});

app.patch("/api/submissions/:id/html", authMiddleware, (req, res) => {
  const all = loadSubmissions();
  const idx = all.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  all[idx].generatedHtml = req.body.html;
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(all, null, 2));
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
