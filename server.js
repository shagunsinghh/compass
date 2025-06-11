const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const multer = require("multer");
const fs = require("fs");

// Add these for OpenAI API support
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const upload = multer({ dest: "uploads/" });

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Important: Make sure JSON parsing middleware comes BEFORE your routes
app.use(express.json({ limit: "10mb" })); // Increased limit for PDF text
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Check environment variables
console.log("🔍 Environment Check:");
console.log(
  "- OPENAI_API_KEY:",
  process.env.OPENAI_API_KEY ? "✅ Set" : "❌ Missing"
);
console.log("- Node.js version:", process.version);

const formLibrary = {
  involves_minors: {
    name: "Assent to Participate in Research (minors)",
    url: "https://couhes.mit.edu/forms/assent.doc",
  },
  uses_mturk: {
    name: "MTurk Consent Text",
    url: "https://couhes.mit.edu/forms/mturk_consent.doc",
  },
  uses_phi: {
    name: "Authorization for Release of Protected Health Information",
    url: "https://couhes.mit.edu/forms/phi_release.doc",
  },
  is_genomic: {
    name: "Genomic Data Sharing Certification",
    url: "https://couhes.mit.edu/forms/genomic_cert.doc",
  },
  wants_waiver: {
    name: "Waiver or Alteration of Informed Consent Request",
    url: "https://couhes.mit.edu/forms/waiver_consent.docx",
  },
};

// NEW: OpenAI API route
app.post("/api/analyze", async (req, res) => {
  console.log("📧 /api/analyze endpoint hit");

  try {
    const { pdfText } = req.body;

    if (!pdfText) {
      return res.status(400).json({ error: "Missing pdfText in request body" });
    }

    console.log("📄 PDF text length:", pdfText.length);
    console.log("📄 PDF preview:", pdfText.substring(0, 500)); // Debug: see what text we're getting

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    let fetch;
    try {
      fetch = (await import("node-fetch")).default;
    } catch (e) {
      fetch = global.fetch;
    }

    // Enhanced prompt specifically for PI extraction
    const prompt = `Analyze this research document and extract detailed, comprehensive information for IRB sections. Provide 2-4 sentences for each section with specific details from the document.

Document text:
${pdfText.substring(0, 8000)}

Extract the following information and return as JSON. Each field should contain a detailed paragraph (2-4 sentences) with specific information from the document:

{
  "section1": "Complete study title with any subtitle or additional descriptive information found in the document",
  "section2": "Principal Investigator's full name, title, institutional affiliation, department, and contact information if available. Look for corresponding author, PI, or lead researcher - often marked with * or 'corresponding author'",
  "section3": "Detailed study purpose, research objectives, hypotheses, and specific aims. Include what the study hopes to achieve and any research questions being addressed",
  "section4": "Comprehensive background information, scientific rationale, literature context, and significance of the research. Include why this study is needed and what gaps it addresses", 
  "section5": "Detailed description of target population, demographics, sample size, inclusion criteria, exclusion criteria, and any special population considerations",
  "section6": "Comprehensive recruitment methods, strategies for participant identification, recruitment materials, and how participants will be approached and enrolled",
  "section7": "Detailed research procedures, methodology, study design, data collection methods, interventions, and step-by-step description of what participants will experience",
  "section8": "Thorough risk assessment including physical, psychological, social, and economic risks. Include safety considerations, monitoring procedures, and risk mitigation strategies",
  "section9": "Detailed description of benefits to participants, society, and scientific knowledge. Include both direct benefits to participants and broader societal impact",
  "section10": "Comprehensive data handling procedures, confidentiality measures, data storage, security protocols, de-identification procedures, and data sharing plans",
  "section11": "Detailed informed consent process, who will obtain consent, how consent will be documented, and any special consent considerations",
  "section12": "Comprehensive list and description of supporting documents, materials, instruments, consent forms, and any additional documentation referenced in the study"
}

IMPORTANT: Each JSON value must be a detailed paragraph (2-4 sentences minimum) with specific information extracted from the document. Do not provide brief one-sentence responses.`;

    console.log("🚀 Making OpenAI API request...");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o-mini", 
    messages: [
      {
        role: "system",
        content: "You are an expert research analyst specializing in IRB applications. Carefully read the document and extract detailed, comprehensive information. For each section, provide 2-4 sentences with specific details from the document. Each JSON value should be a detailed paragraph, not just a brief phrase. Always return valid JSON only, but with substantive, paragraph-length content for each field."
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    max_tokens: 3000, // Increased to allow for longer responses
    temperature: 0.1,
  }),
});

    console.log("📡 OpenAI API response status:", response.status);

    if (!response.ok) {
      const errorData = await response.text();
      console.error("❌ OpenAI API error:", errorData);
      return res
        .status(500)
        .json({ error: `OpenAI API error: ${response.status}` });
    }

    const data = await response.json();
    console.log("✅ OpenAI response received successfully");

    // Enhanced debugging
    const content = data.choices[0].message.content;
    console.log("📝 Full OpenAI response:", content);

    // Try to extract and validate JSON
    let extractedData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
        console.log("✅ Successfully parsed JSON:", extractedData);

        // Special validation for PI field
        if (extractedData.section2) {
          console.log(
            "👨‍🔬 Principal Investigator found:",
            extractedData.section2
          );
        } else {
          console.log("❌ No PI information extracted");
        }
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("❌ JSON parsing failed:", parseError);
      console.log("Raw content for debugging:", content);

      // Create intelligent fallback based on actual document content
      extractedData = createDocumentSpecificFallback(pdfText);
    }

    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify(extractedData, null, 2),
          },
        },
      ],
    });
  } catch (error) {
    console.error("💥 Error in /api/analyze:", error.message);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// NEW: Test endpoint to verify API is working
app.get("/api/test", (req, res) => {
  console.log("🧪 Test endpoint hit");
  res.json({
    status: "API is working",
    timestamp: new Date().toISOString(),
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
});

// EXISTING: Your original routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

let sharedText = "";
let sectionStates = {
  "section-1": "",
  "section-2": "",
  "section-3": "",
  "section-4": "",
  "section-5": "",
  "section-6": "",
  "section-7": "",
  "section-8": "",
  "section-9": "",
  "section-10": "",
  "section-11": "",
  "section-12": "",
};

const users = {};

// EXISTING: Socket.io connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("init-content", sharedText);

  socket.on("join", ({ name, color }) => {
    users[socket.id] = { name, color };
    io.emit(
      "user-list",
      Object.entries(users).map(([id, u]) => ({
        socketId: id,
        ...u,
      }))
    );
  });

  socket.on("text-change", (payload) => {
    const fullPayload = [...payload, socket.id];
    sharedText = payload[0].ops.reduce(
      (acc, op) => acc + (op.insert || ""),
      ""
    );
    socket.broadcast.emit("remote-text-change", fullPayload);
  });

  socket.on("cursor-change", ({ index, length }) => {
    const user = users[socket.id];
    if (user) {
      io.emit("remote-cursor-update", {
        socketId: socket.id,
        index,
        length,
        name: user.name,
        color: user.color,
      });
    }
  });

  Object.entries(sectionStates).forEach(([id, content]) => {
    socket.emit(`${id}-init`, content);
  });

  socket.on("section-edit", ({ section, content }) => {
    sectionStates[section] = content;
    socket.broadcast.emit(`${section}-update`, content);
  });

  socket.on("editor-change", (newText) => {
    sharedText = newText;
    socket.broadcast.emit("remote-edit", newText);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    delete users[socket.id];
    io.emit(
      "user-list",
      Object.entries(users).map(([id, u]) => ({
        socketId: id,
        ...u,
      }))
    );
  });
});

// EXISTING: Submit intake route
app.post("/submit-intake", upload.single("supporting_docs"), (req, res) => {
  const formData = {
    timestamp: new Date().toISOString(),
    title: req.body.title,
    pi: req.body.pi,
    irb_number: req.body.irb_number,
    description: req.body.description,
    recruitment: req.body.recruitment,
    risk_level: req.body.risk_level,
    consent: req.body.consent,
    uploaded_file: req.file?.originalname || null,
  };

  const requiredForms = [];
  for (const key of Object.keys(formLibrary)) {
    if (req.body[key]) requiredForms.push(formLibrary[key]);
  }
  formData.recommended_forms = requiredForms;

  const filePath = path.join(__dirname, "intake_submissions.json");
  let submissions = [];
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    submissions = JSON.parse(existing);
  }
  submissions.push(formData);
  fs.writeFileSync(filePath, JSON.stringify(submissions, null, 2));

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Submission Confirmed</title>
        <link rel="stylesheet" href="/main.css">
      </head>
      <body>
        <div id="navbar-placeholder"></div>
        <script>
          fetch('/navbar.html').then(res => res.text()).then(html => {
            document.getElementById('navbar-placeholder').innerHTML = html;
          });
        </script>
        <div class="page-wrapper">
          <h1>Submission Received 🎉</h1>
          <p><strong>Study Title:</strong> ${formData.title}</p>
          <p><strong>PI:</strong> ${formData.pi}</p>
          <p><strong>Risk Level:</strong> ${formData.risk_level}</p>
          <p><strong>Consent Required:</strong> ${formData.consent}</p>
          <p><strong>Submitted At:</strong> ${formData.timestamp}</p>
          ${
            requiredForms.length
              ? `
            <h2>Recommended COUHES Forms</h2>
            <ul>
              ${requiredForms
                .map(
                  (f) =>
                    `<li><a href="${f.url}" target="_blank">${f.name}</a></li>`
                )
                .join("")}
            </ul>`
              : `<p><em>No additional forms required based on your answers.</em></p>`
          }
          <p><a href="/intake.html">← Submit another</a> | <a href="/submissions">View all submissions</a></p>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

// EXISTING: Submissions route
app.get("/submissions", (req, res) => {
  const filePath = path.join(__dirname, "intake_submissions.json");

  if (!fs.existsSync(filePath)) return res.send("<p>No submissions yet.</p>");

  const submissions = JSON.parse(fs.readFileSync(filePath));
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>All IRB Submissions</title><link rel="stylesheet" href="/main.css"></head>
      <body>
        <div id="navbar-placeholder"></div>
        <script>
          fetch('/navbar.html').then(res => res.text()).then(html => {
            document.getElementById('navbar-placeholder').innerHTML = html;
          });
        </script>
        <div class="page-wrapper">
          <h1>IRB Submission Log</h1>
          ${submissions
            .map(
              (s) => `
            <div style="margin-bottom: 20px; border-bottom: 1px solid #ccc;">
              <p><strong>${s.title}</strong> by ${s.pi} — ${s.timestamp}</p>
              <p>Risk: ${s.risk_level} | Consent: ${s.consent}</p>
            </div>
          `
            )
            .join("")}
          <p><a href="/intake.html">← Submit another</a></p>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`🧪 Test the API at: http://localhost:${PORT}/api/test`);
  console.log(`🤖 AI endpoint at: http://localhost:${PORT}/api/analyze`);
});
